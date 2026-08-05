"""Hermes Space — a Myspace-style community for Hermes Agent fans.

A small self-contained social network: profiles (nick + bio + a "song", old-Myspace
style), a global feed of posts (shit-posts, Hermes talk), and an inline music player
that plays the poster's song. Data is persisted to a single JSON file so it survives
restarts. This is separate from the multi-platform hub — it's its own community.

Requested by Teknium: music capability like old Myspace, a place to hang out and talk
about Hermes Agent.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

SPACE_FILE = Path.home() / ".hermes" / "social-space.json"

# In-memory store; loaded from disk on first import.
_state: Dict[str, Any] = {"users": {}, "posts": []}


def _load() -> None:
    global _state
    if SPACE_FILE.exists():
        try:
            _state = json.loads(SPACE_FILE.read_text(encoding="utf-8"))
            _state.setdefault("users", {})
            _state.setdefault("posts", [])
        except Exception:
            pass


def _save() -> None:
    SPACE_FILE.parent.mkdir(parents=True, exist_ok=True)
    SPACE_FILE.write_text(json.dumps(_state, indent=2), encoding="utf-8")


def _uid() -> str:
    return uuid.uuid4().hex[:10]


def _yt_id(url: str) -> str:
    """Extract a YouTube video id from a URL, or return the raw string if it looks like an id."""
    if not url:
        return ""
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([\w-]{11})", url)
    if m:
        return m.group(1)
    m = re.search(r"^[\w-]{11}$", url.strip())
    return m.group(1) if m else url.strip()


# ── users / profiles ───────────────────────────────────────────────────────────
def ensure_user(nick: str, bio: str = "", song: str = "") -> Dict[str, Any]:
    _load()
    nick = (nick or "").strip()
    if not nick:
        return {"ok": False, "error": "nick required"}
    uid = None
    for u in _state["users"].values():
        if u["nick"].lower() == nick.lower():
            uid = u["id"]
            break
    if uid is None:
        uid = _uid()
        _state["users"][uid] = {"id": uid, "nick": nick, "bio": bio, "song": song, "joined": int(time.time())}
    else:
        u = _state["users"][uid]
        if bio:
            u["bio"] = bio
        if song:
            u["song"] = song
    _save()
    return {"ok": True, "user": _state["users"][uid]}


def get_users() -> Dict[str, Any]:
    _load()
    return {"ok": True, "users": list(_state["users"].values())}


def get_user(uid: str) -> Dict[str, Any]:
    _load()
    u = _state["users"].get(uid)
    return {"ok": True, "user": u} if u else {"ok": False, "error": "no such user"}


# ── posts / feed ───────────────────────────────────────────────────────────────
def add_post(nick: str, text: str, song: str = "") -> Dict[str, Any]:
    _load()
    nick = (nick or "").strip()
    text = (text or "").strip()
    if not nick:
        return {"ok": False, "error": "nick required"}
    if not text:
        return {"ok": False, "error": "post is empty"}
    uid = None
    for u in _state["users"].values():
        if u["nick"].lower() == nick.lower():
            uid = u["id"]
            break
    if uid is None:
        uid = _uid()
        _state["users"][uid] = {"id": uid, "nick": nick, "bio": "", "song": song, "joined": int(time.time())}
    post = {
        "id": _uid(),
        "uid": uid,
        "nick": nick,
        "text": text,
        "song": song or _state["users"][uid].get("song", ""),
        "ts": int(time.time()),
    }
    _state["posts"].insert(0, post)
    _save()
    return {"ok": True, "post": post}


def get_posts(limit: int = 50, nick: str = "") -> Dict[str, Any]:
    _load()
    posts = _state["posts"]
    if nick:
        posts = [p for p in posts if p["nick"].lower() == nick.lower()]
    return {"ok": True, "posts": posts[:limit]}


# ── helpers exposed for the server layer ─────────────────────────────────────────
def yt_id(url: str) -> str:
    return _yt_id(url)
