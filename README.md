# Hermes Social

Run **X, Reddit, Facebook, Instagram, TikTok, and Twitch** from the Hermes desktop app.
This is a real, working multi-platform social client — not a mock. It ships as:

1. a Python engine (`social` CLI + local JSON API server), and
2. a Hermes desktop plugin pane (Compose · Feeds · **Settings**) that talks to that server.

Secrets stay in `~/.hermes/.env` (X) or `~/.config/social/credentials.json` (everyone else).
The desktop pane only ever sees JSON results — it never touches your tokens.

---

## What works today

- **Settings tab** — log in per platform. Each platform has a **Test** button that makes a
  **real API call** (not just "key present") and reports success/failure. Verified live:
  X and TikTok both returned genuine HTTP 401s with fake keys, proving the call is real.
- **Compose tab** — post/reply/chat per platform.
- **Feeds tab** — read per platform (X mentions, Reddit hot, FB/IG posts, TT videos, Twitch followers).
- Each platform degrades gracefully when creds are missing (shows "not configured").

## Platform capability

| Platform   | Auth model                                  | Post / Action                  | Read feed        | Notes |
|------------|---------------------------------------------|-------------------------------|-----------------|-------|
| X / Twitter| 5 keys, official API (paid for writes)     | post / reply / like / retweet | mentions        | via `x-cli` |
| Reddit     | script app (client id+secret+user+pass)    | post / reply                  | hot/front       | via `praw` |
| Facebook   | Page token + Page ID (Graph API)           | post to page                  | page posts      | |
| Instagram  | Page token + IG Business ID (Graph API)    | post (image URL)              | media           | needs hosted image URL |
| TikTok     | OAuth access token (Content Posting API)   | post video (URL)              | videos          | video only |
| Twitch     | Client ID + OAuth token (Helix)            | chat message / set title      | followers       | |

---

## Install

```bash
cd ~/hermes-social
python3 -m venv .venv && . .venv/bin/activate && pip install -e .   # OR: pip install -e . (system py)
cp desktop/plugin.js ~/.hermes/desktop-plugins/hermes-social/plugin.js
```

The backend (`social serve`) runs as a launchd daemon on `127.0.0.1:8731` (survives reboot).
To (re)install the daemon:

```bash
cp com.hermes.social.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hermes.social.plist
```

Then reload desktop plugins in Hermes (⌘K → Reload desktop plugins) and click the **Social** tab.
Open the **Settings** tab, fill a platform's creds, hit **Save**, then **Test** to confirm.

## CLI

```bash
social status
social post x "hello"
social post reddit --subreddit python --title "t" --text "body"
social post facebook "hello"
social post instagram --image-url https://host/img.jpg --text "caption"
social post tiktok --video-url https://host/v.mp4 --text "caption"
social chat twitch "hello chat"            # POST /chat/twitch
social settitle twitch --title "New Title" # POST /settitle/twitch
social reply x <id> "nice"
social like x <id>
social retweet x <id>
social feeds --platform all --limit 10
```

---

## Credentials — add via the Settings tab (or `~/.hermes/.env` / `~/.config/social/credentials.json`)

### X / Twitter (5 values) — https://developer.x.com/en/portal/dashboard
Set app to **Read and write**, regenerate access token. **Paid plan required for writes.**
```
X_API_KEY=...  X_API_SECRET=...  X_BEARER_TOKEN=...  X_ACCESS_TOKEN=...  X_ACCESS_TOKEN_SECRET=...
```

### Reddit — https://www.reddit.com/prefs/apps (create a "script" app)
```
REDDIT_CLIENT_ID=...  REDDIT_CLIENT_SECRET=...  REDDIT_USERNAME=...  REDDIT_PASSWORD=...  REDDIT_USER_AGENT=hermes-social/0.1 by u/you
```

### Facebook + Instagram — Meta app with Page token
```
FB_PAGE_ACCESS_TOKEN=...   # Page token (shared by FB + IG)
FB_PAGE_ID=...             # Facebook Page ID
IG_USER_ID=...             # Instagram Business account ID (linked to the Page)
```
Instagram must be a **Business/Creator** account linked to the Facebook Page.

### TikTok — https://developers.tiktok.com (app with Video Upload/Publish scopes)
```
TIKTOK_ACCESS_TOKEN=...    # OAuth token
```
Video only; posts need a **publicly hosted video URL**.

### Twitch — https://dev.twitch.tv/console/apps (register an app)
```
TWITCH_CLIENT_ID=...       # app Client ID
TWITCH_ACCESS_TOKEN=...    # OAuth token (scopes: chat:edit, channel:manage:broadcast, …)
```
Personal tokens need the right scopes for chat/title actions.

After editing files directly (not via the tab), restart the server:
`launchctl unload ~/Library/LaunchAgents/com.hermes.social.plist && launchctl load ...`

---

## Architecture

```
Hermes desktop pane (plugin.js: Compose · Feeds · Settings)
        │  fetch JSON  (127.0.0.1:8731)
        ▼
social serve  (stdlib http.server, launchd daemon)
        │  reads ~/.hermes/.env + ~/.config/social/credentials.json
        ▼
platforms.py  ── x-cli (X) · praw (Reddit) · graph.facebook.com (FB/IG) · open.tiktokapis.com (TT) · api.twitch.tv/helix (Twitch)
```

## Troubleshooting

- **Pane says "Cannot reach social server"** → backend not running. `launchctl load` the plist or run `social serve`.
- **Platform "not configured"** → creds missing. Add them in Settings (Save → Test).
- **Test returns HTTP 401/403** → wrong/expired token, or missing API permission (e.g. X needs "Read and write").
- **Instagram/TikTok post fails** → image/video must be a **publicly hosted URL**.
