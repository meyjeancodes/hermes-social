# Hermes Social

The ultimate multi-platform social hub that runs **inside the Hermes desktop app**.

One pane, **18 live social sites**, eight tabs: read the open web, scan every
platform at once, watch keywords, post, and DM — without leaving the app.

```
Browse   Radair   Timeline   Watch   Inbox   Compose   Mass Post   Settings
```

## What it does

| Tab         | Capability |
|-------------|------------|
| **Browse**  | 18 social sites rendered as full live webviews (X, Reddit, Bluesky, Instagram, Facebook, Threads, LinkedIn, YouTube, TikTok, Twitch, Mastodon, Discord, WhatsApp, Telegram, Slack, GitHub, Hacker News, Product Hunt). Each gets its own persistent logged-in partition, so logins survive reloads. Split-view (⌘\\), per-site zoom, unread badges, and a Cleaner that strips ads/sponsored/Reels from every site. |
| **Radar**   | One keyword fired at every platform's own search page at once, in a live grid. Things no social API can do — X's search API is paywalled, Reddit killed anon JSON, IG/TikTok have no public search API — but every site renders its search page to a logged-in browser, so you see *your* results. Sortable (newest / A–Z / most used) with one-tap trending probes. |
| **Timeline**| A unified, credential-free feed (RSS + Reddit + Hacker News + Mastodon + YouTube) merged and searchable by the backend's `q` filter. "Open in Browse" jumps the post's source live. |
| **Watch**   | Saved keyword monitors over that same unified timeline. Each polls every 90s and badges **genuinely new** matches since you last looked — a "new since you looked" counter on the tab, not a firehose. Stored locally, no API keys. |
| **Inbox**   | DM-style message threads and a new-conversation composer. |
| **Compose** | One-click compose to any live site (uses that site's own intent URL in its webview). |
| **Mass Post**| Write one draft, pick connected platforms, blast. Posts via API where the backend has keys; otherwise opens each site's prefilled composer. |
| **Settings**| Paste credentials → Save → Test (live API call). Green = ready. |

## Keyboard & navigation

- **⌘K** — in-pane command palette: jump to any site, switch tabs, run a Radar
  scan, toggle Zen. Scoped to the Social pane so it never hijacks the app's
  global ⌘K.
- **⌘1–⌘9** — jump to the Nth site in Browse.
- **⌘\\** — toggle split-view on the second-most-recent site.

## Light & dark

The pane reads Hermes's active theme (`documentElement.dataset.hermesMode`)
live and repaints — brand marks, status fills, and source chips all meet WCAG
AA in both modes. No reload needed when you switch themes.

## Architecture

```
Hermes desktop pane (desktop/plugin.js: 8 tabs)
        │  fetch JSON  (http://127.0.0.1:8731)
        ▼
social serve  (Python stdlib http.server, launchd daemon on macOS)
        │  credential-free: RSS + Reddit + HN + Mastodon + YouTube
        │  API-backed (optional): X / Instagram / Facebook / Twitch when keys set
        ▼
social/server.py  ── merges sections, exposes /timeline /status /mass /connect
```

The pane only ever sees JSON. Secrets stay server-side (never in the UI).

## Install

```bash
git clone https://github.com/meyjeancodes/hermes-social.git
cd hermes-social
python3 -m venv .venv && . .venv/bin/activate && pip install -e .

# install the pane into Hermes
cp desktop/plugin.js ~/.hermes/desktop-plugins/hermes-social/plugin.js

# run the backend (macOS launchd keeps it alive + on boot):
cp com.hermes.social.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hermes.social.plist
```

In Hermes: ⌘K → *Reload desktop plugins*, open the **Social** tab.

## Verify (clone-and-run)

```bash
npm test
```

Runs three harnesses (`scripts/*.mjs`):
- `render-check` — deep-renders all 8 tabs to catch hook/TDZ errors `node --check` misses.
- `browse-check` — all 18 sites get a persistent partition, MRU cap of 4 live webviews, Cleaner injection, Radar-jump regression, and the BrowseHub jump-guard invariant.
- `theme-check` — WCAG AA contrast for every brand mark + status fill in light and dark, plus a leak check that light mode emits no dark-only literals.
- `route-check` — every endpoint the pane calls exists on the backend (static cross-check of `social/server.py` + a live probe; performs no real posts).

## CLI (backend)

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

## Credentials (optional)

Add them in the Settings tab (or the files below).

- **X** → `~/.hermes/.env` (`X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`)
- **Others** → `~/.config/social/credentials.json`

> The unified Timeline / Watch / Radar-search work **without any keys** via
> public RSS/APIs and your own logged-in Browse sessions. Keys only extend the
> backend's API-backed posting/reading.

## License

MIT — see [LICENSE](LICENSE).
