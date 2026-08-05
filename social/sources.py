"""Credential-free public sources + a unified normalizer.

Every function returns {"ok": bool, "items": [...]} where an item is:
    {id, source, author, title, text, url, created_at, score, num_comments}

No API keys anywhere in this module — Bluesky's public AppView, Mastodon's
public instance API, YouTube channel RSS and plain RSS/Atom all work anonymous.
"""

from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List

import requests

UA = {"User-Agent": "hermes-social/0.2 (+local)"}
TIMEOUT = 20


def _id(*parts: str) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _item(**kw) -> Dict[str, Any]:
    base = {
        "id": "", "source": "", "author": "", "title": "", "text": "",
        "url": "", "created_at": "", "score": None, "num_comments": None,
        "media_url": "", "kind": "post",
    }
    base.update(kw)
    if not base["id"]:
        base["id"] = _id(base["source"], base["url"], base["title"], base["text"][:80])
    return base


# ───────────────────────────────── Bluesky ────────────────────────────────────
BSKY = "https://public.api.bsky.app/xrpc"
# public.api.bsky.app 403s on searchPosts; api.bsky.app serves it anonymously.
BSKY_SEARCH = "https://api.bsky.app/xrpc"


def bluesky_feeds(limit: int = 15, handle: str = "") -> Dict[str, Any]:
    """Public author feed (no auth). Default: Bluesky's discover-ish safe pick."""
    handle = (handle or "bsky.app").lstrip("@")
    try:
        r = requests.get(
            f"{BSKY}/app.bsky.feed.getAuthorFeed",
            params={"actor": handle, "limit": min(limit, 50)},
            headers=UA, timeout=TIMEOUT,
        )
        if not r.ok:
            return {"ok": False, "error": f"bluesky HTTP {r.status_code}: {r.text[:160]}"}
        items = []
        for f in r.json().get("feed", []):
            p = f.get("post", {})
            rec = p.get("record", {}) or {}
            a = p.get("author", {}) or {}
            uri = p.get("uri", "")
            rkey = uri.rsplit("/", 1)[-1] if uri else ""
            items.append(_item(
                source="bluesky",
                author=a.get("handle", ""),
                title=a.get("displayName", "") or a.get("handle", ""),
                text=rec.get("text", ""),
                url=f"https://bsky.app/profile/{a.get('handle','')}/post/{rkey}" if rkey else "",
                created_at=rec.get("createdAt", ""),
                score=p.get("likeCount"),
                num_comments=p.get("replyCount"),
            ))
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def bluesky_search(q: str, limit: int = 15) -> Dict[str, Any]:
    last = ""
    for base in (BSKY_SEARCH, BSKY):
        try:
            r = requests.get(f"{base}/app.bsky.feed.searchPosts",
                             params={"q": q, "limit": min(limit, 50)}, headers=UA, timeout=TIMEOUT)
            if not r.ok:
                last = f"HTTP {r.status_code}"
                continue
            items = []
            for p in r.json().get("posts", []):
                rec = p.get("record", {}) or {}
                a = p.get("author", {}) or {}
                rkey = p.get("uri", "").rsplit("/", 1)[-1]
                items.append(_item(source="bluesky", author=a.get("handle", ""),
                                   title=a.get("displayName", ""), text=rec.get("text", ""),
                                   url=f"https://bsky.app/profile/{a.get('handle','')}/post/{rkey}",
                                   created_at=rec.get("createdAt", ""),
                                   score=p.get("likeCount"), num_comments=p.get("replyCount")))
            return {"ok": True, "items": items}
        except Exception as e:
            last = str(e)
    return {"ok": False, "error": f"bluesky search failed ({last})"}


# ───────────────────────────────── Mastodon ───────────────────────────────────
MASTODON_FALLBACKS = ("fosstodon.org", "mstdn.social", "hachyderm.io", "techhub.social")


def mastodon_feeds(limit: int = 15, instance: str = "fosstodon.org") -> Dict[str, Any]:
    """Public local timeline of any instance — no token needed.

    NOTE: mastodon.social now requires auth for /timelines/public, so the
    default is an open instance and we fall through the list on 401/422.
    """
    first = (instance or "").replace("https://", "").strip("/")
    tries = [first] if first and first != "mastodon.social" else []
    tries += [i for i in MASTODON_FALLBACKS if i not in tries]
    last = "no instance reachable"
    for inst in tries:
        try:
            r = requests.get(f"https://{inst}/api/v1/timelines/public",
                             params={"limit": min(limit, 40), "local": "true"},
                             headers=UA, timeout=TIMEOUT)
            if not r.ok:
                last = f"{inst}: HTTP {r.status_code}"
                continue
            items = []
            for s in r.json():
                acct = s.get("account", {}) or {}
                items.append(_item(
                    source="mastodon",
                    author=(acct.get("acct", "") + "@" + inst) if "@" not in acct.get("acct", "") else acct.get("acct", ""),
                    title=acct.get("display_name", ""),
                    text=_strip_html(s.get("content", "")),
                    url=s.get("url", ""),
                    created_at=s.get("created_at", ""),
                    score=s.get("favourites_count"),
                    num_comments=s.get("replies_count"),
                    media_url=(s.get("media_attachments") or [{}])[0].get("preview_url", ""),
                ))
            return {"ok": True, "items": items, "instance": inst}
        except Exception as e:
            last = f"{inst}: {e}"
    return {"ok": False, "error": f"mastodon unavailable ({last})"}


def _strip_html(s: str) -> str:
    import re
    s = re.sub(r"<br\s*/?>", "\n", s or "")
    s = re.sub(r"</p>", "\n\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    import html as _h
    return _h.unescape(s).strip()


# ───────────────────────────────── YouTube ────────────────────────────────────
def youtube_feeds(limit: int = 15, channel_id: str = "", user: str = "") -> Dict[str, Any]:
    """Channel uploads via the public RSS endpoint (no API key, no quota)."""
    if channel_id:
        url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    elif user:
        url = f"https://www.youtube.com/feeds/videos.xml?user={user}"
    else:
        return {"ok": False, "error": "set a YouTube channel_id (UC…) in Sources"}
    return _atom(url, "youtube", limit)


# ───────────────────────────────── generic RSS ────────────────────────────────
def rss_feeds(url: str, limit: int = 15, source: str = "rss") -> Dict[str, Any]:
    if not url:
        return {"ok": False, "error": "no RSS URL set"}
    return _atom(url, source, limit)


def _atom(url: str, source: str, limit: int) -> Dict[str, Any]:
    try:
        r = requests.get(url, headers=UA, timeout=TIMEOUT)
        if not r.ok:
            return {"ok": False, "error": f"{source} HTTP {r.status_code}"}
        root = ET.fromstring(r.content)
        ns = {"a": "http://www.w3.org/2005/Atom", "m": "http://search.yahoo.com/mrss/"}
        items: List[Dict[str, Any]] = []
        # Atom
        for e in root.findall(".//a:entry", ns)[:limit]:
            link = e.find("a:link", ns)
            thumb = e.find(".//m:thumbnail", ns)
            items.append(_item(
                source=source,
                title=_txt(e.find("a:title", ns)),
                author=_txt(e.find("a:author/a:name", ns)),
                text=_txt(e.find(".//m:description", ns)),
                url=(link.get("href") if link is not None else ""),
                created_at=_txt(e.find("a:published", ns)) or _txt(e.find("a:updated", ns)),
                media_url=(thumb.get("url") if thumb is not None else ""),
            ))
        if items:
            return {"ok": True, "items": items}
        # RSS 2.0
        for it in root.findall(".//item")[:limit]:
            items.append(_item(
                source=source,
                title=_txt(it.find("title")),
                author=_txt(it.find("{http://purl.org/dc/elements/1.1/}creator")) or _txt(it.find("author")),
                text=_strip_html(_txt(it.find("description")))[:600],
                url=_txt(it.find("link")),
                created_at=_txt(it.find("pubDate")),
            ))
        return {"ok": True, "items": items}
    except ET.ParseError as e:
        return {"ok": False, "error": f"{source}: not valid RSS/Atom ({e})"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _txt(node) -> str:
    return (node.text or "").strip() if node is not None else ""


# ─────────────────────────── unified + normalization ──────────────────────────
def parse_time(v: Any) -> float:
    """Best-effort epoch seconds from the many shapes upstream APIs return."""
    if v in (None, "", 0):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s.isdigit():
        return float(s)
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ",
                "%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z"):
        try:
            dt = datetime.strptime(s.replace("+00:00", "+0000"), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def normalize(source: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce any platform item (legacy platforms.py shapes included) to the
    unified item shape so one timeline can hold them all."""
    m = raw.get("metrics") or {}
    return _item(
        id=str(raw.get("id") or ""),
        source=source,
        author=raw.get("author") or raw.get("author_name") or "",
        title=raw.get("title") or raw.get("author_name") or "",
        text=raw.get("text") or raw.get("title") or "",
        url=raw.get("url") or "",
        created_at=raw.get("created_at") or "",
        score=raw.get("score", m.get("like_count")),
        num_comments=raw.get("num_comments", m.get("reply_count")),
        media_url=raw.get("media_url") or "",
        kind=raw.get("kind", "post"),
    )


def merge(sections: Dict[str, Dict[str, Any]], query: str = "", limit: int = 60) -> Dict[str, Any]:
    """Flatten {source: {ok, items}} into one reverse-chronological timeline."""
    out: List[Dict[str, Any]] = []
    errors: Dict[str, str] = {}
    q = (query or "").lower().strip()
    for src, sec in sections.items():
        if not isinstance(sec, dict):
            continue
        if not sec.get("ok"):
            if sec.get("error"):
                errors[src] = str(sec["error"])
            continue
        for raw in sec.get("items", []):
            it = normalize(src, raw)
            if q and q not in (it["text"] + " " + it["title"] + " " + it["author"]).lower():
                continue
            it["ts"] = parse_time(it["created_at"])
            out.append(it)
    out.sort(key=lambda i: i.get("ts", 0), reverse=True)
    return {"ok": True, "items": out[:limit], "errors": errors, "count": len(out)}
