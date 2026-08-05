"""Drafts, scheduled posts, and the scheduler thread.

State lives in ~/.config/social/drafts.json — plain JSON, no DB, survives
restarts. The scheduler runs inside the server process: one daemon thread that
wakes every 20s, fires anything due, and records the per-platform result on the
draft itself so the UI can show what happened.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List

STATE_DIR = os.path.expanduser("~/.config/social")
STATE_PATH = os.path.join(STATE_DIR, "drafts.json")

_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> Dict[str, Any]:
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    data.setdefault("drafts", [])
    return data


def _save(data: Dict[str, Any]) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, STATE_PATH)


def list_drafts(status: str = "") -> Dict[str, Any]:
    with _lock:
        items = _load()["drafts"]
    if status:
        items = [d for d in items if d.get("status") == status]
    items.sort(key=lambda d: d.get("scheduled_at") or d.get("updated_at") or "", reverse=True)
    return {"ok": True, "items": items}


def save_draft(body: Dict[str, Any]) -> Dict[str, Any]:
    """Create or update. Pass id to update; omit to create."""
    did = body.get("id")
    with _lock:
        data = _load()
        drafts: List[Dict[str, Any]] = data["drafts"]
        rec = next((d for d in drafts if d["id"] == did), None) if did else None
        if rec is None:
            rec = {"id": uuid.uuid4().hex[:12], "created_at": _now(), "status": "draft", "results": {}}
            drafts.append(rec)
        for k in ("text", "platforms", "subreddit", "title", "image_url", "video_url", "channel", "url"):
            if k in body:
                rec[k] = body[k]
        sched = body.get("scheduled_at")
        if sched is not None:
            rec["scheduled_at"] = sched or None
            rec["status"] = "scheduled" if sched else "draft"
        if body.get("status"):
            rec["status"] = body["status"]
        rec["updated_at"] = _now()
        _save(data)
        return {"ok": True, "draft": dict(rec)}


def delete_draft(did: str) -> Dict[str, Any]:
    with _lock:
        data = _load()
        before = len(data["drafts"])
        data["drafts"] = [d for d in data["drafts"] if d["id"] != did]
        _save(data)
        return {"ok": len(data["drafts"]) < before, "deleted": before - len(data["drafts"])}


def _due(rec: Dict[str, Any], now_ts: float) -> bool:
    if rec.get("status") != "scheduled" or not rec.get("scheduled_at"):
        return False
    try:
        ts = datetime.fromisoformat(str(rec["scheduled_at"]).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.timestamp() <= now_ts
    except ValueError:
        return False


def fire_due(sender: Callable[[Dict[str, Any]], Dict[str, Any]]) -> List[str]:
    """Send every scheduled draft whose time has come. `sender` takes the draft
    body and returns {"results": {...}} (i.e. the mass-post function)."""
    fired: List[str] = []
    now_ts = time.time()
    with _lock:
        data = _load()
        due = [d for d in data["drafts"] if _due(d, now_ts)]
        for d in due:
            d["status"] = "sending"
        if due:
            _save(data)
    for rec in due:
        try:
            res = sender(rec)
            results = res.get("results", res)
            ok = any(v.get("ok") for v in results.values() if isinstance(v, dict))
        except Exception as e:  # never let one bad draft kill the loop
            results, ok = {"_error": {"ok": False, "error": str(e)}}, False
        with _lock:
            data = _load()
            for d in data["drafts"]:
                if d["id"] == rec["id"]:
                    d["results"] = results
                    d["status"] = "posted" if ok else "failed"
                    d["sent_at"] = _now()
            _save(data)
        fired.append(rec["id"])
    return fired


def start_scheduler(sender: Callable[[Dict[str, Any]], Dict[str, Any]], interval: int = 20) -> threading.Thread:
    def loop():
        while True:
            try:
                fire_due(sender)
            except Exception:
                pass
            time.sleep(interval)

    t = threading.Thread(target=loop, name="social-scheduler", daemon=True)
    t.start()
    return t
