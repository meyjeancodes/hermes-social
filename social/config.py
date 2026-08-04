"""Credential + config loading for Hermes Social.

Loads secrets from two places (first value wins):
  1. ~/.hermes/.env            (KEY=VALUE lines; the agent's central secret store)
  2. ~/.config/social/credentials.json   (JSON object)

Only reads values it needs; never writes secrets. Missing secrets are reported
as "not configured" rather than crashing — the CLI/UI degrades per-platform.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict

HERMES_ENV = Path(os.path.expanduser("~/.hermes/.env"))
SOCIAL_CFG = Path(os.path.expanduser("~/.config/social/credentials.json"))


def _load_dotenv() -> Dict[str, str]:
    out: Dict[str, str] = {}
    if HERMES_ENV.exists():
        for raw in HERMES_ENV.read_text(encoding="utf-8").splitlines():
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


# merged once at import; env file takes precedence over json file
_ENV = {**_load_json_cfg(), **_load_dotenv()}


def get(key: str, default: str = "") -> str:
    return _ENV.get(key, default)


def configured() -> Dict[str, bool]:
    """Return which platforms have the minimum creds to function."""
    x = all(
        get(k)
        for k in (
            "X_API_KEY",
            "X_API_SECRET",
            "X_BEARER_TOKEN",
            "X_ACCESS_TOKEN",
            "X_ACCESS_TOKEN_SECRET",
        )
    )
    reddit = bool(get("REDDIT_CLIENT_ID") and get("REDDIT_CLIENT_SECRET"))
    # Facebook Page access token + page id; Instagram reuses the page token.
    fb = bool(get("FB_PAGE_ACCESS_TOKEN") and get("FB_PAGE_ID"))
    ig = bool(get("FB_PAGE_ACCESS_TOKEN") and get("IG_USER_ID"))
    return {"x": x, "reddit": reddit, "facebook": fb, "instagram": ig}
