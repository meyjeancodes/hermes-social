"""Credential + config loading and saving for Hermes Social.

Loads secrets from two places (first value wins):
  1. ~/.hermes/.env                      (KEY=VALUE lines; agent central secret store)
  2. ~/.config/social/credentials.json   (JSON; written by the desktop Settings tab)

`reload()` re-reads both so creds saved from the UI take effect on the next
request without restarting the server. Only reads/writes values it owns;
never touches unrelated secrets.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict

HERMES_ENV = Path(os.path.expanduser("~/.hermes/.env"))
X_CLI_ENV = Path(os.path.expanduser("~/.config/x-cli/.env"))  # symlink -> ~/.hermes/.env
SOCIAL_CFG = Path(os.path.expanduser("~/.config/social/credentials.json"))

# which env keys each platform's Settings form manages
X_KEYS = ["X_API_KEY", "X_API_SECRET", "X_BEARER_TOKEN", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET", "X_USERNAME"]
REDDIT_KEYS = ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD", "REDDIT_USER_AGENT"]
FB_KEYS = ["FB_PAGE_ACCESS_TOKEN", "FB_PAGE_ID"]
IG_KEYS = ["FB_PAGE_ACCESS_TOKEN", "IG_USER_ID"]
TT_KEYS = ["TIKTOK_ACCESS_TOKEN"]
TWITCH_KEYS = ["TWITCH_CLIENT_ID", "TWITCH_ACCESS_TOKEN"]

PLATFORM_KEYS = {
    "x": X_KEYS,
    "reddit": REDDIT_KEYS,
    "facebook": FB_KEYS,
    "instagram": IG_KEYS,
    "tiktok": TT_KEYS,
    "twitch": TWITCH_KEYS,
}

_ENV: Dict[str, str] = {}


def _load_dotenv(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _load_json_cfg() -> Dict[str, str]:
    if SOCIAL_CFG.exists():
        try:
            data = json.loads(SOCIAL_CFG.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
        except Exception:
            pass
    return {}


def reload() -> None:
    """Re-read both credential sources. Called at the start of every request."""
    global _ENV
    # json first, then .env overrides (central store wins)
    _ENV = {**_load_json_cfg(), **_load_dotenv(HERMES_ENV)}


def get(key: str, default: str = "") -> str:
    return _ENV.get(key, default)


def configured() -> Dict[str, bool]:
    """Return which platforms have the minimum creds to function."""
    x = all(get(k) for k in X_KEYS)
    reddit = bool(get("REDDIT_CLIENT_ID") and get("REDDIT_CLIENT_SECRET"))
    fb = bool(get("FB_PAGE_ACCESS_TOKEN") and get("FB_PAGE_ID"))
    ig = bool(get("FB_PAGE_ACCESS_TOKEN") and get("IG_USER_ID"))
    tt = bool(get("TIKTOK_ACCESS_TOKEN"))
    twitch = bool(get("TWITCH_CLIENT_ID") and get("TWITCH_ACCESS_TOKEN"))
    return {"x": x, "reddit": reddit, "facebook": fb, "instagram": ig, "tiktok": tt, "twitch": twitch}


# ── saving (used by the Settings tab via POST /settings) ──────────────────────
def _write_dotenv(path: Path, updates: Dict[str, str]) -> None:
    """Merge `updates` into a KEY=VALUE file, preserving unrelated keys."""
    path.parent.mkdir(parents=True, exist_ok=True)
    cur: Dict[str, str] = _load_dotenv(path)
    cur.update(updates)
    lines = [f"{k}={v}" for k, v in cur.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def _write_json(updates: Dict[str, str]) -> None:
    SOCIAL_CFG.parent.mkdir(parents=True, exist_ok=True)
    cur: Dict[str, str] = _load_json_cfg()
    cur.update(updates)
    SOCIAL_CFG.write_text(json.dumps(cur, indent=2), encoding="utf-8")
    os.chmod(SOCIAL_CFG, 0o600)


def save_credentials(platform: str, creds: Dict[str, str]) -> Dict[str, bool]:
    """Persist creds for a platform. Returns the new configured() map.

    X creds go to ~/.hermes/.env (x-cli reads that file). Reddit/FB/IG go to
    credentials.json (the backend reads those).
    """
    keys = PLATFORM_KEYS.get(platform, [])
    updates = {k: creds[k] for k in keys if k in creds and creds[k] != ""}
    if platform == "x":
        # X_CLI_ENV is a symlink to ~/.hermes/.env; writing it updates the real file.
        target = X_CLI_ENV if X_CLI_ENV.exists() else HERMES_ENV
        _write_dotenv(target, updates)
    else:
        _write_json(updates)
    reload()
    return configured()
