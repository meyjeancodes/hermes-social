# Hermes Social

Run X, Reddit, Facebook, and Instagram **through the Hermes desktop app**. This is a real,
working multi-platform social client — not a mock. It ships as:

1. a Python engine (`social` CLI + local JSON API server), and
2. a Hermes desktop plugin pane (Compose + Feeds) that talks to that server.

Secrets stay in `~/.hermes/.env`. The desktop pane only ever sees JSON results — it never
touches your tokens.

---

## What works today (no creds needed to install/verify)

- Desktop **Social pane** with Compose + Feeds tabs.
- Per-platform "configured?" badges (green = creds present).
- Each platform degrades gracefully: if creds are missing, the pane shows "⚠ not configured"
  instead of crashing.

## Platform capability

| Platform   | Post | Reply/Like/RT | Read feed | Notes |
|------------|------|---------------|-----------|-------|
| X / Twitter| ✅   | ✅            | ✅ (mentions) | official API via `x-cli`; **paid plan required** for most writes |
| Reddit     | ✅   | ✅            | ✅ (hot)   | `praw` |
| Facebook   | ✅   | —             | ✅ (page posts) | Graph API, Page token |
| Instagram  | ✅*  | —             | ✅ (media) | Graph API; posts need a **hosted image URL** |

\* Instagram requires an image URL (the Graph API can't upload a local file).

---

## Install

```bash
cd ~/hermes-social
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
cp desktop/plugin.js ~/.hermes/desktop-plugins/hermes-social/plugin.js
```

## Run the backend (keep it alive)

```bash
# foreground (for testing)
. .venv/bin/activate && python3 -m social serve

# or as a launchd daemon (survives reboot):
cp com.hermes.social.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hermes.social.plist
```

Then reload desktop plugins in Hermes (⌘K → Reload desktop plugins) and click the **Social** tab.

## CLI quick reference

```bash
social status
social post x "hello world"
social post reddit --subreddit python --title "t" --text "body"
social post facebook "hello"
social post instagram --image-url https://host/img.jpg --text "caption"
social reply x <tweet_id> "nice"
social like x <tweet_id>
social retweet x <tweet_id>
social feeds --platform all --limit 10
```

---

## Credentials — what to add to `~/.hermes/.env`

### X / Twitter (5 values) — https://developer.x.com/en/portal/dashboard
```
X_API_KEY=...
X_API_SECRET=...
X_BEARER_TOKEN=...
X_ACCESS_TOKEN=...
X_ACCESS_TOKEN_SECRET=...
```
Set app permissions to **Read and write**, then regenerate the access token.
Note: X's API is paid for real usage — free tiers are heavily rate-limited / read-only.

### Reddit (up to 5 values) — https://www.reddit.com/prefs/apps
Create a "script" app, then:
```
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=...        # your reddit username
REDDIT_PASSWORD=...        # reddit password (or app-specific)
REDDIT_USER_AGENT=hermes-social/0.1 by u/yourname
```

### Facebook + Instagram (1 shared token + 2 ids)
Create a Meta app → add **Facebook + Instagram** products → get a **Page Access Token**:
```
FB_PAGE_ACCESS_TOKEN=...   # Page token (not user token)
FB_PAGE_ID=...             # your Facebook Page ID
IG_USER_ID=...             # Instagram Business account ID (linked to the Page)
```
Instagram must be a **Business/Creator** account linked to the Facebook Page.

After editing `.env`, restart the server (`launchctl unload/load` or re-run `social serve`).

---

## Architecture

```
Hermes desktop pane (plugin.js)
        │  fetch JSON
        ▼
social serve  (127.0.0.1:8731, stdlib http.server)
        │  reads ~/.hermes/.env
        ▼
platforms.py  ── x-cli (X) · praw (Reddit) · graph.facebook.com (FB/IG)
```

The pane uses plain `fetch` to localhost rather than `ctx.rest`, so there is **no gateway
discovery dependency** and nothing to 404 — it works the moment the server is up.

## Troubleshooting

- **Pane says "Cannot reach social server"** → the backend isn't running. Start `social serve`
  (or check the launchd plist loaded).
- **Platform shows "not configured"** → that platform's creds are missing/wrong in `.env`.
- **X writes fail with 403** → app permission isn't "Read and write", or the token predates the
  permission change (regenerate it).
- **Instagram post fails** → image_url must be a publicly reachable URL.
