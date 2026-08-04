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
    err = proc.stderr.strip()
    if proc.returncode != 0:
        return {"ok": False, "error": err or f"x-cli exited {proc.returncode}"}
    try:
        return {"ok": True, "data": json.loads(out)}
    except json.JSONDecodeError:
        return {"ok": True, "raw": out}


def x_post(text: str) -> Dict[str, Any]:
    return _x_cli(["tweet", "post", text])


def x_reply(tweet_id: str, text: str) -> Dict[str, Any]:
    return _x_cli(["tweet", "reply", tweet_id, text])


def x_like(tweet_id: str) -> Dict[str, Any]:
    return _x_cli(["like", tweet_id])


def x_retweet(tweet_id: str) -> Dict[str, Any]:
    return _x_cli(["retweet", tweet_id])


def x_feeds(limit: int = 10) -> Dict[str, Any]:
    mentions = _x_cli(["me", "mentions", "--max", str(limit)])
    if not mentions.get("ok"):
        return mentions
    data = mentions.get("data")
    items = data if isinstance(data, list) else (data.get("data") if isinstance(data, dict) else [])
    out = []
    for it in items or []:
        out.append(
            {
                "id": str(it.get("id")),
                "author": (it.get("author") or {}).get("username") if isinstance(it.get("author"), dict) else it.get("author"),
                "text": it.get("text"),
                "created_at": it.get("created_at"),
            }
        )
    return {"ok": True, "items": out}


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
