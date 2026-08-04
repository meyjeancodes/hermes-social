"""Per-platform adapters. Each returns a dict: {ok: bool, ...} or {ok: False, error: str}.

Reads are best-effort and degrade to an informative error when creds are missing.
Writes to X shell out to `x-cli` (official API). Reddit uses praw. FB/IG use the
Graph API over HTTPS.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any, Dict, List

import requests

from . import config

GRAPH = "https://graph.facebook.com/v19.0"


# ───────────────────────────────── X / Twitter ────────────────────────────────
def _x_cli(args: List[str]) -> Dict[str, Any]:
    # Resolve x-cli from common install locations so it works even when the
    # server runs under launchd with a minimal PATH (no ~/.local/bin).
    import shutil

    exe = shutil.which("x-cli")
    if exe is None:
        candidate = os.path.expanduser("~/.local/bin/x-cli")
        if os.path.exists(candidate):
            exe = candidate
    if exe is None:
        return {"ok": False, "error": "x-cli not installed (uv tool install git+https://github.com/Infatoshi/x-cli.git)"}
    try:
        # NOTE: x-cli's -j/-v are GROUP options and must precede the subcommand.
        proc = subprocess.run(
            [exe, "-j", *args],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        return {"ok": False, "error": "x-cli not installed (uv tool install git+https://github.com/Infatoshi/x-cli.git)"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "x-cli timed out"}
    out = proc.stdout.strip()
    err = (proc.stderr.strip() or out)  # x-cli prints errors to stdout
    if proc.returncode != 0:
        # x-cli prints a full Python traceback on API errors. Extract the
        # meaningful line (the RuntimeError/API error), not the stack, so the
        # UI stays readable. Fall back to the last non-empty line.
        msg = ""
        lines = err.splitlines()
        for i, line in enumerate(lines):
            if line.strip().startswith("RuntimeError:"):
                # real raised message, e.g. "RuntimeError: API error (HTTP 401): {...}"
                msg = line.strip()
                break
        if not msg:
            # fall back: line that literally contains the API error text
            for line in lines:
                if "API error (HTTP" in line:
                    msg = line.strip(); break
        if not msg:
            for line in lines:
                if "Error" in line:
                    msg = line.strip(); break
        if not msg:
            msg = lines[-1].strip() if lines else f"x-cli exited {proc.returncode}"
        return {"ok": False, "error": msg}
    try:
        return {"ok": True, "data": json.loads(out)}
    except json.JSONDecodeError:
        return {"ok": True, "raw": out}


def x_verify() -> Dict[str, Any]:
    """Live check: ask x-cli for the authenticated user."""
    return _x_cli(["user", "get", "me"])


def x_post(text: str) -> Dict[str, Any]:
    return _x_cli(["tweet", "post", text])


def x_reply(tweet_id: str, text: str) -> Dict[str, Any]:
    return _x_cli(["tweet", "reply", tweet_id, text])


def x_like(tweet_id: str) -> Dict[str, Any]:
    return _x_cli(["like", tweet_id])


def x_retweet(tweet_id: str) -> Dict[str, Any]:
    return _x_cli(["retweet", tweet_id])


# Native X client (OAuth 1.0a) — used for timeline reads that x-cli doesn't expose.
# x-cli only has me/tweet/like/retweet/user, so Home/For-You feeds call the API directly.
# requests_oauthlib is imported lazily inside _x_oauth so a missing dep doesn't crash server start.
X_API = "https://api.twitter.com/2"


def _x_oauth():
    from requests_oauthlib import OAuth1

    return OAuth1(
        config.get("X_API_KEY"),
        config.get("X_API_SECRET"),
        config.get("X_ACCESS_TOKEN"),
        config.get("X_ACCESS_TOKEN_SECRET"),
    )


def _x_uid() -> str:
    """Resolve the authenticated user's numeric id (needed for timeline endpoints)."""
    r = requests.get(f"{X_API}/users/me", auth=_x_oauth(), timeout=30)
    if not r.ok:
        raise RuntimeError(f"X API error (HTTP {r.status_code}): {r.text}")
    return r.json()["data"]["id"]


def _x_timeline(kind: str, uid: str, limit: int) -> Dict[str, Any]:
    """kind: 'home' (reverse-chronological following) or 'mentions'.

    NOTE: X's real 'For You' algorithmic feed is NOT available via any API tier.
    We synthesize a best-effort 'foryou' from home + mentions and label it clearly.
    Home requires a paid tier (Free returns 403)."""
    params = {
        "max_results": min(limit, 100),
        "tweet.fields": "created_at,author_id,public_metrics,text",
        "expansions": "author_id",
        "user.fields": "username,name,profile_image_url",
    }
    if kind == "mentions":
        url = f"{X_API}/users/{uid}/mentions"
    else:  # home
        url = f"{X_API}/users/{uid}/timelines/reverse_chronological"
    r = requests.get(url, params=params, auth=_x_oauth(), timeout=30)
    if not r.ok:
        return {"ok": False, "error": f"X API error (HTTP {r.status_code}): {r.text[:300]}"}
    body = r.json()
    users = {u["id"]: u for u in body.get("includes", {}).get("users", [])}
    items = []
    for t in body.get("data", []):
        u = users.get(t.get("author_id"), {})
        items.append({
            "id": str(t.get("id")),
            "author": u.get("username"),
            "author_name": u.get("name"),
            "text": t.get("text"),
            "created_at": t.get("created_at"),
            "url": f"https://x.com/{u.get('username', 'i')}/status/{t.get('id')}",
            "metrics": t.get("public_metrics", {}),
        })
    return {"ok": True, "items": items}


def x_feeds(limit: int = 10, feed: str = "home") -> Dict[str, Any]:
    """feed: 'home' | 'mentions' | 'foryou' (best-effort synthetic)."""
    try:
        uid = _x_uid()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if feed == "mentions":
        return _x_timeline("mentions", uid, limit)
    if feed == "foryou":
        # Best-effort: merge home + mentions, label clearly in the UI.
        home = _x_timeline("home", uid, limit)
        if not home.get("ok"):
            return home
        men = _x_timeline("mentions", uid, min(limit, 10))
        seen = set()
        merged = []
        for it in (home.get("items", []) + (men.get("items", []) if men.get("ok") else [])):
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            merged.append(it)
        return {"ok": True, "items": merged[:limit], "synthetic": True}
    return _x_timeline("home", uid, limit)


# ───────────────────────────────── Reddit ────────────────────────────────────
def _reddit():
    import praw

    return praw.Reddit(
        client_id=config.get("REDDIT_CLIENT_ID"),
        client_secret=config.get("REDDIT_CLIENT_SECRET"),
        user_agent=config.get("REDDIT_USER_AGENT", "hermes-social/0.1 by u/me"),
        username=config.get("REDDIT_USERNAME"),
        password=config.get("REDDIT_PASSWORD"),
    )


def reddit_verify() -> Dict[str, Any]:
    try:
        r = _reddit()
        me = r.user.me()
        return {"ok": True, "username": str(me.name)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def reddit_post(subreddit: str, title: str, text: str = "", url: str = "") -> Dict[str, Any]:
    try:
        r = _reddit()
        kind = r.subreddit(subreddit).submit(title=title, selftext=text, url=url or None)
        return {"ok": True, "id": str(kind.id), "url": f"https://reddit.com/r/{subreddit}/comments/{kind.id}/"}
    except Exception as e:  # praw raises on auth/network
        return {"ok": False, "error": str(e)}


def reddit_reply(thing_id: str, text: str) -> Dict[str, Any]:
    try:
        r = _reddit()
        sub = r.comment(thing_id) if thing_id.startswith("t1_") else r.submission(thing_id)
        c = sub.reply(text)
        return {"ok": True, "id": str(c.id)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def reddit_feeds(limit: int = 10, subreddit: str = "") -> Dict[str, Any]:
    try:
        r = _reddit()
        src = r.subreddit(subreddit).hot(limit=limit) if subreddit else r.front.hot(limit=limit)
        items = []
        for s in src:
            items.append(
                {
                    "id": str(s.id),
                    "author": str(s.author) if s.author else None,
                    "subreddit": str(s.subreddit),
                    "title": s.title,
                    "score": s.score,
                    "num_comments": s.num_comments,
                    "url": f"https://reddit.com{s.permalink}",
                }
            )
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ───────────────────────────────── Facebook ──────────────────────────────────
def _fb_headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {config.get('FB_PAGE_ACCESS_TOKEN')}"}


def fb_verify() -> Dict[str, Any]:
    token = config.get("FB_PAGE_ACCESS_TOKEN")
    pid = config.get("FB_PAGE_ID")
    if not token or not pid:
        return {"ok": False, "error": "FB_PAGE_ACCESS_TOKEN / FB_PAGE_ID not configured"}
    try:
        resp = requests.get(f"{GRAPH}/{pid}", params={"fields": "name", "access_token": token}, timeout=30)
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("error", {}).get("message", resp.text)}
        return {"ok": True, "name": body.get("name")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def fb_post(message: str) -> Dict[str, Any]:
    token = config.get("FB_PAGE_ACCESS_TOKEN")
    pid = config.get("FB_PAGE_ID")
    if not token or not pid:
        return {"ok": False, "error": "FB_PAGE_ACCESS_TOKEN / FB_PAGE_ID not configured"}
    try:
        resp = requests.post(f"{GRAPH}/{pid}/feed", data={"message": message}, headers=_fb_headers(), timeout=30)
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("error", {}).get("message", resp.text)}
        return {"ok": True, "id": body.get("id"), "url": f"https://facebook.com/{body.get('id')}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def fb_feeds(limit: int = 10) -> Dict[str, Any]:
    token = config.get("FB_PAGE_ACCESS_TOKEN")
    pid = config.get("FB_PAGE_ID")
    if not token or not pid:
        return {"ok": False, "error": "FB_PAGE_ACCESS_TOKEN / FB_PAGE_ID not configured"}
    try:
        resp = requests.get(
            f"{GRAPH}/{pid}/feed",
            params={"fields": "id,message,created_time,permalink_url", "limit": limit},
            headers=_fb_headers(),
            timeout=30,
        )
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("error", {}).get("message", resp.text)}
        items = [
            {
                "id": d.get("id"),
                "text": d.get("message"),
                "created_at": d.get("created_time"),
                "url": d.get("permalink_url"),
            }
            for d in body.get("data", [])
        ]
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ───────────────────────────────── Instagram ─────────────────────────────────
def ig_verify() -> Dict[str, Any]:
    token = config.get("FB_PAGE_ACCESS_TOKEN")
    ig_id = config.get("IG_USER_ID")
    if not token or not ig_id:
        return {"ok": False, "error": "FB_PAGE_ACCESS_TOKEN / IG_USER_ID not configured"}
    try:
        resp = requests.get(f"{GRAPH}/{ig_id}", params={"fields": "username", "access_token": token}, timeout=30)
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("error", {}).get("message", resp.text)}
        return {"ok": True, "username": body.get("username")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def ig_post(image_url: str, caption: str = "") -> Dict[str, Any]:
    """Instagram Graph API publishes via a container + publish cycle. Needs a hosted image URL."""
    token = config.get("FB_PAGE_ACCESS_TOKEN")
    ig_id = config.get("IG_USER_ID")
    if not token or not ig_id:
        return {"ok": False, "error": "FB_PAGE_ACCESS_TOKEN / IG_USER_ID not configured"}
    try:
        # 1) create media container
        c = requests.post(
            f"{GRAPH}/{ig_id}/media",
            data={"image_url": image_url, "caption": caption},
            headers=_fb_headers(),
            timeout=30,
        ).json()
        cid = c.get("id")
        if not cid:
            return {"ok": False, "error": c.get("error", {}).get("message", "no container id")}
        # 2) publish
        p = requests.post(
            f"{GRAPH}/{ig_id}/media_publish",
            data={"creation_id": cid},
            headers=_fb_headers(),
            timeout=30,
        ).json()
        if p.get("id"):
            return {"ok": True, "id": p.get("id")}
        return {"ok": False, "error": p.get("error", {}).get("message", "publish failed")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def ig_feeds(limit: int = 10) -> Dict[str, Any]:
    token = config.get("FB_PAGE_ACCESS_TOKEN")
    ig_id = config.get("IG_USER_ID")
    if not token or not ig_id:
        return {"ok": False, "error": "FB_PAGE_ACCESS_TOKEN / IG_USER_ID not configured"}
    try:
        resp = requests.get(
            f"{GRAPH}/{ig_id}/media",
            params={"fields": "id,caption,media_url,permalink,timestamp", "limit": limit},
            headers=_fb_headers(),
            timeout=30,
        )
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("error", {}).get("message", resp.text)}
        items = [
            {
                "id": d.get("id"),
                "text": d.get("caption"),
                "media_url": d.get("media_url"),
                "url": d.get("permalink"),
                "created_at": d.get("timestamp"),
            }
            for d in body.get("data", [])
        ]
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ───────────────────────────────── TikTok ─────────────────────────────────────
# TikTok Content Posting API (video). Requires an Open/Business account + an app
# registered in the TikTok Developer Portal with the Video Upload/Publish scopes.
TIKTOK = "https://open.tiktokapis.com/v2"


def _tt_headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {config.get('TIKTOK_ACCESS_TOKEN')}"}


def tt_verify() -> Dict[str, Any]:
    tok = config.get("TIKTOK_ACCESS_TOKEN")
    if not tok:
        return {"ok": False, "error": "TIKTOK_ACCESS_TOKEN not configured"}
    try:
        resp = requests.post(
            f"{TIKTOK}/oauth/check_token/",
            headers=_tt_headers(),
            data={"grant_type": "client_credentials"},
            timeout=30,
        )
        if resp.ok:
            return {"ok": True, "scope": resp.json().get("scope")}
        # check_token unsupported for this token type; fall back to listing videos
        r2 = requests.post(f"{TIKTOK}/video/list/", headers=_tt_headers(),
                           json={"filters": {"video_ids": []}}, timeout=30)
        if r2.ok:
            return {"ok": True}
        body = r2.json()
        return {"ok": False, "error": body.get("error", {}).get("message", r2.text)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def tt_post(video_url: str, caption: str = "", privacy: str = "SELF_ONLY") -> Dict[str, Any]:
    """Publish a video by public URL. Two-step: init (upload) -> publish."""
    tok = config.get("TIKTOK_ACCESS_TOKEN")
    if not tok:
        return {"ok": False, "error": "TIKTOK_ACCESS_TOKEN not configured"}
    try:
        init = requests.post(
            f"{TIKTOK}/video/init/",
            headers=_tt_headers(),
            json={"source": "PULL_FROM_URL", "video_url": video_url},
            timeout=30,
        ).json()
        vid = init.get("data", {}).get("video_id")
        if not vid:
            return {"ok": False, "error": init.get("error", {}).get("message", "no video_id from init")}
        pub = requests.post(
            f"{TIKTOK}/video/publish/",
            headers=_tt_headers(),
            json={"video_id": vid, "post_info": {"title": caption, "privacy_level": privacy}},
            timeout=30,
        ).json()
        pid = pub.get("data", {}).get("publish_id")
        if pid:
            return {"ok": True, "publish_id": pid}
        return {"ok": False, "error": pub.get("error", {}).get("message", "publish failed")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def tt_feeds(limit: int = 10) -> Dict[str, Any]:
    tok = config.get("TIKTOK_ACCESS_TOKEN")
    if not tok:
        return {"ok": False, "error": "TIKTOK_ACCESS_TOKEN not configured"}
    try:
        resp = requests.post(
            f"{TIKTOK}/video/list/",
            headers=_tt_headers(),
            json={"filters": {"video_ids": []}, "max_count": limit},
            timeout=30,
        )
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("error", {}).get("message", resp.text)}
        items = [
            {"id": d.get("id"), "text": d.get("video_description"), "url": d.get("share_url"), "created_at": d.get("create_time")}
            for d in body.get("data", {}).get("videos", [])
        ]
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ───────────────────────────────── Twitch ────────────────────────────────────
# Twitch Helix + chat. Requires a registered app (Client ID + Secret) and an
# OAuth token with the scopes you want (chat:read, chat:edit, channel:manage:*).
TWITCH = "https://api.twitch.tv/helix"


def _twitch_headers() -> Dict[str, str]:
    return {
        "Client-Id": config.get("TWITCH_CLIENT_ID"),
        "Authorization": f"Bearer {config.get('TWITCH_ACCESS_TOKEN')}",
    }


def twitch_verify() -> Dict[str, Any]:
    cid = config.get("TWITCH_CLIENT_ID")
    tok = config.get("TWITCH_ACCESS_TOKEN")
    if not cid or not tok:
        return {"ok": False, "error": "TWITCH_CLIENT_ID / TWITCH_ACCESS_TOKEN not configured"}
    try:
        resp = requests.get(f"{TWITCH}/users", headers=_twitch_headers(), timeout=30)
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("message", resp.text)}
        d = (body.get("data") or [{}])[0]
        return {"ok": True, "login": d.get("login"), "display_name": d.get("display_name")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def twitch_chat(message: str, channel: str = "") -> Dict[str, Any]:
    """Send a chat message as the authenticated user. Needs chat:edit scope."""
    cid = config.get("TWITCH_CLIENT_ID")
    tok = config.get("TWITCH_ACCESS_TOKEN")
    if not cid or not tok:
        return {"ok": False, "error": "TWITCH_CLIENT_ID / TWITCH_ACCESS_TOKEN not configured"}
    try:
        me = requests.get(f"{TWITCH}/users", headers=_twitch_headers(), timeout=30).json()
        me_id = (me.get("data") or [{}])[0].get("id")
        target = channel or (me.get("data") or [{}])[0].get("login", "")
        b = requests.get(f"{TWITCH}/users", params={"login": target}, headers=_twitch_headers(), timeout=30).json()
        broadcaster_id = (b.get("data") or [{}])[0].get("id")
        if not broadcaster_id:
            return {"ok": False, "error": f"could not resolve channel '{target}'"}
        r = requests.post(
            f"{TWITCH}/chat/messages",
            headers=_twitch_headers(),
            json={"broadcaster_id": broadcaster_id, "sender_id": me_id, "message": message},
            timeout=30,
        )
        body = r.json()
        if not r.ok:
            return {"ok": False, "error": body.get("message", r.text)}
        return {"ok": True, "id": (body.get("data") or [{}])[0].get("message_id")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def twitch_set_title(title: str, category: str = "") -> Dict[str, Any]:
    """Update the authenticated broadcaster's stream title (and optional category)."""
    cid = config.get("TWITCH_CLIENT_ID")
    tok = config.get("TWITCH_ACCESS_TOKEN")
    if not cid or not tok:
        return {"ok": False, "error": "TWITCH_CLIENT_ID / TWITCH_ACCESS_TOKEN not configured"}
    try:
        me = requests.get(f"{TWITCH}/users", headers=_twitch_headers(), timeout=30).json()
        uid = (me.get("data") or [{}])[0].get("id")
        body = {"broadcaster_id": uid, "title": title}
        if category:
            g = requests.get(f"{TWITCH}/games", params={"name": category}, headers=_twitch_headers(), timeout=30).json()
            gid = (g.get("data") or [{}])[0].get("id")
            if gid:
                body["game_id"] = gid
        r = requests.patch(f"{TWITCH}/channels", headers=_twitch_headers(), json=body, timeout=30)
        if not r.ok:
            return {"ok": False, "error": r.json().get("message", r.text)}
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def twitch_feeds(limit: int = 10) -> Dict[str, Any]:
    cid = config.get("TWITCH_CLIENT_ID")
    tok = config.get("TWITCH_ACCESS_TOKEN")
    if not cid or not tok:
        return {"ok": False, "error": "TWITCH_CLIENT_ID / TWITCH_ACCESS_TOKEN not configured"}
    try:
        me = requests.get(f"{TWITCH}/users", headers=_twitch_headers(), timeout=30).json()
        uid = (me.get("data") or [{}])[0].get("id")
        resp = requests.get(f"{TWITCH}/channels/followers", params={"broadcaster_id": uid, "first": limit}, headers=_twitch_headers(), timeout=30)
        body = resp.json()
        if not resp.ok:
            return {"ok": False, "error": body.get("message", resp.text)}
        items = [
            {"id": d.get("user_id"), "text": f"{d.get('user_name')} followed", "created_at": d.get("followed_at")}
            for d in body.get("data", [])
        ]
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}
