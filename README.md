# Hermes Social

The ultimate multi-platform social hub that runs **inside the Hermes desktop app**.

One pane, six platforms: **X, Reddit, Facebook, Instagram, TikTok, Twitch** —
read feeds, compose, and post, with a per-platform **Settings** tab that makes a
**real API call** to verify your credentials before you ever post.

![tabs: Feeds · Compose · Settings]

## What it does

| Tab       | Capability |
|-----------|------------|
| **Feeds** | Read per platform. X has **Home / For You\* / Mentions**; Reddit hot; FB/IG posts; TikTok videos; Twitch followers. |
| **Compose** | Post/reply/chat per platform (X, Reddit, FB, IG, TT, Twitch chat/title). X also has an "Open composer ↗" share-intent link. |
| **Mass Post** | Write **one draft**, pick connected platforms, blast at once. Posts via API where possible; for X on the free tier it returns a prefilled x.com compose link. |
| **Settings** | Paste creds → **Save** → **Test** (live API call). Green = ready. |

\* X's real "For You" algorithmic feed isn't available via any API tier. Our
"For You" merges your Home + Mentions as a clearly-labeled best-effort feed.

## Architecture

```
Hermes desktop pane (plugin.js: Feeds · Compose · Settings)
        │  fetch JSON  (127.0.0.1:8731)
        ▼
social serve  (stdlib http.server, launchd daemon on macOS)
        │  reads ~/.hermes/.env (X) + ~/.config/social/credentials.json (others)
        ▼
platforms.py  ── x-cli (X writes) · native OAuth1.0a (X reads) · praw (Reddit)
                · Graph API (FB/IG) · open.tiktokapis.com (TT) · Helix (Twitch)
```

Secrets never touch the UI — the pane only ever sees JSON results.

## Install

```bash
git clone https://github.com/meyjeancodes/hermes-social.git
cd hermes-social
python3 -m venv .venv && . .venv/bin/activate && pip install -e .
cp desktop/plugin.js ~/.hermes/desktop-plugins/hermes-social/plugin.js

# run the backend (macOS launchd keeps it alive + on boot):
cp com.hermes.social.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hermes.social.plist
```

In Hermes: ⌘K → *Reload desktop plugins*, open the **Social** tab.

## CLI

```bash
social status
social post x "hello"
social post reddit --subreddit python --title "t" --text "body"
social post instagram --image-url https://host/img.jpg --text "caption"
social post tiktok --video-url https://host/v.mp4 --text "caption"
social chat twitch "hello chat"
social settitle twitch --title "New Title"
social feeds --platform all --limit 10
```

## Credentials

Add them in the Settings tab (or the files below). See [README](README.md) for the
full per-platform key list and where to get each one.

- **X** → `~/.hermes/.env` (`X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`)
- **Others** → `~/.config/social/credentials.json`

> **X note:** timeline reads (Home) and posting require a **paid API tier**
> (Basic, $100/mo). The Free tier returns `402 credits depleted` / `403`. Until
> then, the hub opens the real X site for you (Home / Notifications / Compose).

## Mass Post (one draft → many platforms)

Open the **Mass Post** tab, write one message, tick the connected platforms, and
blast. The backend (`POST /mass`) posts via each platform's API where it can; for
**X on the free tier** (API reads/posts are paid-only) it returns a **prefilled
`x.com/intent/tweet` link** you click to post on X itself. No API cost, works today.

## License

MIT — see [LICENSE](LICENSE).
