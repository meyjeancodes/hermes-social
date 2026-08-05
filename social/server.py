"""Local HTTP server exposing the social engine as JSON endpoints.

Served on 127.0.0.1:8731. The desktop plugin pane fetches these directly — no
gateway discovery needed, no extra deps (stdlib only). CORS is open to localhost
so the Electron renderer can call it. The pane never sees the secrets; they stay
in ~/.hermes/.env.
"""

from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from . import a2a, config, drafts, platforms, sources

HOST = "127.0.0.1"
PORT = 8731


def _status() -> dict:
    config.reload()
    return {"ok": True, "configured": config.configured(), "meta": {"x_username": config.get("X_USERNAME")}, "version": "0.1.0"}


# route table: (method, path) -> callable(body_dict, params) -> dict
def _dispatch(method: str, path: str, body: dict, params: dict) -> dict:
    seg = path.strip("/").split("/")
    if method == "GET" and path in ("", "/"):
        config.reload()
        return _status()
    if method == "GET" and path == "/status":
        config.reload()
        return _status()
    if method == "GET" and path == "/feeds":
        config.reload()
        limit = int(params.get("limit", ["10"])[0])
        platform = params.get("platform", ["all"])[0]
        feed = params.get("feed", [""])[0]
        return _feeds(platform, limit, feed)
    if method == "GET" and path == "/timeline":
        config.reload()
        return _timeline(params)
    if method == "GET" and path == "/inbox":
        config.reload()
        return _inbox(int(params.get("limit", ["30"])[0]))

    # ── agent-to-agent messaging ─────────────────────────────────────────────
    # /a2a/inbox is the one route meant to be reachable by other agents.
    if method == "POST" and path == "/a2a/inbox":
        return a2a.receive(body)
    if method == "GET" and path == "/a2a/identity":
        return {"ok": True, **a2a.identity(), "url": a2a.public_url()}
    if method == "GET" and path == "/a2a/threads":
        return a2a.threads()
    if method == "GET" and path == "/a2a/peers":
        return a2a.list_peers()
    if method == "POST" and path == "/a2a/send":
        return a2a.send(body.get("to", ""), body.get("body", ""),
                        body.get("thread", ""), body.get("url", ""))
    if method == "POST" and path == "/a2a/peers":
        return a2a.add_peer(body.get("address", ""), body.get("url", ""), body.get("name", ""))
    if method == "POST" and path == "/a2a/peers/remove":
        return a2a.remove_peer(body.get("address", ""))
    if method == "POST" and path == "/a2a/read":
        return a2a.mark_read(body.get("thread", ""))
    if method == "POST" and path == "/a2a/identity":
        return a2a.set_identity(body.get("name", ""), body.get("bio", ""))
    if method == "GET" and path == "/a2a/autoreply":
        from . import autoreply
        return autoreply.status()
    if method == "POST" and path == "/a2a/autoreply":
        from . import autoreply
        return autoreply.set_config(body)
    if method == "GET" and path == "/drafts":
        return drafts.list_drafts(params.get("status", [""])[0])
    if method == "POST" and seg and seg[0] == "drafts":
        config.reload()
        if len(seg) > 1 and seg[1] == "delete":
            return drafts.delete_draft(body.get("id", ""))
        if len(seg) > 1 and seg[1] == "send":
            d = next((x for x in drafts.list_drafts()["items"] if x["id"] == body.get("id")), None)
            if not d:
                return {"ok": False, "error": "no such draft"}
            res = _mass_post(d)
            drafts.save_draft({"id": d["id"], "status": "posted"})
            return res
        return drafts.save_draft(body)
    if method == "GET" and path == "/sources":
        return {"ok": True, "sources": _src_prefs()}
    if method == "POST" and seg and seg[0] == "sources":
        return _save_src_prefs(body.get("sources", {}))
    if method == "POST" and seg and seg[0] == "verify":
        config.reload()
        plat = seg[1] if len(seg) > 1 else body.get("platform")
        return _verify(plat)
    if method == "POST" and seg and seg[0] == "settings":
        config.reload()
        platform = body.get("platform")
        return {"ok": True, "configured": config.save_credentials(platform, body.get("creds", {}))}
    if method == "POST" and seg and seg[0] == "post":
        platform = seg[1] if len(seg) > 1 else body.get("platform", "x")
        return _post(platform, body)
    if method == "POST" and seg and seg[0] == "mass":
        config.reload()
        return _mass_post(body)
    if method == "POST" and seg and seg[0] == "reply":
        platform = seg[1] if len(seg) > 1 else body.get("platform")
        return _reply(platform, body)
    if method == "POST" and seg and seg[0] == "chat":
        plat = seg[1] if len(seg) > 1 else body.get("platform")
        if plat == "twitch":
            return platforms.twitch_chat(body.get("text", ""), channel=body.get("channel", ""))
        return {"ok": False, "error": f"chat not supported for {plat}"}
    if method == "POST" and seg and seg[0] == "settitle":
        plat = seg[1] if len(seg) > 1 else body.get("platform")
        if plat == "twitch":
            return platforms.twitch_set_title(body.get("title", ""), category=body.get("category", ""))
        return {"ok": False, "error": f"settitle not supported for {plat}"}
    if method == "POST" and seg and seg[0] == "like":
        return _act("like", seg, body)
    if method == "POST" and seg and seg[0] == "retweet":
        return _act("retweet", seg, body)
    return {"ok": False, "error": "no such route", "path": path}


PUBLIC_SOURCES = ("bluesky", "mastodon", "youtube", "rss", "hn", "reddit")

# in-process feed cache: {(source, limit, key): (fetched_at, payload)}
_CACHE: dict = {}
CACHE_TTL = 90.0

SRC_PREFS_PATH = os.path.expanduser("~/.config/social/sources.json")
SRC_DEFAULTS = {
    "bluesky_handle": "bsky.app",
    "mastodon_instance": "fosstodon.org",
    "youtube_channel_id": "",
    "rss_url": "",
    "subreddit": "",
    "enabled": list(PUBLIC_SOURCES),
}


def _src_prefs() -> dict:
    try:
        with open(SRC_PREFS_PATH, "r", encoding="utf-8") as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        saved = {}
    out = dict(SRC_DEFAULTS)
    out.update({k: v for k, v in saved.items() if k in SRC_DEFAULTS})
    return out


def _save_src_prefs(new: dict) -> dict:
    prefs = _src_prefs()
    prefs.update({k: v for k, v in (new or {}).items() if k in SRC_DEFAULTS})
    os.makedirs(os.path.dirname(SRC_PREFS_PATH), exist_ok=True)
    with open(SRC_PREFS_PATH, "w", encoding="utf-8") as f:
        json.dump(prefs, f, indent=2)
    return {"ok": True, "sources": prefs}


def _public_sections(limit: int, only: list | None = None) -> dict:
    """Fetch every credential-free source, in parallel, with a short TTL cache.

    Without the cache a 60s auto-refresh (plus every filter click) hammers the
    upstreams and Reddit starts returning HTTP 429.
    """
    from concurrent.futures import ThreadPoolExecutor

    p = _src_prefs()
    enabled = only if only is not None else p.get("enabled", list(PUBLIC_SOURCES))
    jobs = {
        "bluesky": lambda: sources.bluesky_feeds(limit, p.get("bluesky_handle", "")),
        "mastodon": lambda: sources.mastodon_feeds(limit, p.get("mastodon_instance", "")),
        "youtube": lambda: sources.youtube_feeds(limit, channel_id=p.get("youtube_channel_id", "")),
        "rss": lambda: sources.rss_feeds(p.get("rss_url", ""), limit),
        "hn": lambda: platforms.hn_feeds(limit),
        "reddit": lambda: platforms.reddit_feeds(limit, subreddit=p.get("subreddit", "") or _get("subreddit")),
    }
    jobs = {k: v for k, v in jobs.items() if k in enabled}
    out: dict = {}
    fetch: dict = {}
    now = time.time()
    for k, fn in jobs.items():
        ck = (k, limit, str(p.get(k + "_handle", "")) + str(p.get("subreddit", "")))
        hit = _CACHE.get(ck)
        if hit and now - hit[0] < CACHE_TTL and hit[1].get("ok"):
            out[k] = hit[1]
        else:
            fetch[k] = (fn, ck)
    if fetch:
        with ThreadPoolExecutor(max_workers=len(fetch)) as ex:
            futs = {k: ex.submit(fn) for k, (fn, _) in fetch.items()}
            for k, fut in futs.items():
                ck = fetch[k][1]
                try:
                    res = fut.result(timeout=30)
                except Exception as e:
                    res = {"ok": False, "error": str(e)}
                if res.get("ok"):
                    _CACHE[ck] = (now, res)
                elif _CACHE.get(ck):
                    # serve the last good payload rather than an empty section
                    res = dict(_CACHE[ck][1])
                    res["stale"] = True
                out[k] = res
    return out


def _timeline(params: dict) -> dict:
    """One merged, reverse-chronological, searchable stream."""
    limit = int(params.get("limit", ["60"])[0])
    per = int(params.get("per", ["15"])[0])
    q = params.get("q", [""])[0]
    only = params.get("sources", [""])[0]
    only_list = [s for s in only.split(",") if s] or None
    sections = _public_sections(per, only_list)
    # authenticated platforms join the stream when configured
    conf = config.configured()
    if (only_list is None or "instagram" in only_list) and conf.get("instagram"):
        sections["instagram"] = platforms.ig_feeds(per)
    if (only_list is None or "facebook" in only_list) and conf.get("facebook"):
        sections["facebook"] = platforms.fb_feeds(per)
    if (only_list is None or "twitch" in only_list) and conf.get("twitch"):
        sections["twitch"] = platforms.twitch_feeds(per)
    merged = sources.merge(sections, query=q, limit=limit)
    merged["sources"] = sorted(sections.keys())
    return merged


def _inbox(limit: int = 30) -> dict:
    """Engagement: mentions/replies/notifications across whatever we can read."""
    from concurrent.futures import ThreadPoolExecutor

    p = _src_prefs()
    conf = config.configured()
    jobs = {}
    if conf.get("x"):
        jobs["x"] = lambda: platforms.x_feeds(limit, feed="mentions")
    if conf.get("twitch"):
        jobs["twitch"] = lambda: platforms.twitch_feeds(limit)  # followers = engagement
    handle = p.get("bluesky_handle", "")
    if handle:
        jobs["bluesky"] = lambda: sources.bluesky_search("@" + handle.lstrip("@"), limit)
    out: dict = {}
    if jobs:
        with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
            futs = {k: ex.submit(fn) for k, fn in jobs.items()}
            for k, fut in futs.items():
                try:
                    out[k] = fut.result(timeout=30)
                except Exception as e:
                    out[k] = {"ok": False, "error": str(e)}
    merged = sources.merge(out, limit=limit)
    merged["sources"] = sorted(out.keys())
    if not out:
        merged["hint"] = "Connect X (mentions) or set a Bluesky handle in Sources to populate the inbox."
    return merged


def _verify(platform: str) -> dict:
    """Live credential check — actually calls the API with current creds."""
    if platform == "x":
        return platforms.x_verify()
    if platform == "reddit":
        return platforms.reddit_verify()
    if platform == "facebook":
        return platforms.fb_verify()
    if platform == "instagram":
        return platforms.ig_verify()
    if platform == "tiktok":
        return platforms.tt_verify()
    if platform == "twitch":
        return platforms.twitch_verify()
    return {"ok": False, "error": f"unknown platform {platform}"}


def _feeds(platform: str, limit: int, feed: str = "") -> dict:
    out: dict = {"ok": True}
    if platform in ("all", "x"):
        out["x"] = platforms.x_feeds(limit, feed=feed or "home")
    if platform in ("all", "reddit"):
        out["reddit"] = platforms.reddit_feeds(limit, subreddit=_get("subreddit"))
    if platform in ("all", "facebook"):
        out["facebook"] = platforms.fb_feeds(limit)
    if platform in ("all", "instagram"):
        out["instagram"] = platforms.ig_feeds(limit)
    if platform in ("all", "tiktok"):
        out["tiktok"] = platforms.tt_feeds(limit)
    if platform in ("all", "twitch"):
        out["twitch"] = platforms.twitch_feeds(limit)
    if platform in ("all", "hn"):
        out["hn"] = platforms.hn_feeds(limit)
    return out


def _get(key: str, default: str = "") -> str:
    import os

    return os.environ.get(key, default)


def _mass_post(body: dict) -> dict:
    """Fan a draft out to every selected, configured platform.
    Uses the API where it works; for X on the free tier (API blocked), returns a
    share-intent link so the user can click-to-post on x.com. Returns per-platform
    results."""
    import urllib.parse

    text = body.get("text", "")
    platforms_sel = body.get("platforms", []) or []
    results = {}
    if not platforms_sel:
        return {"ok": False, "error": "no platforms selected", "results": {}}
    for p in platforms_sel:
        try:
            if p == "x":
                r = platforms.x_post(text)
                if not r.get("ok") and platforms.x_free_tier(str(r.get("error", ""))):
                    results[p] = {
                        "ok": False,
                        "link": platforms.x_share_link(text),
                        "note": "X Free tier blocks API posting — open this link to post on x.com",
                    }
                else:
                    results[p] = r
            elif p == "reddit":
                results[p] = platforms.reddit_post(body.get("subreddit", ""), body.get("title", ""), text=text, url=body.get("url", ""))
            elif p == "facebook":
                results[p] = platforms.fb_post(text)
            elif p == "instagram":
                results[p] = platforms.ig_post(body.get("image_url", ""), caption=text)
            elif p == "tiktok":
                results[p] = platforms.tt_post(body.get("video_url", ""), caption=text)
            elif p == "twitch":
                results[p] = platforms.twitch_chat(text, channel=body.get("channel", ""))
            else:
                results[p] = {"ok": False, "error": f"unknown platform {p}"}
        except Exception as e:
            results[p] = {"ok": False, "error": str(e)}
    return {"ok": True, "results": results}


def _post(platform: str, body: dict) -> dict:
    if platform == "x":
        return platforms.x_post(body.get("text", ""))
    if platform == "reddit":
        return platforms.reddit_post(body.get("subreddit", ""), body.get("title", ""), text=body.get("text", ""), url=body.get("url", ""))
    if platform == "facebook":
        return platforms.fb_post(body.get("text", ""))
    if platform == "instagram":
        return platforms.ig_post(body.get("image_url", ""), caption=body.get("text", ""))
    if platform == "tiktok":
        return platforms.tt_post(body.get("video_url", ""), caption=body.get("text", ""))
    if platform == "twitch":
        # Compose tab sends a chat/title action; default to chat.
        if body.get("action") == "title":
            return platforms.twitch_set_title(body.get("text", ""), category=body.get("category", ""))
        return platforms.twitch_chat(body.get("text", ""), channel=body.get("channel", ""))
    return {"ok": False, "error": f"unknown platform {platform}"}


def _reply(platform: str, body: dict) -> dict:
    if platform == "x":
        return platforms.x_reply(body.get("target_id", ""), body.get("text", ""))
    if platform == "reddit":
        return platforms.reddit_reply(body.get("target_id", ""), body.get("text", ""))
    return {"ok": False, "error": f"reply not supported for {platform}"}


def _act(kind: str, seg: list, body: dict) -> dict:
    target = seg[1] if len(seg) > 1 else body.get("target_id", "")
    if kind == "like":
        return platforms.x_like(target)
    if kind == "retweet":
        return platforms.x_retweet(target)
    return {"ok": False, "error": "unknown action"}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        data = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # quiet
        pass

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        try:
            u = urlparse(self.path)
            params = parse_qs(u.query)
            res = _dispatch("GET", u.path, {}, params)
            self._send(200, res)
        except Exception as e:  # never crash the server
            self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                body = {}
            u = urlparse(self.path)
            params = parse_qs(u.query)
            res = _dispatch("POST", u.path, body, params)
            self._send(200, res)
        except Exception as e:
            self._send(500, {"ok": False, "error": str(e)})


def serve(host: str = HOST, port: int = PORT) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer((host, port), Handler)
    # scheduled drafts fire from inside the server process
    drafts.start_scheduler(lambda d: _mass_post(d))
    return srv


def main(argv=None) -> None:
    import argparse
    import sys

    ap = argparse.ArgumentParser(prog="social-serve")
    ap.add_argument("--host", default=HOST)
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args(argv if argv is not None else sys.argv[1:])
    srv = serve(args.host, args.port)
    print(f"Hermes Social server on http://{args.host}:{args.port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
