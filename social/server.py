"""Local HTTP server exposing the social engine as JSON endpoints.

Served on 127.0.0.1:8731. The desktop plugin pane fetches these directly — no
gateway discovery needed, no extra deps (stdlib only). CORS is open to localhost
so the Electron renderer can call it. The pane never sees the secrets; they stay
in ~/.hermes/.env.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from . import config, platforms

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
