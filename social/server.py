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
    if method == "GET" and path == "/a2a/discover":
        from . import discovery
        return discovery.peers()
    if method == "POST" and path == "/a2a/discover":
        from . import discovery
        if body.get("action") == "stop":
            return discovery.stop()
        return discovery.start(RUNNING_PORT, RUNNING_HOST)
    # One-click connect: verify the peer is actually reachable and that its
    # identity matches what was advertised, then save it. Beats pasting URLs.
    if method == "POST" and path == "/a2a/connect":
        return _connect(body.get("address", ""), body.get("url", ""), body.get("name", ""))
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
# Curated starting set. These are the feeds the project was actually built
# against — robotics/AI/embedded — rather than generic placeholders, and each
# field takes a LIST so several feeds of the same kind all reach the timeline.
SRC_DEFAULTS = {
    "bluesky_handles": ["bsky.app"],
    "mastodon_instance": "fosstodon.org",
    "youtube_channels": [],
    "rss_urls": [
        "https://feeds.arstechnica.com/arstechnica/index",
        "https://spectrum.ieee.org/feeds/topic/robotics.rss",
        "https://www.therobotreport.com/feed/",
    ],
    "subreddits": ["robotics", "embedded"],
    "enabled": list(PUBLIC_SOURCES),
}

# Older configs stored a single value per source; migrate them to lists so an
# existing install keeps its feeds instead of silently reverting to defaults.
_LEGACY = {
    "bluesky_handle": "bluesky_handles",
    "rss_url": "rss_urls",
    "subreddit": "subreddits",
    "youtube_channel_id": "youtube_channels",
}


def _as_list(v) -> list:
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    return [str(v).strip()] if str(v or "").strip() else []


def _src_prefs() -> dict:
    try:
        with open(SRC_PREFS_PATH, "r", encoding="utf-8") as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        saved = {}
    out = dict(SRC_DEFAULTS)
    # Carry legacy single-value keys over to their list equivalents.
    for old, new in _LEGACY.items():
        if old in saved and saved[old]:
            merged = _as_list(saved.get(new)) or []
            for v in _as_list(saved[old]):
                if v not in merged:
                    merged.append(v)
            out[new] = merged
    out.update({k: v for k, v in saved.items() if k in SRC_DEFAULTS})
    # mastodon.social started requiring auth for public timelines; a saved
    # pref pointing there yields an empty Mastodon section forever.
    if out.get("mastodon_instance") in ("mastodon.social", "", None):
        out["mastodon_instance"] = SRC_DEFAULTS["mastodon_instance"]
    for key in ("bluesky_handles", "rss_urls", "subreddits", "youtube_channels"):
        out[key] = _as_list(out.get(key))
    return out


def _save_src_prefs(new: dict) -> dict:
    prefs = _src_prefs()
    for k, v in (new or {}).items():
        if k not in SRC_DEFAULTS:
            continue
        prefs[k] = _as_list(v) if isinstance(SRC_DEFAULTS[k], list) and k != "enabled" else v
    os.makedirs(os.path.dirname(SRC_PREFS_PATH), exist_ok=True)
    with open(SRC_PREFS_PATH, "w", encoding="utf-8") as f:
        json.dump(prefs, f, indent=2)
    return {"ok": True, "sources": prefs}


def _safe(fn, n: int) -> dict:
    """Run one feed fetcher, turning any exception into an error payload."""
    try:
        return fn(n)
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _feed_cached(key: tuple, fn, n: int) -> dict:
    """Per-feed cache. Caching whole sources meant one subreddit's 429 threw
    away the other subreddits' good results too; keyed per feed, each one keeps
    its own last-good payload and a transient failure costs only that feed."""
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < CACHE_TTL and hit[1].get("ok"):
        return hit[1]
    res = _safe(fn, n)
    if res.get("ok"):
        _CACHE[key] = (now, res)
    elif hit:
        stale = dict(hit[1])
        stale["stale"] = True
        return stale
    return res


def _public_sections(limit: int, only: list | None = None) -> dict:
    """Fetch every credential-free source, in parallel, with a short TTL cache.

    Without the cache a 60s auto-refresh (plus every filter click) hammers the
    upstreams and Reddit starts returning HTTP 429.
    """
    from concurrent.futures import ThreadPoolExecutor

    p = _src_prefs()
    enabled = only if only is not None else p.get("enabled", list(PUBLIC_SOURCES))

    # Each source may have several feeds configured; fan out over all of them
    # and merge, so every feed the user added actually reaches the timeline.
    def multi(src: str, fetchers, serial: bool = False):
        def run():
            from concurrent.futures import ThreadPoolExecutor as _TPE

            items, errs = [], []
            n = max(1, len(fetchers))
            share = max(3, (limit + n - 1) // n)
            keyed = [((src, tag, share), fn) for tag, fn in fetchers]
            if serial:
                # Reddit refuses concurrent requests from one IP (every parallel
                # call 429s), so its feeds are fetched one at a time, spaced out.
                results = []
                for i, (k, fn) in enumerate(keyed):
                    if i:
                        time.sleep(1.2)
                    results.append(_feed_cached(k, fn, share))
            else:
                with _TPE(max_workers=min(n, 6)) as ex:
                    results = list(ex.map(lambda kf: _feed_cached(kf[0], kf[1], share), keyed))
            for r in results:
                if r.get("ok"):
                    items.extend(r.get("items", [])[:share])
                elif r.get("error"):
                    errs.append(str(r["error"]))
            if items:
                return {"ok": True, "items": items}
            return {"ok": False, "error": "; ".join(e for e in errs if e)[:300] or "no items"}
        return run

    handles = p.get("bluesky_handles") or [""]
    subs = p.get("subreddits") or [""]
    rsses = p.get("rss_urls") or []
    chans = p.get("youtube_channels") or []

    jobs = {
        "bluesky": multi("bluesky", [(hh, lambda n, hh=hh: sources.bluesky_feeds(n, hh)) for hh in handles]),
        "mastodon": lambda: sources.mastodon_feeds(limit, p.get("mastodon_instance", "")),
        "youtube": multi("youtube", [(c, lambda n, c=c: sources.youtube_feeds(n, channel_id=c)) for c in chans]),
        "rss": multi("rss", [(u, lambda n, u=u: sources.rss_feeds(u, n)) for u in rsses]),
        "hn": lambda: platforms.hn_feeds(limit),
        "reddit": multi("reddit", [(s, lambda n, s=s: platforms.reddit_feeds(n, subreddit=s)) for s in subs], serial=True),
    }
    # A source with nothing configured is simply not part of this timeline —
    # better than surfacing a 404 from an empty channel id.
    if not chans:
        jobs.pop("youtube", None)
    if not rsses:
        jobs.pop("rss", None)
    jobs = {k: v for k, v in jobs.items() if k in enabled}
    out: dict = {}
    if not jobs:
        return out
    # Caching now happens per feed inside multi(), so sources just run in
    # parallel here; a slow source no longer delays the others.
    with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        futs = {k: ex.submit(fn) for k, fn in jobs.items()}
        for k, fut in futs.items():
            try:
                out[k] = fut.result(timeout=60)
            except Exception as e:
                out[k] = {"ok": False, "error": str(e)}
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


def _connect(address: str, url: str, name: str = "") -> dict:
    """Verify a peer before saving it, so a saved peer is a working peer.

    Connecting used to mean pasting an address and a URL and hoping. Here we
    actually call the peer's /a2a/identity and refuse the connection unless it
    answers AND the address it reports matches the one being connected to —
    which catches typos, dead hosts, stale discovery entries, and a host
    claiming to be an agent it isn't.
    """
    import requests

    url = (url or "").strip().rstrip("/")
    address = (address or "").strip()
    if not url:
        return {"ok": False, "error": "a URL is required"}
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    try:
        r = requests.get(url + "/a2a/identity", timeout=8)
        who = r.json()
    except Exception as e:
        return {"ok": False, "error": f"could not reach {url}: {e}"}
    if not who.get("address"):
        return {"ok": False, "error": f"{url} did not answer as a Hermes agent"}
    if address and who["address"] != address:
        return {"ok": False, "error":
                f"identity mismatch: {url} is {who['address']}, not {address}"}
    a2a.add_peer(who["address"], url, name or who.get("name", ""))
    return {"ok": True, "peer": {"address": who["address"], "url": url,
                                 "name": name or who.get("name", "")}}


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
    handle = (p.get("bluesky_handles") or [""])[0]
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


RUNNING_PORT = PORT
RUNNING_HOST = HOST


def serve(host: str = HOST, port: int = PORT) -> ThreadingHTTPServer:
    global RUNNING_PORT, RUNNING_HOST
    RUNNING_PORT, RUNNING_HOST = port, host
    srv = ThreadingHTTPServer((host, port), Handler)
    # scheduled drafts fire from inside the server process
    drafts.start_scheduler(lambda d: _mass_post(d))
    # Announce on the LAN so other agents can find us without exchanging
    # addresses by hand. Failure here is never fatal — discovery is a bonus.
    try:
        from . import discovery
        discovery.start(port, host)
    except Exception:
        pass
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
