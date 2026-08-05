"""Agent-to-agent messaging: identity, signing, and a local message store.

Design goals, in order:

1. No central server. Each Hermes runs this locally and agents POST directly to
   each other's /a2a/inbox. Two agents on a LAN, or reachable over a tunnel, can
   talk with nothing in between.
2. No shared secret to distribute. Identity is an Ed25519 keypair generated on
   first use. Your address IS your public key fingerprint, so there is nothing
   to register and nothing to revoke centrally.
3. Every message is signed. An inbound message is only accepted if the signature
   verifies against the sender's claimed public key, which makes spoofing another
   agent's address require their private key.

What this deliberately does NOT do: encryption. Messages are signed (you know who
sent it and that it wasn't altered) but not sealed (a network observer can read
them). Bind to localhost or run it behind a tunnel you trust. Saying that plainly
here so nobody assumes more privacy than they're getting.
"""

from __future__ import annotations

import base64
import json
import os
import time
import uuid
from typing import Any, Dict, List

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

A2A_DIR = os.path.expanduser("~/.config/social/a2a")
KEY_PATH = os.path.join(A2A_DIR, "identity.key")
PROFILE_PATH = os.path.join(A2A_DIR, "identity.json")
MSG_PATH = os.path.join(A2A_DIR, "messages.json")
PEERS_PATH = os.path.join(A2A_DIR, "peers.json")

# Messages older than this are pruned so the store can't grow without bound.
MAX_MESSAGES = 2000
# Reject messages whose timestamp is too far off — limits replay of captured ones.
CLOCK_SKEW_SEC = 300


def _ensure_dir() -> None:
    os.makedirs(A2A_DIR, mode=0o700, exist_ok=True)


def _read(path: str, default):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return default


def _write(path: str, data) -> None:
    _ensure_dir()
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)


def b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ── identity ─────────────────────────────────────────────────────────────────

def _load_key() -> Ed25519PrivateKey:
    """Load this agent's signing key, generating one on first use."""
    _ensure_dir()
    if os.path.exists(KEY_PATH):
        with open(KEY_PATH, "rb") as fh:
            loaded = serialization.load_pem_private_key(fh.read(), password=None)
        if not isinstance(loaded, Ed25519PrivateKey):
            raise ValueError("identity.key is not an Ed25519 key")
        return loaded
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    # 0600 before write: the private key must never be group/world readable.
    fd = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(pem)
    return key


def public_key_b64() -> str:
    raw = _load_key().public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return b64e(raw)


def address() -> str:
    """Short, human-quotable form of the public key — this agent's address."""
    return "hx_" + public_key_b64()[:16]


def identity() -> Dict[str, Any]:
    prof = _read(PROFILE_PATH, {})
    return {
        "address": address(),
        "public_key": public_key_b64(),
        "name": prof.get("name") or "hermes-agent",
        "bio": prof.get("bio", ""),
    }


def set_identity(name: str = "", bio: str = "") -> Dict[str, Any]:
    prof = _read(PROFILE_PATH, {})
    if name:
        prof["name"] = name[:64]
    if bio:
        prof["bio"] = bio[:280]
    _write(PROFILE_PATH, prof)
    return {"ok": True, "identity": identity()}


# ── signing ──────────────────────────────────────────────────────────────────

def _signable(msg: Dict[str, Any]) -> bytes:
    """Canonical bytes for signing.

    Only the fields that constitute the message's meaning are signed, in sorted
    order, so both sides derive identical bytes regardless of dict ordering or
    any transport fields added along the way.
    """
    core = {k: msg.get(k) for k in ("id", "from", "from_key", "to", "body", "ts", "thread", "reply_to")}
    return json.dumps(core, sort_keys=True, separators=(",", ":")).encode()


def sign_message(msg: Dict[str, Any]) -> Dict[str, Any]:
    msg["sig"] = b64e(_load_key().sign(_signable(msg)))
    return msg


def verify_message(msg: Dict[str, Any]) -> tuple[bool, str]:
    """Verify signature, sender-address binding, and freshness."""
    try:
        pub_b64 = msg.get("from_key", "")
        if not pub_b64:
            return False, "missing sender public key"
        # The address must be derived from the key, or a sender could claim to
        # be someone else while signing with their own key.
        if msg.get("from") != "hx_" + pub_b64[:16]:
            return False, "address does not match public key"
        ts = float(msg.get("ts", 0))
        if abs(time.time() - ts) > CLOCK_SKEW_SEC:
            return False, "timestamp outside acceptable window"
        pub = Ed25519PublicKey.from_public_bytes(b64d(pub_b64))
        pub.verify(b64d(msg.get("sig", "")), _signable(msg))
        return True, ""
    except InvalidSignature:
        return False, "bad signature"
    except Exception as e:
        return False, str(e)


# ── message store ────────────────────────────────────────────────────────────

def _load_messages() -> List[Dict[str, Any]]:
    return _read(MSG_PATH, [])


def _save_messages(msgs: List[Dict[str, Any]]) -> None:
    _write(MSG_PATH, msgs[-MAX_MESSAGES:])


def record(msg: Dict[str, Any], direction: str) -> Dict[str, Any]:
    msgs = _load_messages()
    if any(m.get("id") == msg.get("id") for m in msgs):
        return {"ok": True, "duplicate": True}  # replayed or retried delivery
    entry = dict(msg)
    entry["dir"] = direction
    entry["read"] = direction == "out"
    msgs.append(entry)
    _save_messages(msgs)
    return {"ok": True, "id": entry["id"]}


def public_url() -> str:
    """Where peers should send replies. Override when tunnelling/LAN-exposed."""
    return os.environ.get("SOCIAL_A2A_URL", "http://127.0.0.1:8731")


def new_message(to: str, body: str, thread: str = "") -> Dict[str, Any]:
    me = identity()
    msg = {
        "id": uuid.uuid4().hex,
        "from": me["address"],
        "from_key": me["public_key"],
        "from_name": me["name"],
        "to": to,
        "body": body,
        "ts": time.time(),
        "thread": thread or uuid.uuid4().hex[:12],
        "reply_to": public_url(),
    }
    return sign_message(msg)


def threads() -> Dict[str, Any]:
    """Group messages into conversations, newest activity first."""
    msgs = _load_messages()
    peers = {p["address"]: p for p in _read(PEERS_PATH, [])}
    by_thread: Dict[str, Dict[str, Any]] = {}
    for m in msgs:
        t = m.get("thread") or m["id"]
        who = m["to"] if m.get("dir") == "out" else m.get("from", "")
        th = by_thread.setdefault(t, {
            "thread": t, "peer": who,
            "peer_name": peers.get(who, {}).get("name", "") or m.get("from_name", ""),
            "messages": [], "unread": 0, "last_ts": 0,
        })
        th["messages"].append(m)
        if m.get("dir") == "in" and not m.get("read"):
            th["unread"] += 1
        th["last_ts"] = max(th["last_ts"], float(m.get("ts", 0)))
    out = sorted(by_thread.values(), key=lambda t: t["last_ts"], reverse=True)
    for t in out:
        t["messages"].sort(key=lambda m: float(m.get("ts", 0)))
        t["preview"] = (t["messages"][-1].get("body", "") or "")[:120]
    return {"ok": True, "threads": out, "unread": sum(t["unread"] for t in out)}


def mark_read(thread: str) -> Dict[str, Any]:
    msgs = _load_messages()
    n = 0
    for m in msgs:
        if m.get("thread") == thread and m.get("dir") == "in" and not m.get("read"):
            m["read"] = True
            n += 1
    _save_messages(msgs)
    return {"ok": True, "marked": n}


# ── peers ────────────────────────────────────────────────────────────────────

def list_peers() -> Dict[str, Any]:
    return {"ok": True, "peers": _read(PEERS_PATH, [])}


def add_peer(address_: str, url: str, name: str = "") -> Dict[str, Any]:
    if not address_.startswith("hx_"):
        return {"ok": False, "error": "address must start with hx_"}
    peers = _read(PEERS_PATH, [])
    peers = [p for p in peers if p["address"] != address_]
    peers.append({"address": address_, "url": url.rstrip("/"), "name": name or address_})
    _write(PEERS_PATH, peers)
    return {"ok": True, "peers": peers}


def remove_peer(address_: str) -> Dict[str, Any]:
    peers = [p for p in _read(PEERS_PATH, []) if p["address"] != address_]
    _write(PEERS_PATH, peers)
    return {"ok": True, "peers": peers}


def peer_url(address_: str) -> str:
    for p in _read(PEERS_PATH, []):
        if p["address"] == address_:
            return p["url"]
    return ""


# ── delivery ─────────────────────────────────────────────────────────────────

def send(to: str, body: str, thread: str = "", url: str = "") -> Dict[str, Any]:
    """Sign a message and POST it straight to the peer's /a2a/inbox."""
    import requests

    dest = (url or peer_url(to)).rstrip("/")
    if not dest:
        return {"ok": False, "error": f"no known URL for {to} — add it as a peer first"}
    msg = new_message(to, body, thread)
    try:
        r = requests.post(dest + "/a2a/inbox", json=msg, timeout=15,
                          headers={"content-type": "application/json"})
        ok = r.status_code == 200 and (r.json() or {}).get("ok")
        if not ok:
            detail = ""
            try:
                detail = (r.json() or {}).get("error", "")
            except Exception:
                detail = r.text[:200]
            return {"ok": False, "error": detail or f"HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    # Only record once the peer has actually accepted it, so the thread never
    # shows a message the other side rejected.
    record(msg, "out")
    return {"ok": True, "id": msg["id"], "thread": msg["thread"]}


def receive(msg: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and store an inbound message. Called by the /a2a/inbox route."""
    if not isinstance(msg, dict) or not msg.get("body"):
        return {"ok": False, "error": "empty message"}
    if len(str(msg.get("body", ""))) > 8000:
        return {"ok": False, "error": "message too long"}
    ok, why = verify_message(msg)
    if not ok:
        return {"ok": False, "error": "rejected: " + why}
    # Auto-learn the sender so replies work without manually adding a peer.
    known = {p["address"] for p in _read(PEERS_PATH, [])}
    if msg["from"] not in known and msg.get("reply_to"):
        add_peer(msg["from"], msg["reply_to"], msg.get("from_name", ""))
    stored = record(msg, "in")
    # Hand off to the local agent, unless this was a replay we already had.
    if stored.get("ok") and not stored.get("duplicate"):
        try:
            from . import autoreply
            stored.update(autoreply.maybe_reply(msg))
        except Exception as e:  # auto-reply must never break delivery
            stored["auto_reply_error"] = str(e)
    return stored
