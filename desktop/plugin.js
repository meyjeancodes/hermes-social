// ~/.hermes/desktop-plugins/hermes-social/plugin.js
// Hermes Social — the ultimate multi-platform social hub (X, Reddit, Facebook,
// Instagram, TikTok, Twitch) right in the Hermes desktop.
// Tabs: Feeds · Compose · Settings. Talks to the local `social serve` backend.
// Secrets live in ~/.hermes/.env / ~/.config/social/credentials.json — the pane
// only ever sees JSON (status, verify result, post result).

import React from 'react'
import { host } from '@hermes/plugin-sdk'

const ID = 'hermes-social'
const h = React.createElement
const API = 'http://127.0.0.1:8731'

// ── persistence ───────────────────────────────────────────────────────────────
// ctx.storage is namespaced to this plugin and survives restarts. We capture the
// ctx handed to register() so components (which never see ctx) can still use it,
// and fall back to localStorage when the plugin is loaded by a test harness.
let PCTX = null
const SKEY = 'hermes-social:'
function loadPref(key, fallback) {
  try {
    if (PCTX && PCTX.storage && typeof PCTX.storage.get === 'function') {
      const v = PCTX.storage.get(key)
      if (v !== undefined && v !== null) return v
    }
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SKEY + key)
      if (raw != null) return JSON.parse(raw)
    }
  } catch { /* storage unavailable — use the default */ }
  return fallback
}
function savePref(key, value) {
  try {
    if (PCTX && PCTX.storage && typeof PCTX.storage.set === 'function') PCTX.storage.set(key, value)
    if (typeof localStorage !== 'undefined') localStorage.setItem(SKEY + key, JSON.stringify(value))
  } catch { /* non-fatal: the pane still works, it just forgets */ }
}
// State that should survive a reload: writes on every change, reads once at mount.
function usePref(key, fallback) {
  const [v, setV] = React.useState(() => loadPref(key, fallback))
  const set = React.useCallback((next) => {
    setV((prev) => {
      const val = typeof next === 'function' ? next(prev) : next
      savePref(key, val)
      return val
    })
  }, [key])
  return [v, set]
}

// X free-tier workaround: the API can't read timelines or post without a paid
// plan, so we route to the real X site instead. The share intent prefills the
// draft text — one click and the user posts on x.com itself.
function xIntent(text) {
  return 'https://x.com/intent/tweet?text=' + encodeURIComponent(text || '')
}

const PLATFORMS = [
  { key: 'x', label: 'X', fields: [
    { k: 'X_API_KEY', label: 'API Key', secret: true },
    { k: 'X_API_SECRET', label: 'API Secret', secret: true },
    { k: 'X_BEARER_TOKEN', label: 'Bearer Token', secret: true },
    { k: 'X_ACCESS_TOKEN', label: 'Access Token', secret: true },
    { k: 'X_ACCESS_TOKEN_SECRET', label: 'Access Token Secret', secret: true },
  ]},
  { key: 'reddit', label: 'Reddit', fields: [
    { k: 'REDDIT_CLIENT_ID', label: 'Client ID', secret: true },
    { k: 'REDDIT_CLIENT_SECRET', label: 'Client Secret', secret: true },
    { k: 'REDDIT_USERNAME', label: 'Username' },
    { k: 'REDDIT_PASSWORD', label: 'Password', secret: true },
    { k: 'REDDIT_USER_AGENT', label: 'User Agent' },
  ]},
  { key: 'facebook', label: 'Facebook', fields: [
    { k: 'FB_PAGE_ACCESS_TOKEN', label: 'Page Access Token', secret: true },
    { k: 'FB_PAGE_ID', label: 'Page ID' },
  ]},
  { key: 'instagram', label: 'Instagram', fields: [
    { k: 'IG_USER_ID', label: 'Instagram User ID' },
    { k: 'FB_PAGE_ACCESS_TOKEN', label: '(uses Facebook Page Token)', secret: true, shared: true },
  ]},
  { key: 'tiktok', label: 'TikTok', fields: [
    { k: 'TIKTOK_ACCESS_TOKEN', label: 'Access Token', secret: true },
  ]},
  { key: 'twitch', label: 'Twitch', fields: [
    { k: 'TWITCH_CLIENT_ID', label: 'Client ID' },
    { k: 'TWITCH_ACCESS_TOKEN', label: 'Access Token (OAuth)', secret: true },
  ]},
  { key: 'hn', label: 'Hacker News', fields: [], public: true },
]

// Per-platform post rules used by the compose preview. Real, sourced limits so
// the user sees exactly how the post will behave before sending — no guessing.
//  - limit: hard char cap (null = none)
//  - media: what the platform accepts
//  - link: link-handling note
const PLAT_LIMITS = {
  x: { limit: 280, media: 'images / video / poll', link: 'links count as 23 chars' },
  reddit: { limit: null, media: 'image / video (per post)', link: 'link OR text body — not both' },
  facebook: { limit: 63206, media: 'image / video / link', link: 'full URL shown' },
  instagram: { limit: 2200, media: 'image / video only', link: 'links not clickable in caption' },
  tiktok: { limit: 2200, media: 'video only', link: 'bio link only' },
  twitch: { limit: 500, media: 'chat text', link: 'n/a' },
  hn: { limit: null, media: 'text', link: 'title + comment' },
}

// Live per-platform compose preview: char count against the real limit plus the
// media/link rules. Used by both Compose and Mass Post so the user never blind-sends.
function ComposePreview({ platform, platforms, text, media }) {
  const list = platforms && platforms.length ? platforms : [platform].filter(Boolean)
  const rows = list.map((k) => {
    const L = PLAT_LIMITS[k] || { limit: null, media: '', link: '' }
    const n = (text || '').length
    const over = L.limit != null && n > L.limit
    const near = L.limit != null && n > L.limit * 0.9
    return { k, L, n, over, near }
  })
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    rows.map(({ k, L, n, over, near }) => h('div', { key: k, style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11, flexWrap: 'wrap' } },
      h('span', { style: { fontWeight: 700, color: 'var(--ui-text-secondary, #b6bccb)', minWidth: 86 } }, (PLATFORMS.find((p) => p.key === k) || {}).label || k),
      L.limit != null
        ? h('span', { style: { fontFamily: MONO, color: over ? C_ERR : near ? C_WARN : 'var(--ui-text-tertiary, #8b93a7)' } }, `${n}/${L.limit}${over ? '  ✗ over' : ''}`)
        : h('span', { style: { fontFamily: MONO, color: 'var(--ui-text-tertiary, #8b93a7)' } }, `${n} chars`),
      h('span', { style: { color: 'var(--ui-text-tertiary, #8b93a7)' } }, L.media),
      L.link && L.link !== 'n/a' && h('span', { style: { color: 'var(--ui-text-tertiary, #8b93a7)', fontStyle: 'italic' } }, '· ' + L.link),
    )),
    media && h('div', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)' } }, '📎 ' + media),
  )
}

function ago(when) {
  if (!when) return ''
  // Accepts an ISO string (feeds) or epoch seconds/ms (a2a messages).
  let t
  if (typeof when === 'number') t = when < 1e12 ? when * 1000 : when
  else t = Date.parse(when)
  if (isNaN(t)) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

// ── brand ─────────────────────────────────────────────────────────────────────
// Matches Hermes desktop chrome: --dt-font-mono (JetBrains Mono), uppercase,
// wide tracking — same treatment the app uses for its own wordmark.
const MONO = 'var(--dt-font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace)'

// ── Theme awareness ───────────────────────────────────────────────────────────
// The desktop app publishes the resolved appearance on the document root:
//   root.dataset.hermesMode  = 'light' | 'dark'   (already resolves 'system')
//   root.classList 'dark'    toggled to match
//   root.style  color-scheme = 'light' | 'dark'
// Every --ui-* token is derived from --ui-base via color-mix(), so tokens flip
// on their own. What does NOT flip is any literal hex we ship — brand marks,
// status colours, and the rgba() tints used for fills. Those are what this
// layer fixes.
function readMode() {
  if (typeof document === 'undefined' || !document.documentElement) return 'dark'
  const el = document.documentElement
  const m = el.dataset && el.dataset.hermesMode
  if (m === 'light' || m === 'dark') return m
  // Fall back to the class the app toggles, then to the OS preference.
  if (el.classList && el.classList.contains('dark')) return 'dark'
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

// Subscribe to theme changes. The app mutates data-hermes-mode / the `dark`
// class on <html> when the user switches skin or hits Shift+X, so a
// MutationObserver on that one attribute set is the exact signal — no polling.
function useThemeMode() {
  const [mode, setMode] = React.useState(readMode)
  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const el = document.documentElement
    const sync = () => setMode(readMode())
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ['data-hermes-mode', 'class', 'style'] })
    // 'system' mode follows the OS, which changes without touching the DOM.
    let mq = null
    if (typeof window !== 'undefined' && window.matchMedia) {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
      if (mq.addEventListener) mq.addEventListener('change', sync)
    }
    sync()
    return () => {
      obs.disconnect()
      if (mq && mq.removeEventListener) mq.removeEventListener('change', sync)
    }
  }, [])
  return mode
}
const useIsLight = () => useThemeMode() === 'light'

// Brand colours re-tuned for a white surface. Every value here was computed to
// clear >=4.0:1 contrast on #ffffff while keeping the brand hue; the dark
// originals sit at 1.2-2.8:1 on light, which is unreadable-to-invisible (X's
// #e5e7eb is 1.24:1 — literally white on white).
const LIGHT_INK = {
  x: '#24292f',        // X is a black-wordmark brand: near-black reads correct
  reddit: '#d35a05',
  threads: '#5f5f5f',
  tiktok: '#0c899d',
  whatsapp: '#1a9246',
  telegram: '#1286c2',
  github: '#24292f',   // GitHub's own light-mode ink
  hn: '#cc5e04',
}
// Status colours: same treatment.
const OK_C = { dark: '#22c55e', light: '#199246' }
const ERR_C = { dark: '#f87171', light: '#d61f1f' }
const WARN_C = { dark: '#f59e0b', light: '#af7007' }
const okColor = (light) => (light ? OK_C.light : OK_C.dark)
const errColor = (light) => (light ? ERR_C.light : ERR_C.dark)
const warnColor = (light) => (light ? WARN_C.light : WARN_C.dark)
// A site's mark colour for the current mode.
const inkFor = (site, light) => (light && LIGHT_INK[site.key]) || site.color

// Neutral fills. rgba(127,127,127,a) is mid-grey and technically mode-agnostic,
// but on white it reads as dirty haze — light mode wants a cooler, weaker tint.
const tint = (light, a) => (light ? `rgba(15,23,42,${a * 0.55})` : `rgba(127,127,127,${a})`)

// ── Mode-aware CSS variables ──────────────────────────────────────────────────
// Threading `light` through 30+ call sites would be noisy and easy to miss one.
// Instead we publish our own scoped variables once, on the pane root, and let
// the cascade do the work: --hs-ok / --hs-err / --hs-warn / --hs-fill / etc.
// resolve differently per mode, so every consumer stays a plain string.
const THEME_STYLE_ID = 'hermes-social-theme-vars'
const THEME_CSS = `
[data-hs-mode] {
  --hs-ok: ${OK_C.dark};
  --hs-err: ${ERR_C.dark};
  --hs-warn: ${WARN_C.dark};
  --hs-ok-bg: rgba(34,197,94,0.15);
  --hs-err-bg: rgba(248,113,113,0.15);
  --hs-fill-strong: rgba(127,127,127,0.16);
  --hs-fill: rgba(127,127,127,0.10);
  --hs-fill-soft: rgba(127,127,127,0.06);
  --hs-fill-faint: rgba(127,127,127,0.05);
  --hs-ok-glow: rgba(34,197,94,0.6);
  --hs-fill-btn: rgba(128,128,128,0.3);
}
[data-hs-mode="light"] {
  --hs-ok: ${OK_C.light};
  --hs-err: ${ERR_C.light};
  --hs-warn: ${WARN_C.light};
  --hs-ok-bg: rgba(25,146,70,0.13);
  --hs-err-bg: rgba(214,31,31,0.11);
  --hs-fill-strong: rgba(15,23,42,0.09);
  --hs-fill: rgba(15,23,42,0.055);
  --hs-fill-soft: rgba(15,23,42,0.035);
  --hs-fill-faint: rgba(15,23,42,0.028);
  --hs-ok-glow: rgba(25,146,70,0.42);
  --hs-fill-btn: rgba(15,23,42,0.14);
}
/* Webviews paint their own page, but the host element flashes its background
   before first paint — match the surface so light mode doesn't strobe black. */
[data-hs-mode="light"] webview { background: #fff; }
`
// Injected once per document; harmless if the pane mounts more than once.
function useThemeVars() {
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.getElementById(THEME_STYLE_ID)) return
    const el = document.createElement('style')
    el.id = THEME_STYLE_ID
    el.textContent = THEME_CSS
    document.head.appendChild(el)
  }, [])
}
// Semantic colours, resolved by CSS rather than by JS branching.
const C_OK = 'var(--hs-ok)'
const C_ERR = 'var(--hs-err)'
const C_WARN = 'var(--hs-warn)'
const C_OK_BG = 'var(--hs-ok-bg)'
const C_ERR_BG = 'var(--hs-err-bg)'
const F_STRONG = 'var(--hs-fill-strong)'
const F_MED = 'var(--hs-fill)'
const F_SOFT = 'var(--hs-fill-soft)'
const F_FAINT = 'var(--hs-fill-faint)'
const JH = { 'Content-Type': 'application/json' }

function Banner({ nConn, total }) {
  return h('div', { style: {
    display: 'flex', alignItems: 'baseline', gap: 9, flexShrink: 0,
    padding: '13px 14px 11px',
    borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
  } },
    h('span', { style: {
      fontFamily: MONO, fontSize: '0.94rem', fontWeight: 700,
      letterSpacing: '0.30em', textTransform: 'uppercase',
      color: 'var(--ui-text-primary, #e7e9ee)', lineHeight: 1,
    } }, 'Hermes'),
    h('span', { style: {
      fontFamily: MONO, fontSize: '0.94rem', fontWeight: 300,
      letterSpacing: '0.30em', textTransform: 'uppercase',
      color: 'var(--ui-text-tertiary, #8b93a7)', lineHeight: 1,
    } }, 'Social'),
    h('span', { title: 'Press ⌘K to jump to any site, tab, or Radar term', style: {
      fontFamily: MONO, fontSize: '0.5rem', letterSpacing: '0.1em',
      textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)',
      border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 999,
      padding: '3px 8px', lineHeight: 1, cursor: 'pointer',
    }, onClick: () => setPalette(true) }, '⌘K'),
    h('span', { style: { flex: 1 } }),
    h('span', { title: nConn + ' of ' + total + ' platforms have credentials', style: {
      fontFamily: MONO, fontSize: '0.52rem', letterSpacing: '0.16em',
      textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)',
      border: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
      borderRadius: 999, padding: '3px 8px', lineHeight: 1,
    } }, nConn + '/' + total + ' linked'),
  )
}

function SocialPane() {
  useThemeVars()
  const mode = useThemeMode()
  const [tab, setTab] = usePref('tab', 'browse')
  const [status, setStatus] = React.useState(null)
  const [err, setErr] = React.useState(null)
  // Zen hides the wordmark + tab bar so a live site gets the entire pane.
  const [zen, setZen] = usePref('zen', false)
  // Compose asks the hub to open a prefilled intent URL: {key, url, nonce}.
  const [jump, setJump] = usePref('jump', null)
  const [palette, setPalette] = React.useState(false)
  const [watchNew, setWatchNew] = React.useState(0)
  const openInBrowse = React.useCallback((key, url) => {
    setJump({ key, url, nonce: Date.now() })
    setTab('browse')
  }, [])

  // ⌘K opens the in-pane command palette (scoped so it never hijacks the app's
  // global ⌘K and never routes to the OS). Esc/blur closes it.
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); setPalette((p) => !p)
      }
    }
    if (typeof window === 'undefined' || !window.addEventListener) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goSite = React.useCallback((key) => {
    setJump({ key, url: null, nonce: Date.now() })
    setTab('browse')
  }, [])

  const loadStatus = React.useCallback(() => {
    fetch(API + '/status').then((r) => r.json()).then((d) => { setStatus(d); setErr(null) })
      .catch(() => setErr('Cannot reach social server — run `social serve` (or it auto-starts via launchd).'))
  }, [])
  React.useEffect(() => { loadStatus() }, [loadStatus])

  const connected = (status && status.configured) || {}
  const nConn = PLATFORMS.filter((p) => connected[p.key]).length
  // Zen only makes sense over a live site, and only on a tab that carries its
  // own un-zen control (BrowseHub's rail). Radar has no such pill, so zen there
  // would hide the tab bar with no way back.
  const hideChrome = zen && tab === 'browse'

  return h('div', { style: paneStyle, 'data-hs-mode': mode },
    !hideChrome && h(Banner, { nConn, total: PLATFORMS.length }),
    !hideChrome && h('div', { style: tabBarStyle },
      h(Tab, { active: tab === 'browse', onClick: () => setTab('browse'), label: 'Browse' }),
      h(Tab, { active: tab === 'radar', onClick: () => setTab('radar'), label: 'Radar' }),
      h(Tab, { active: tab === 'timeline', onClick: () => setTab('timeline'), label: 'Timeline' }),
      h(Tab, { active: tab === 'watch', onClick: () => { setTab('watch'); setWatchNew(0) }, label: 'Watch' }, watchNew > 0 && watchBadge(watchNew)),
      h(Tab, { active: tab === 'inbox', onClick: () => setTab('inbox'), label: 'Inbox' }),
      h(Tab, { active: tab === 'compose', onClick: () => setTab('compose'), label: 'Compose' }),
      h(Tab, { active: tab === 'mass', onClick: () => setTab('mass'), label: 'Mass Post' }),
      h(Tab, { active: tab === 'settings', onClick: () => setTab('settings'), label: 'Settings' }),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' } },
        PLATFORMS.map((p) =>
          h('span', { key: p.key, title: p.label + (connected[p.key] ? ' · connected' : ' · not set'),
            style: dotStyle(connected[p.key]) })
        )
      )
    ),
    err && h('div', { style: { padding: 10, color: C_ERR, fontSize: 12 } }, err),
    tab === 'browse' ? h(BrowseHub, { zen, setZen, jump })
      : tab === 'radar' ? h(Radar, { jump })
      : tab === 'timeline' ? h(Timeline, { status, openInBrowse })
      : tab === 'watch' ? h(Watch, { onNewTotal: setWatchNew })
      : tab === 'inbox' ? h(Inbox, { status })
      : tab === 'compose' ? h(Compose, { status, refresh: loadStatus, openInBrowse })
      : tab === 'mass' ? h(MassPost, { status, refresh: loadStatus })
      : h(SettingsHub, { status, refresh: loadStatus }),
    palette && h(CommandPalette, {
      onClose: () => setPalette(false),
      setTab, setZen, openInBrowse, goSite,
    }),
  )
}

// ── Command palette (⌘K inside the pane) ──────────────────────────────────────
// The app's own ⌘K is global; this one is scoped to the Social pane so a
// keypress never leaves the hub to go rummaging in the OS. It jumps to any
// site's live view, switches tabs, opens Radar with a term, and toggles Zen —
// all from one fuzzy input. Kept inside the pane (not via the SDK palette area)
// so it can't throw at runtime and so it has access to this file's state.
function CommandPalette({ onClose, setTab, setZen, openInBrowse, goSite }) {
  const [q, setQ] = React.useState('')
  const inputRef = React.useRef(null)
  const [sel, setSel] = React.useState(0)
  React.useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [])

  const cmds = React.useMemo(() => {
    const list = []
    list.push({ id: 'tab:browse', label: 'Go to Browse', run: () => setTab('browse') })
    list.push({ id: 'tab:radar', label: 'Go to Radar', run: () => setTab('radar') })
    list.push({ id: 'tab:timeline', label: 'Go to Timeline', run: () => setTab('timeline') })
    list.push({ id: 'tab:watch', label: 'Go to Watch', run: () => setTab('watch') })
    list.push({ id: 'tab:compose', label: 'Go to Compose', run: () => setTab('compose') })
    list.push({ id: 'tab:inbox', label: 'Go to Inbox', run: () => setTab('inbox') })
    list.push({ id: 'tab:settings', label: 'Go to Settings', run: () => setTab('settings') })
    list.push({ id: 'act:zen', label: 'Toggle Zen (full-pane) mode', run: () => setZen((z) => !z) })
    for (const s of SITES) {
      list.push({ id: 'site:' + s.key, label: 'Open ' + s.label, hint: s.mark, run: () => goSite(s.key) })
      if (SITE_SEARCH[s.key]) {
        list.push({ id: 'radar:' + s.key, label: 'Radar-scan on ' + s.label, hint: '◎', run: () => { setTab('radar'); setJump({ key: 'radar', url: SITE_SEARCH[s.key](q || s.label), nonce: Date.now() }) } })
      }
    }
    const t = q.trim().toLowerCase()
    if (!t) return list
    return list.filter((c) => c.label.toLowerCase().includes(t) || c.id.includes(t))
  }, [q, setTab, setZen, goSite, openInBrowse])

  const pick = (c) => { if (!c) return; c.run(); onClose() }
  React.useEffect(() => { setSel(0) }, [q])

  return h('div', {
    onClick: onClose,
    style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', paddingTop: 40, zIndex: 50 },
  }, h('div', {
    onClick: (e) => e.stopPropagation(),
    style: { width: 'min(560px, 92%)', maxHeight: '70%', display: 'flex', flexDirection: 'column', background: 'var(--ui-bg-elevated, #16181d)', border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
  },
    h('input', {
      ref: inputRef, value: q, onChange: (e) => setQ(e.target.value),
      onKeyDown: (e) => {
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, cmds.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
        else if (e.key === 'Enter') { e.preventDefault(); pick(cmds[sel]) }
      },
      placeholder: 'Jump to a site, tab, or Radar term…  (↑↓ navigate, ↵ open, esc close)',
      style: { padding: '12px 14px', fontSize: 13, border: 'none', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)', background: 'transparent', color: 'var(--ui-text-primary, #e7e9ee)', fontFamily: 'inherit', outline: 'none' },
    }),
    h('div', { style: { overflowY: 'auto', padding: 6 } },
      cmds.length === 0 && h('div', { style: { padding: 14, color: 'var(--ui-text-tertiary, #8b93a7)', fontSize: 12 } }, 'No matches'),
      cmds.map((c, i) => h('div', {
        key: c.id, onClick: () => pick(c),
        onMouseEnter: () => setSel(i),
        style: {
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
          background: i === sel ? 'var(--ui-row-active-background, rgba(127,127,127,0.16))' : 'transparent',
          color: 'var(--ui-text-primary, #e7e9ee)', fontSize: 12.5,
        },
      },
        c.hint && h('span', { style: { color: 'var(--ui-text-tertiary, #8b93a7)', fontFamily: MONO, fontSize: '0.7rem' } }, c.hint),
        c.label,
      )),
    ),
  ))
}

function Tab({ active, onClick, label, badge }) {
  return h('button', { onClick, style: {
    background: active ? 'var(--ui-blue, #3b82f6)' : 'transparent',
    color: active ? '#fff' : 'var(--ui-text-tertiary, #888)',
    border: '1px solid ' + (active ? 'transparent' : 'var(--ui-stroke-secondary, #2a2f3a)'),
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
    fontFamily: MONO, fontSize: '0.58rem', fontWeight: 600,
    letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', gap: 5,
  } }, label, badge)
}

const watchBadge = (n) => h('span', {
  title: n + ' new watch matches',
  style: { minWidth: 14, height: 14, padding: '0 4px', borderRadius: 999, background: '#fff', color: 'var(--ui-blue, #3b82f6)', fontFamily: MONO, fontSize: '0.48rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
}, n > 99 ? '99+' : String(n))

// ── Settings ──────────────────────────────────────────────────────────────────
function Settings({ status, refresh }) {
  const configured = (status && status.configured) || {}
  return h('div', { style: { overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 } },
    h('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'Log in per platform, then hit “Test” to make a real API call and confirm it works before you post.'),
    PLATFORMS.map((p) => h(PlatformCard, { key: p.key, p, connected: !!configured[p.key], refresh }))
  )
}

function PlatformCard({ p, connected, refresh }) {
  const [vals, setVals] = React.useState({})
  const [testing, setTesting] = React.useState(false)
  const [testRes, setTestRes] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [show, setShow] = React.useState(false)

  const set = (k, v) => setVals((o) => ({ ...o, [k]: v }))

  const save = () => {
    setSaving(true); setSaved(false); setTestRes(null)
    fetch(API + '/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: p.key, creds: vals }),
    }).then((r) => r.json()).then((d) => { if (d.ok) { setSaved(true); refresh && refresh() } })
      .catch((e) => setTestRes({ ok: false, error: String(e) }))
      .finally(() => setSaving(false))
  }

  const test = () => {
    setTesting(true); setTestRes(null); setSaved(false)
    fetch(API + '/verify/' + p.key, { method: 'POST' })
      .then((r) => r.json()).then((d) => setTestRes(d))
      .catch((e) => setTestRes({ ok: false, error: String(e) }))
      .finally(() => { setTesting(false); refresh && refresh() })
  }

  return h('div', { style: cardStyle },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
      h('span', { style: { fontSize: 15, fontWeight: 700 } }, p.label),
      h('span', { style: badgeStyle(connected), fontSize: 10 }, connected ? '● connected' : '○ not set'),
      testRes && h('span', { style: { fontSize: 11, color: testRes.ok ? C_OK : C_ERR, marginLeft: 'auto' } }, testRes.ok ? '✓ verified' : '✗ failed')
    ),
    p.fields.map((f) =>
      h('div', { key: f.k, style: { marginBottom: 8 } },
        h('label', { style: { fontSize: 11, color: 'var(--ui-text-secondary, #b6bccb)', display: 'block', marginBottom: 3 } }, f.label),
        h('input', {
          type: (f.secret && !show) ? 'password' : 'text',
          placeholder: f.shared ? 'shared with Facebook' : f.label,
          value: vals[f.k] || '', onChange: (e) => set(f.k, e.target.value),
          style: fieldStyle,
        })
      )
    ),
    h('div', { style: { display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' } },
      h('button', { onClick: save, disabled: saving, style: btnStyle(false) }, saving ? 'Saving…' : 'Save'),
      h('button', { onClick: test, disabled: testing, style: btnStyle(true) }, testing ? 'Testing…' : 'Test'),
      p.fields.some((f) => f.secret) && h('label', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: show, onChange: (e) => setShow(e.target.checked) }), 'show'),
      saved && h('span', { style: { fontSize: 11, color: C_OK } }, 'saved')
    ),
    testRes && !testRes.ok && h('div', { style: { marginTop: 8, fontSize: 12, color: C_ERR, wordBreak: 'break-word' } }, String(testRes.error || 'failed'))
  )
}

// ── Compose ────────────────────────────────────────────────────────────────────
function Compose({ status, refresh, openInBrowse }) {
  const [platform, setPlatform] = React.useState('x')
  const [text, setText] = React.useState('')
  const [sub, setSub] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [imgUrl, setImgUrl] = React.useState('')
  const [videoUrl, setVideoUrl] = React.useState('')
  const [channel, setChannel] = React.useState('')
  const [twitchAction, setTwitchAction] = React.useState('chat')
  const [category, setCategory] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const configured = (status && status.configured) || {}
  const disabled = !configured[platform]
  const over = platform === 'x' && text.length > 280

  const send = () => {
    if (busy || disabled || over || !text.trim()) return
    setBusy(true); setResult(null)
    const body = { text }
    if (platform === 'reddit') { body.subreddit = sub; body.title = title }
    if (platform === 'instagram') body.image_url = imgUrl
    if (platform === 'tiktok') body.video_url = videoUrl
    if (platform === 'twitch') { body.action = twitchAction; if (twitchAction === 'title') body.category = category; else body.channel = channel }
    fetch(API + '/post/' + platform, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).then((d) => { setResult(d); if (d.ok) { setText(''); refresh && refresh() } })
      .catch((e) => setResult({ ok: false, error: String(e) })).finally(() => setBusy(false))
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' } },
    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      PLATFORMS.map((p) => h('button', { key: p.key, onClick: () => setPlatform(p.key), style: platBtn(platform === p.key, configured[p.key], disabled && !configured[p.key]) }, p.label))
    ),
    disabled && h('div', { style: { fontSize: 12, color: C_WARN } }, `⚠ ${platform} not configured — add creds in Settings (and hit Test).`),
    platform === 'reddit' && h('input', { placeholder: 'subreddit (e.g. python)', value: sub, onChange: (e) => setSub(e.target.value), style: fieldStyle }),
    platform === 'reddit' && h('input', { placeholder: 'title', value: title, onChange: (e) => setTitle(e.target.value), style: fieldStyle }),
    platform === 'instagram' && h('input', { placeholder: 'image URL (publicly hosted)', value: imgUrl, onChange: (e) => setImgUrl(e.target.value), style: fieldStyle }),
    platform === 'tiktok' && h('input', { placeholder: 'video URL (publicly hosted)', value: videoUrl, onChange: (e) => setVideoUrl(e.target.value), style: fieldStyle }),
    platform === 'twitch' && h('div', { style: { display: 'flex', gap: 6 } },
      h('button', { onClick: () => setTwitchAction('chat'), style: platBtn(twitchAction === 'chat') }, 'Chat'),
      h('button', { onClick: () => setTwitchAction('title'), style: platBtn(twitchAction === 'title') }, 'Set Title'),
    ),
    platform === 'twitch' && twitchAction === 'chat' && h('input', { placeholder: 'channel (optional, defaults to you)', value: channel, onChange: (e) => setChannel(e.target.value), style: fieldStyle }),
    platform === 'twitch' && twitchAction === 'title' && h('input', { placeholder: 'category (optional)', value: category, onChange: (e) => setCategory(e.target.value), style: fieldStyle }),
    h('textarea', { placeholder: platform === 'reddit' ? 'body text' : (platform === 'twitch' && twitchAction === 'title' ? 'new stream title' : 'what do you want to say?'), value: text, onChange: (e) => setText(e.target.value), rows: 5, style: { ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' } }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      h('button', { onClick: send, disabled: busy || disabled || over || !text.trim(), style: btnStyle(false, busy || disabled || over || !text.trim()) }, busy ? 'Sending…' : (platform === 'twitch' ? (twitchAction === 'title' ? 'Update' : 'Send') : 'Post')),
      platform === 'x' && h('a', { href: xIntent(text), target: '_blank', rel: 'noreferrer', style: { ...btnStyle(true), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }, title: 'Open X composer with this text prefilled' }, 'Open composer ↗'),
    ),
    h(ComposePreview, { platform, text, media: (imgUrl ? 'image' : '') + (videoUrl ? (imgUrl ? ' + video' : 'video') : '') }),
    h(ComposeOnSite, { text, openInBrowse }),
    result && h('div', { style: { padding: 10, borderRadius: 8, fontSize: 12, background: result.ok ? C_OK_BG : C_ERR_BG, color: result.ok ? C_OK : C_ERR, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, result.ok ? '✓ ' + (result.url || result.id || 'Posted') : '✗ ' + (result.error || 'failed'))
  )
}

// ── Mass Post ──────────────────────────────────────────────────────────────────
function MassPost({ status, refresh }) {
  const configured = (status && status.configured) || {}
  const allConn = PLATFORMS.filter((p) => configured[p.key]).map((p) => p.key)
  const [text, setText] = React.useState('')
  const [sel, setSel] = React.useState({})
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState(null)
  const [imgUrl, setImgUrl] = React.useState('')
  const [vidUrl, setVidUrl] = React.useState('')
  const [when, setWhen] = React.useState('')
  const [draftId, setDraftId] = React.useState(null)
  const [drafts, setDrafts] = React.useState([])
  const [note, setNote] = React.useState('')
  const over = text.length > 280
  const chosen = allConn.filter((k) => sel[k])

  const loadDrafts = React.useCallback(() => {
    fetch(API + '/drafts').then((r) => r.json()).then((d) => setDrafts(d.items || [])).catch(() => {})
  }, [])
  React.useEffect(() => { loadDrafts() }, [loadDrafts])

  const body = () => ({
    id: draftId || undefined, text, platforms: chosen,
    image_url: imgUrl || undefined, video_url: vidUrl || undefined,
  })

  const saveDraft = (scheduled) => {
    const b = body()
    if (scheduled !== undefined) b.scheduled_at = scheduled
    fetch(API + '/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      .then((r) => r.json()).then((d) => {
        if (d.ok) { setDraftId(d.draft.id); setNote(scheduled ? 'scheduled for ' + new Date(scheduled).toLocaleString() : 'draft saved'); loadDrafts() }
      })
  }

  const schedule = () => {
    if (!when) { setNote('pick a date/time first'); return }
    saveDraft(new Date(when).toISOString())
  }

  const openDraft = (d) => {
    setDraftId(d.id); setText(d.text || ''); setImgUrl(d.image_url || ''); setVidUrl(d.video_url || '')
    setSel((d.platforms || []).reduce((o, k) => ({ ...o, [k]: true }), {}))
    setWhen(d.scheduled_at ? new Date(d.scheduled_at).toISOString().slice(0, 16) : '')
    setNote('loaded draft ' + d.id)
  }

  const delDraft = (id) => {
    fetch(API + '/drafts/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      .then(() => { if (id === draftId) setDraftId(null); loadDrafts() })
  }

  const toggle = (k) => setSel((o) => ({ ...o, [k]: !o[k] }))

  const blast = () => {
    if (busy || !text.trim() || chosen.length === 0) return
    setBusy(true); setResults(null)
    fetch(API + '/mass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) })
      .then((r) => r.json()).then((d) => { setResults(d.results || {}); refresh && refresh(); loadDrafts() })
      .catch((e) => setResults({ _err: String(e) })).finally(() => setBusy(false))
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' } },
    h('textarea', { placeholder: 'One draft — posted to every platform you pick below.', value: text, onChange: (e) => setText(e.target.value), rows: 4, style: { ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' } }),
    h(ComposePreview, { platforms: chosen, text, media: (imgUrl ? 'image' : '') + (vidUrl ? (imgUrl ? ' + video' : 'video') : '') }),
    h('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'Post to:'),
    allConn.length === 0 && h('div', { style: { fontSize: 12, color: C_WARN } }, 'No platforms connected yet — add creds in Settings (and hit Test).'),
    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      allConn.map((k) => h('button', { key: k, onClick: () => toggle(k), style: platBtn(sel[k], true) }, PLATFORMS.find((p) => p.key === k).label))
    ),
    h('button', { onClick: blast, disabled: busy || !text.trim() || chosen.length === 0, style: btnStyle(false, busy || !text.trim() || chosen.length === 0) }, busy ? 'Posting…' : `Post to ${chosen.length || 0} platform${chosen.length === 1 ? '' : 's'}`),
    h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
      h('input', { placeholder: 'image URL (optional)', value: imgUrl, onChange: (e) => setImgUrl(e.target.value), style: { ...fieldStyle, flex: 1, minWidth: 160 } }),
      h('input', { placeholder: 'video URL (optional)', value: vidUrl, onChange: (e) => setVidUrl(e.target.value), style: { ...fieldStyle, flex: 1, minWidth: 160 } }),
    ),
    imgUrl && h('img', { src: imgUrl, style: { maxHeight: 160, borderRadius: 8, objectFit: 'cover', alignSelf: 'flex-start' } }),
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      h('input', { type: 'datetime-local', value: when, onChange: (e) => setWhen(e.target.value), style: { ...fieldStyle, width: 'auto' } }),
      h('button', { onClick: schedule, disabled: !text.trim(), style: platBtn(true) }, '🕒 Schedule'),
      h('button', { onClick: () => saveDraft(), disabled: !text.trim(), style: platBtn(false) }, '💾 Save draft'),
      draftId && h('button', { onClick: () => { setDraftId(null); setText(''); setWhen(''); setNote('new draft') }, style: platBtn(false) }, '+ New'),
      note && h('span', { style: { fontSize: 11, color: C_OK } }, note),
    ),
    drafts.length > 0 && h('div', { style: { marginTop: 6 } },
      h('div', { style: secTitleStyle }, 'Drafts & scheduled'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        drafts.map((d) => h('div', { key: d.id, style: { ...feedItemStyle, display: 'flex', gap: 8, alignItems: 'center' } },
          h('span', { style: badgeStyle(d.status === 'posted'), fontSize: 10 }, d.status),
          h('span', { style: { fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.text || '(empty)'),
          d.scheduled_at && h('span', { style: { fontSize: 10, color: '#a78bfa' } }, new Date(d.scheduled_at).toLocaleString()),
          h('button', { onClick: () => openDraft(d), style: platBtn(false) }, 'Edit'),
          h('button', { onClick: () => delDraft(d.id), style: platBtn(false) }, '✕'),
        ))
      )
    ),
    results && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
      Object.entries(results).map(([k, v]) =>
        h('div', { key: k, style: { padding: 10, borderRadius: 8, fontSize: 12, background: '#1a1a1a', border: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
          h('div', { style: { fontWeight: 600, marginBottom: 2 } }, PLATFORMS.find((p) => p.key === k) ? PLATFORMS.find((p) => p.key === k).label : k),
          v.ok && h('div', { style: { color: C_OK } }, '✓ ' + (v.url || v.id || 'Posted')),
          v.ok === false && v.link && h('a', { href: v.link, target: '_blank', rel: 'noreferrer', style: { color: '#60a5fa', textDecoration: 'none' } }, '↗ ' + (v.note || 'Open to post on X')),
          v.ok === false && !v.link && h('div', { style: { color: C_ERR, wordBreak: 'break-word' } }, '✗ ' + (v.error || 'failed')),
        )
      )
    )
  )
}

// ── Timeline (unified, searchable, credential-free) ──────────────────────────
const SRC_LABEL = { bluesky: 'Bluesky', mastodon: 'Mastodon', youtube: 'YouTube', rss: 'RSS', hn: 'HN', reddit: 'Reddit', instagram: 'Instagram', facebook: 'Facebook', twitch: 'Twitch', x: 'X' }
// Timeline source dots. Light variants for the ones that wash out on white.
const SRC_COLOR = { bluesky: '#3b82f6', mastodon: '#8b5cf6', youtube: '#ef4444', rss: '#f59e0b', hn: '#fb923c', reddit: '#f97316', instagram: '#ec4899', facebook: '#2563eb', twitch: '#a855f7', x: '#e5e7eb' }
const SRC_COLOR_LIGHT = { rss: '#af7007', hn: '#cc5e04', reddit: '#d35a05', x: '#24292f' }
const srcColor = (src, light) =>
  (light && SRC_COLOR_LIGHT[src]) || SRC_COLOR[src] || 'var(--ui-text-tertiary, #8b93a7)'

function useStream(path) {
  const [data, setData] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState(null)
  const load = React.useCallback((qs) => {
    setLoading(true); setErr(null)
    fetch(API + path + (qs ? '?' + qs : ''))
      .then((r) => r.json()).then(setData)
      .catch((e) => setErr(String(e))).finally(() => setLoading(false))
  }, [path])
  return { data, loading, err, load }
}

function Timeline({ status, openInBrowse }) {
  const light = useIsLight()
  const { data, loading, err, load } = useStream('/timeline')
  const [only, setOnly] = React.useState({})
  const [auto, setAuto] = React.useState(false)
  // Pending items are held back so a background refresh never yanks the
  // scroll position out from under you — you opt in via the "N new" pill.
  const [pending, setPending] = React.useState([])
  const [seenIds, setSeenIds] = React.useState(() => new Set())
  const [per, setPer] = React.useState(15)
  const scroller = React.useRef(null)
  const perRef = React.useRef(15)

  const qsFor = React.useCallback((n) => {
    const sel = Object.keys(only).filter((k) => only[k])
    const p = ['per=' + n, 'limit=' + n * 6]
    if (sel.length) p.push('sources=' + sel.join(','))
    return p.join('&')
  }, [only])

  const qs = React.useCallback(() => qsFor(per), [qsFor, per])

  React.useEffect(() => { load(qs()) }, [])

  // Source filter toggles refetch from the first window.
  const firstRun = React.useRef(true)
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    reload()
  }, [only])

  // Track what's on screen so a poll can tell genuinely-new items apart.
  const items = (data && data.items) || []
  React.useEffect(() => {
    if (!items.length) return
    setSeenIds(new Set(items.map((i) => i.source + i.id)))
    setPending([])
  }, [data])

  // Background poll: fetch, diff, stash. Never swaps the visible list.
  React.useEffect(() => {
    if (!auto) return
    const tick = () => {
      fetch(API + '/timeline?' + qs()).then((r) => r.json()).then((d) => {
        const fresh = (d.items || []).filter((i) => !seenIds.has(i.source + i.id))
        if (fresh.length) setPending(fresh)
      }).catch(() => {})
    }
    const t = setInterval(tick, 60000)
    return () => clearInterval(t)
  }, [auto, qs, seenIds])

  const showPending = () => {
    load(qs())
    setPending([])
    if (scroller.current) scroller.current.scrollTop = 0
  }

  // Infinite scroll: near the bottom, widen the per-source window and refetch.
  // The backend pages by per/limit, so growing the window is the honest way to
  // reach further back without inventing a cursor the API doesn't have.
  const maxedOut = data && data.count != null && items.length > 0 && data.count < per * 6
  const onScroll = (e) => {
    const el = e.currentTarget
    if (loading || maxedOut || per >= 60) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 400) return
    const next = Math.min(per + 15, 60)
    if (next === perRef.current) return
    perRef.current = next
    setPer(next)
    load(qsFor(next))
  }

  // Any change of query or filters restarts paging from the first window.
  const reload = React.useCallback(() => {
    perRef.current = 15
    setPer(15)
    setPending([])
    load(qsFor(15))
    if (scroller.current) scroller.current.scrollTop = 0
  }, [qsFor, load])

  const avail = (data && data.sources) || Object.keys(SRC_LABEL)
  const errors = (data && data.errors) || {}
  const toggle = (k) => setOnly((o) => ({ ...o, [k]: !o[k] }))
  // When X is the sole focused source, show the live interactive X site
  // (full browser webview) instead of the API post list — X's free tier
  // blocks API reads, and the live site is what "the X tab" should be.
  const onlyX = only.x && Object.keys(only).filter((k) => only[k]).length === 1

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', alignItems: 'center', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      h('button', { onClick: reload, disabled: loading, style: platBtn(false) }, loading ? '↻…' : '↻'),
      h('button', { onClick: () => setAuto((a) => !a), title: 'check for new posts every 60s', style: platBtn(auto) }, auto ? '⏱ on' : '⏱ off'),
    ),
    h('div', { style: { display: 'flex', gap: 6, padding: '0 10px 8px', flexWrap: 'wrap', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      avail.map((k) => h('button', { key: k, onClick: () => toggle(k),
        style: { ...platBtn(!!only[k]), borderColor: only[k] ? srcColor(k, light) : 'var(--ui-stroke-secondary, #2a2f3a)' } }, SRC_LABEL[k] || k)),
      Object.keys(only).some((k) => only[k]) && h('button', { onClick: () => setOnly({}), style: { ...platBtn(false), marginLeft: 'auto' } }, 'clear'),
    ),
    err && h('div', { style: { padding: 10, color: C_ERR, fontSize: 12 } }, err),
    Object.keys(errors).length > 0 && h('div', { style: { padding: '6px 10px', fontSize: 11, color: C_WARN } },
      Object.entries(errors).map(([k, v]) => (SRC_LABEL[k] || k) + ': ' + v).join('  ·  ')),
    pending.length > 0 && h('button', { onClick: showPending, style: {
      position: 'absolute', top: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
      padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
      background: 'var(--ui-blue, #3b82f6)', color: '#fff', border: 'none',
      fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
      letterSpacing: '0.14em', textTransform: 'uppercase',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    } }, '↑ ' + pending.length + ' new post' + (pending.length === 1 ? '' : 's')),
    h('div', { ref: scroller, onScroll, style: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
      onlyX
        ? h(XBrowser, { initialUrl: 'https://x.com/home' })
        : [
            loading && items.length === 0 && h('div', { key: 'ld', style: secBodyStyle }, 'loading…'),
            !loading && items.length === 0 && h('div', { key: 'mt', style: secBodyStyle }, 'nothing yet'),
            items.map((it) => h(StreamItem, { key: it.source + it.id, it, openInBrowse })),
            items.length > 0 && h('div', { key: 'end', style: {
              padding: '10px 0 4px', textAlign: 'center', fontFamily: MONO,
              fontSize: '0.5rem', letterSpacing: '0.16em', textTransform: 'uppercase',
              color: 'var(--ui-text-tertiary, #8b93a7)',
            } }, loading ? 'loading more…' : (maxedOut || per >= 60) ? '· end of feed ·' : 'scroll for more'),
          ]
    )
  )
}

function Avatar({ src, name, size = 34 }) {
  const initial = (name || '?').replace(/^@/, '').slice(0, 1).toUpperCase()
  if (src) {
    return h('img', { src, alt: name || '', style: {
      width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
      border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', background: 'rgba(128,128,128,0.15)',
    } })
  }
  return h('div', { style: {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(128,128,128,0.18)', color: 'var(--ui-text-tertiary, #8b93a7)',
    fontFamily: MONO, fontSize: size * 0.4, fontWeight: 700,
  } }, initial)
}

function ImageGrid({ images }) {
  const n = images.length
  if (!n) return null
  const cols = n === 1 ? 1 : 2
  return h('div', { style: {
    marginTop: 8, display: 'grid', gap: 4, gridTemplateColumns: `repeat(${cols}, 1fr)`,
    borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
  } },
    images.map((im, i) => h('a', { key: i, href: im.full || im.thumb, target: '_blank', rel: 'noreferrer', style: { display: 'block', lineHeight: 0 } },
      h('img', { src: im.thumb || im.full, alt: im.alt || '', title: im.alt || '', loading: 'lazy', style: {
        width: '100%', height: n === 1 ? 'auto' : 130, maxHeight: n === 1 ? 320 : 130,
        objectFit: 'cover', display: 'block',
      } })
    ))
  )
}

function LinkCard({ link }) {
  if (!link || !link.url) return null
  let host = ''
  try { host = new URL(link.url).hostname.replace(/^www\./, '') } catch (e) { host = '' }
  return h('a', { href: link.url, target: '_blank', rel: 'noreferrer', style: {
    marginTop: 8, display: 'flex', gap: 10, textDecoration: 'none', color: 'inherit',
    border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 10,
    overflow: 'hidden', background: 'rgba(128,128,128,0.06)',
  } },
    link.thumb && h('img', { src: link.thumb, alt: '', loading: 'lazy', style: { width: 92, height: 92, objectFit: 'cover', flexShrink: 0 } }),
    h('div', { style: { padding: '8px 10px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
      host && h('span', { style: { fontFamily: MONO, fontSize: '0.52rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)' } }, host),
      link.title && h('span', { style: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 } }, link.title.slice(0, 120)),
      link.description && h('span', { style: { fontSize: 11.5, color: 'var(--ui-text-tertiary, #8b93a7)', lineHeight: 1.35 } }, link.description.slice(0, 140)),
    )
  )
}

function QuoteCard({ q }) {
  if (!q) return null
  return h('div', { style: {
    marginTop: 8, padding: 10, borderRadius: 10,
    border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', background: 'rgba(128,128,128,0.06)',
  } },
    h('div', { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4 } },
      h(Avatar, { src: q.avatar, name: q.name || q.author, size: 20 }),
      h('span', { style: { fontSize: 11.5, fontWeight: 600 } }, q.name || q.author),
      h('span', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)' } }, '@' + q.author),
      q.created_at && h('span', { style: { fontSize: 10, color: 'var(--ui-text-tertiary, #8b93a7)', marginLeft: 'auto' } }, ago(q.created_at)),
    ),
    h('div', { style: { fontSize: 12.5, lineHeight: 1.4, whiteSpace: 'pre-wrap' } }, (q.text || '').slice(0, 300)),
  )
}

function VideoEmbed({ video, url }) {
  const [play, setPlay] = React.useState(false)
  if (!video) return null
  if (video.youtube_id) {
    if (play) {
      return h('div', { style: { marginTop: 8, position: 'relative', paddingBottom: '56.25%', borderRadius: 10, overflow: 'hidden' } },
        h('iframe', {
          src: 'https://www.youtube-nocookie.com/embed/' + video.youtube_id + '?autoplay=1',
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture',
          allowFullScreen: true, frameBorder: '0',
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 },
        })
      )
    }
    return h('button', { onClick: () => setPlay(true), title: 'Play inline', style: {
      marginTop: 8, position: 'relative', display: 'block', width: '100%', padding: 0,
      border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 10,
      overflow: 'hidden', cursor: 'pointer', background: '#000', lineHeight: 0,
    } },
      video.thumb && h('img', { src: video.thumb, alt: '', loading: 'lazy', style: { width: '100%', display: 'block', opacity: 0.85 } }),
      h('span', { style: {
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,0,0,0.65)',
        border: '2px solid rgba(255,255,255,0.9)', color: '#fff', fontSize: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 4,
      } }, '▶'),
    )
  }
  if (video.playlist) {
    return h('video', { controls: true, poster: video.thumb || undefined, src: video.playlist,
      style: { marginTop: 8, width: '100%', borderRadius: 10, maxHeight: 320, background: '#000' } })
  }
  return null
}

function StreamItem({ it, openInBrowse }) {
  const light = useIsLight()
  const body = it.text || ''
  const heading = it.title && it.title !== it.text ? it.title : ''
  const display = it.source === 'bluesky' || it.source === 'mastodon' ? (it.title || it.author) : ''
  const images = it.images || []
  return h('div', { style: cardShell },
    h('div', { style: { display: 'flex', gap: 10 } },
      h(Avatar, { src: it.avatar, name: display || it.author || it.source }),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } },
          display && h('span', { style: { fontSize: 13, fontWeight: 700 } }, display),
          it.author && h('span', { style: { fontSize: 11.5, color: 'var(--ui-text-tertiary, #8b93a7)' } }, '@' + it.author),
          h('span', { style: { fontSize: 10, color: 'var(--ui-text-tertiary, #8b93a7)' } }, '· ' + ago(it.created_at)),
          h('span', { style: { marginLeft: 'auto', fontFamily: MONO, fontSize: '0.48rem', fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
            color: srcColor(it.source, light),
            border: '1px solid ' + srcColor(it.source, light) + (light ? '66' : '55'),
            background: srcColor(it.source, light) + (light ? '14' : '18') } }, SRC_LABEL[it.source] || it.source),
        ),
        heading && h('div', { style: { fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, marginTop: 4 } }, heading),
        body && h('div', { style: { fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', marginTop: heading ? 3 : 4, overflowWrap: 'anywhere' } }, body.slice(0, 700)),
        h(VideoEmbed, { video: it.video, url: it.url }),
        images.length > 0 && h(ImageGrid, { images }),
        !it.video && images.length === 0 && h(LinkCard, { link: it.link }),
        h('div', { style: { marginTop: 8, display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)' } },
          it.score != null && h('span', null, '♥ ' + it.score),
          it.num_comments != null && h('span', null, '💬 ' + it.num_comments),
          it.url && openInBrowse && h('button', {
            onClick: () => openInBrowse(SITE_BY_KEY[it.source] ? it.source : 'x', it.url),
            title: 'Open this post on the live site inside Hermes',
            style: {
              marginLeft: 'auto', background: 'transparent', cursor: 'pointer',
              border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 999,
              padding: '2px 9px', color: 'var(--ui-text-secondary, #b6bccb)',
              fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase',
            },
          }, 'Open here'),
          it.url && h('a', { href: it.url, target: '_blank', rel: 'noreferrer', style: {
            marginLeft: openInBrowse ? 0 : 'auto', color: 'var(--ui-text-tertiary, #8b93a7)', textDecoration: 'none',
            fontFamily: MONO, fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase',
          } }, 'Open ↗'),
        ),
        h(QuoteCard, { q: it.quote }),
      )
    )
  )
}

// ── Inbox: agent-to-agent messaging + platform engagement ────────────────────
function Inbox({ status }) {
  const [mode, setMode] = React.useState('messages')
  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      h(Tab, { active: mode === 'messages', onClick: () => setMode('messages'), label: 'Messages' }),
      h(Tab, { active: mode === 'activity', onClick: () => setMode('activity'), label: 'Activity' }),
    ),
    mode === 'messages' ? h(Messages, null) : h(Engagement, null),
  )
}

// Direct, signed messaging between Hermes agents. No central server: messages
// are POSTed straight to the peer's /a2a/inbox.
function Messages() {
  const [me, setMe] = React.useState(null)
  const [threads, setThreads] = React.useState([])
  const [active, setActive] = React.useState(null)
  const [draft, setDraft] = React.useState('')
  const [err, setErr] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [showAdd, setShowAdd] = React.useState(false)
  const endRef = React.useRef(null)

  const refresh = React.useCallback(() => {
    fetch(API + '/a2a/threads').then((r) => r.json()).then((d) => setThreads(d.threads || [])).catch(() => {})
  }, [])

  React.useEffect(() => {
    fetch(API + '/a2a/identity').then((r) => r.json()).then(setMe).catch(() => {})
    refresh()
    const t = setInterval(refresh, 10000)  // near-live without a socket
    return () => clearInterval(t)
  }, [refresh])

  const conv = threads.find((t) => t.thread === active) || null

  React.useEffect(() => {
    if (conv && conv.unread) fetch(API + '/a2a/read', { method: 'POST', headers: JH, body: JSON.stringify({ thread: conv.thread }) }).then(refresh)
    if (endRef.current) endRef.current.scrollIntoView({ block: 'end' })
  }, [active, conv && conv.messages.length])

  const send = () => {
    if (!draft.trim() || !conv) return
    setSending(true); setErr('')
    fetch(API + '/a2a/send', { method: 'POST', headers: JH, body: JSON.stringify({ to: conv.peer, thread: conv.thread, body: draft.trim() }) })
      .then((r) => r.json()).then((d) => {
        if (!d.ok) setErr(d.error || 'send failed')
        else { setDraft(''); refresh() }
      }).catch((e) => setErr(String(e))).finally(() => setSending(false))
  }

  return h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
    // ── conversation list ──
    h('div', { style: { width: 210, borderRight: '1px solid var(--ui-stroke-secondary, #2a2f3a)', display: 'flex', flexDirection: 'column' } },
      h('div', { style: { padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
        h('button', { onClick: () => setShowAdd(true), style: { ...platBtn(false), width: '100%' } }, '+ New conversation'),
      ),
      h('div', { style: { flex: 1, overflowY: 'auto' } },
        threads.length === 0 && h('div', { style: { ...secBodyStyle, padding: 10 } }, 'No conversations yet.'),
        threads.map((t) => h('button', { key: t.thread, onClick: () => setActive(t.thread), style: {
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          padding: '9px 10px', border: 'none', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
          background: active === t.thread ? 'rgba(59,130,246,0.14)' : 'transparent', color: 'var(--ui-text-primary, #e7e9ee)',
        } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.peer_name || t.peer),
            t.unread > 0 && h('span', { style: { marginLeft: 'auto', minWidth: 16, textAlign: 'center', borderRadius: 999, background: 'var(--ui-blue, #3b82f6)', color: '#fff', fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700, padding: '1px 5px' } }, String(t.unread)),
          ),
          h('div', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 } }, t.preview || ''),
        )),
      ),
      h(AutoReply, { threads }),
      me && h('div', { style: { padding: '8px 10px', borderTop: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
        h('div', { style: { fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'Your address'),
        h('div', { title: 'Share this with another agent so they can message you',
          style: { fontFamily: MONO, fontSize: 10, marginTop: 3, overflowWrap: 'anywhere', color: 'var(--ui-text-primary, #e7e9ee)' } }, me.address),
      ),
    ),
    // ── conversation ──
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 } },
      showAdd && h(NewConversation, { onClose: () => setShowAdd(false), onDone: (th) => { setShowAdd(false); refresh(); if (th) setActive(th) } }),
      !conv && !showAdd && h('div', { style: { ...secBodyStyle, padding: 16 } },
        me ? 'Pick a conversation, or start one with another agent’s hx_ address.' : 'connecting…'),
      conv && h(React.Fragment, null,
        h('div', { style: { padding: '8px 12px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
          h('div', { style: { fontSize: 13, fontWeight: 700 } }, conv.peer_name || conv.peer),
          h('div', { style: { fontFamily: MONO, fontSize: 10, color: 'var(--ui-text-tertiary, #8b93a7)', overflowWrap: 'anywhere' } }, conv.peer),
        ),
        h('div', { style: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
          conv.messages.map((m) => h(Bubble, { key: m.id, m })),
          h('div', { ref: endRef }),
        ),
        err && h('div', { style: { padding: '6px 12px', color: C_ERR, fontSize: 12 } }, err),
        h('div', { style: { display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
          h('input', { value: draft, placeholder: 'Message ' + (conv.peer_name || 'agent') + '…',
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } },
            style: { ...fieldStyle, flex: 1 } }),
          h('button', { onClick: send, disabled: sending || !draft.trim(), style: platBtn(true) }, sending ? '…' : 'Send'),
        ),
      ),
    ),
  )
}

// Controls whether the local Hermes agent answers inbound messages by itself.
function AutoReply({ threads }) {
  const [cfg, setCfg] = React.useState(null)
  const [log, setLog] = React.useState([])
  const [open, setOpen] = React.useState(false)

  const pull = React.useCallback(() => {
    fetch(API + '/a2a/autoreply').then((r) => r.json()).then((d) => { setCfg(d.config); setLog(d.log || []) }).catch(() => {})
  }, [])
  React.useEffect(() => { pull(); const t = setInterval(pull, 15000); return () => clearInterval(t) }, [pull])

  const save = (patch) => {
    setCfg((c) => ({ ...c, ...patch }))
    fetch(API + '/a2a/autoreply', { method: 'POST', headers: JH, body: JSON.stringify(patch) })
      .then((r) => r.json()).then((d) => d.config && setCfg(d.config)).catch(() => {})
  }
  if (!cfg) return null

  const peers = Array.from(new Set((threads || []).map((t) => t.peer).filter(Boolean)))
  return h('div', { style: { borderTop: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
    h('button', { onClick: () => setOpen((o) => !o), style: {
      display: 'flex', alignItems: 'center', gap: 6, width: '100%', cursor: 'pointer',
      padding: '7px 10px', background: 'transparent', border: 'none', color: 'var(--ui-text-primary, #e7e9ee)',
    } },
      h('span', { style: {
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: cfg.enabled ? C_OK : 'var(--ui-text-tertiary, #8b93a7)',
        boxShadow: cfg.enabled ? '0 0 6px #22c55e' : 'none',
      } }),
      h('span', { style: { fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)' } },
        'Auto-reply ' + (cfg.enabled ? 'on' : 'off')),
      h('span', { style: { marginLeft: 'auto', fontSize: 10, color: 'var(--ui-text-tertiary, #8b93a7)' } }, open ? '▾' : '▸'),
    ),
    open && h('div', { style: { padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 7 } },
      h('div', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)', lineHeight: 1.4 } },
        'Your agent answers inbound messages on its own, using the local model.'),
      h('label', { style: rowLbl },
        h('input', { type: 'checkbox', checked: !!cfg.enabled, onChange: (e) => save({ enabled: e.target.checked }) }),
        'Enable auto-reply'),
      h('label', { style: rowLbl },
        h('input', { type: 'checkbox', checked: !!cfg.allow_all, onChange: (e) => save({ allow_all: e.target.checked }) }),
        'Reply to any agent'),
      !cfg.allow_all && h('div', null,
        h('div', { style: { ...secTitleStyle, marginTop: 2 } }, 'Allowed senders'),
        peers.length === 0 && h('div', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'No known peers yet.'),
        peers.map((p) => h('label', { key: p, style: { ...rowLbl, fontFamily: MONO, fontSize: 10 } },
          h('input', { type: 'checkbox', checked: (cfg.allowed || []).includes(p),
            onChange: (e) => save({ allowed: e.target.checked ? [...(cfg.allowed || []), p] : (cfg.allowed || []).filter((x) => x !== p) }) }),
          p)),
      ),
      h('label', { style: { ...rowLbl, justifyContent: 'space-between' } }, 'Max auto-replies per thread',
        h('input', { type: 'number', min: 1, max: 50, value: cfg.max_turns,
          onChange: (e) => save({ max_turns: Number(e.target.value) || 1 }),
          style: { ...fieldStyle, width: 62, padding: '3px 6px' } })),
      h('textarea', { value: cfg.persona || '', rows: 2,
        placeholder: 'Optional persona, e.g. "Terse robotics engineer."',
        onChange: (e) => setCfg({ ...cfg, persona: e.target.value }),
        onBlur: (e) => save({ persona: e.target.value }),
        style: { ...fieldStyle, resize: 'vertical' } }),
      log.length > 0 && h('div', null,
        h('div', { style: secTitleStyle }, 'Recent activity'),
        h('div', { style: { fontFamily: MONO, fontSize: 9.5, color: 'var(--ui-text-tertiary, #8b93a7)', maxHeight: 90, overflowY: 'auto', lineHeight: 1.5 } },
          log.slice(-6).reverse().map((ln, i) => h('div', { key: i, style: { overflowWrap: 'anywhere' } }, ln))),
      ),
    ),
  )
}

const rowLbl = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer' }

function Bubble({ m }) {
  const out = m.dir === 'out'
  return h('div', { style: { display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' } },
    h('div', { style: {
      maxWidth: '78%', padding: '8px 11px', borderRadius: 12,
      borderBottomRightRadius: out ? 3 : 12, borderBottomLeftRadius: out ? 12 : 3,
      background: out ? 'var(--ui-blue, #3b82f6)' : 'rgba(128,128,128,0.14)',
      color: out ? '#fff' : 'var(--ui-text-primary, #e7e9ee)',
      border: out ? 'none' : '1px solid var(--ui-stroke-secondary, #2a2f3a)',
    } },
      h('div', { style: { fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, m.body),
      h('div', { title: 'Signature verified on receipt', style: {
        marginTop: 4, fontFamily: MONO, fontSize: '0.45rem', letterSpacing: '0.1em',
        textTransform: 'uppercase', opacity: 0.7,
      } }, (out ? '' : '✓ signed · ') + (m.auto ? '🤖 auto · ' : '') + ago(m.ts)),
    )
  )
}

function NewConversation({ onClose, onDone }) {
  const [addr, setAddr] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')
  const [found, setFound] = React.useState(null)
  const [scan, setScan] = React.useState(false)

  // Agents on the same network announce themselves, so the common case is
  // picking one from a list rather than typing an address and a URL.
  const look = React.useCallback(() => {
    setScan(true)
    fetch(API + '/a2a/discover').then((r) => r.json())
      .then((d) => setFound(d)).catch(() => setFound({ peers: [] }))
      .finally(() => setScan(false))
  }, [])
  React.useEffect(() => { look(); const t = setInterval(look, 5000); return () => clearInterval(t) }, [look])

  const pick = (p) => { setAddr(p.address); setUrl(p.url); setErr('') }

  const go = () => {
    if (!addr.trim() || !body.trim()) return
    setBusy(true); setErr('')
    // Verify the peer before sending, so a bad address fails with a clear
    // reason instead of a vague delivery error.
    fetch(API + '/a2a/connect', { method: 'POST', headers: JH, body: JSON.stringify({ address: addr.trim(), url: url.trim() }) })
      .then((r) => r.json()).then((c) => {
        if (!c.ok) throw new Error(c.error || 'could not connect')
        return fetch(API + '/a2a/send', { method: 'POST', headers: JH, body: JSON.stringify({ to: addr.trim(), url: url.trim(), body: body.trim() }) }).then((r) => r.json())
      })
      .then((d) => { if (!d.ok) throw new Error(d.error || 'send failed'); onDone(d.thread) })
      .catch((e) => setErr(String(e.message || e))).finally(() => setBusy(false))
  }

  const peers = (found && found.peers) || []
  return h('div', { style: { padding: 14, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
      h('span', { style: { fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'New conversation'),
      h('span', { style: { marginLeft: 'auto', fontSize: 10, color: 'var(--ui-text-tertiary, #8b93a7)' } },
        scan ? 'scanning…' : peers.length + ' on this network'),
    ),
    peers.length > 0 && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      peers.map((p) => h('button', { key: p.address, onClick: () => pick(p), style: {
        display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer',
        padding: '7px 9px', borderRadius: 8, color: 'var(--ui-text-primary, #e7e9ee)',
        border: '1px solid ' + (addr === p.address ? 'var(--ui-blue, #3b82f6)' : 'var(--ui-stroke-secondary, #2a2f3a)'),
        background: addr === p.address ? 'rgba(59,130,246,0.12)' : 'rgba(128,128,128,0.05)',
      } },
        h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: C_OK, flexShrink: 0 } }),
        h('span', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 12, fontWeight: 700 } }, p.name || p.address),
          h('div', { style: { fontFamily: MONO, fontSize: 9.5, color: 'var(--ui-text-tertiary, #8b93a7)', overflowWrap: 'anywhere' } }, p.address + ' · ' + (p.url || 'no url')),
        ),
        p.known && h('span', { style: { marginLeft: 'auto', fontFamily: MONO, fontSize: '0.45rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C_OK } }, 'known'),
      )),
    ),
    found && !found.running && h('div', { style: { fontSize: 10.5, color: C_WARN } },
      'Network discovery is off' + (found.error ? ': ' + found.error : '') + '. You can still connect manually below.'),
    h('input', { value: addr, onChange: (e) => setAddr(e.target.value), placeholder: 'Agent address (hx_…)', style: fieldStyle }),
    h('input', { value: url, onChange: (e) => setUrl(e.target.value), placeholder: 'Their URL (http://host:8731)', style: fieldStyle }),
    h('textarea', { value: body, onChange: (e) => setBody(e.target.value), placeholder: 'First message…', rows: 3, style: { ...fieldStyle, resize: 'vertical' } }),
    err && h('div', { style: { color: C_ERR, fontSize: 12 } }, err),
    h('div', { style: { display: 'flex', gap: 6 } },
      h('button', { onClick: go, disabled: busy || !addr.trim() || !body.trim(), style: platBtn(true) }, busy ? 'Connecting…' : 'Connect & send'),
      h('button', { onClick: onClose, style: platBtn(false) }, 'Cancel'),
    ),
  )
}

// Platform engagement (mentions, replies, followers) — the original inbox.
function Engagement() {
  const { data, loading, err, load } = useStream('/inbox')
  React.useEffect(() => { load('limit=40') }, [])
  const items = (data && data.items) || []
  const errors = (data && data.errors) || {}
  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      h('span', { style: { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'Mentions, replies and new followers across connected platforms.'),
      h('button', { onClick: () => load('limit=40'), disabled: loading, style: { ...platBtn(false), marginLeft: 'auto' } }, loading ? '↻…' : '↻ Refresh'),
    ),
    err && h('div', { style: { padding: 10, color: C_ERR, fontSize: 12 } }, err),
    data && data.hint && h('div', { style: { padding: 10, fontSize: 12, color: C_WARN } }, '⚠ ' + data.hint),
    Object.keys(errors).length > 0 && h('div', { style: { padding: '6px 10px', fontSize: 11, color: C_WARN } },
      Object.entries(errors).map(([k, v]) => (SRC_LABEL[k] || k) + ': ' + v).join('  ·  ')),
    h('div', { style: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
      loading && items.length === 0 && h('div', { style: secBodyStyle }, 'loading…'),
      !loading && items.length === 0 && !((data || {}).hint) && h('div', { style: secBodyStyle }, 'nothing yet'),
      items.map((it) => h(StreamItem, { key: it.source + it.id, it })),
    )
  )
}

// Sources and Settings were two tabs configuring the same thing: where content
// comes from. One tab, two sections — feeds (no login) and accounts (creds).
function SettingsHub({ status, refresh }) {
  const [sec, setSec] = React.useState('feeds')
  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    h('div', { style: { display: 'flex', gap: 6, padding: '10px 12px 0', flexShrink: 0 } },
      h(Seg, { active: sec === 'feeds', onClick: () => setSec('feeds'), label: 'Feeds' }),
      h(Seg, { active: sec === 'accounts', onClick: () => setSec('accounts'), label: 'Accounts' }),
    ),
    sec === 'feeds' ? h(Sources, {}) : h(Settings, { status, refresh }),
  )
}

function Seg({ active, onClick, label }) {
  return h('button', { onClick, style: {
    padding: '5px 12px', borderRadius: 7, cursor: 'pointer', flexShrink: 0,
    fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
    letterSpacing: '0.14em', textTransform: 'uppercase',
    color: active ? 'var(--ui-text-primary, #e7e9ee)' : 'var(--ui-text-tertiary, #8b93a7)',
    background: active ? F_STRONG : 'transparent',
    border: '1px solid ' + (active ? 'var(--ui-stroke-secondary, #2a2f3a)' : 'transparent'),
  } }, label)
}

// ── Sources (credential-free feed config) ─────────────────────────────────────
const TOGGLEABLE = ['bluesky', 'mastodon', 'youtube', 'rss', 'hn', 'reddit']

function Sources() {
  const light = useIsLight()
  const [src, setSrc] = React.useState(null)
  const [saved, setSaved] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    fetch(API + '/sources').then((r) => r.json()).then((d) => setSrc(d.sources || {})).catch(() => setSrc({}))
  }, [])
  if (!src) return h('div', { style: { padding: 12, ...secBodyStyle } }, 'loading…')

  const set = (k, v) => { setSrc((o) => ({ ...o, [k]: v })); setSaved(false) }
  const enabled = src.enabled || []
  const toggle = (k) => set('enabled', enabled.includes(k) ? enabled.filter((x) => x !== k) : [...enabled, k])
  const save = () => {
    setBusy(true)
    fetch(API + '/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: src }) })
      .then((r) => r.json()).then((d) => { if (d.ok) { setSrc(d.sources); setSaved(true) } })
      .finally(() => setBusy(false))
  }

  return h('div', { style: { overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 } },
    h('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'These feeds need no login at all — Bluesky, Mastodon, YouTube, RSS, Hacker News and Reddit all read anonymously. Everything here flows into Timeline.'),
    h('div', { style: cardStyle },
      h('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 8 } }, 'Active in Timeline'),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        TOGGLEABLE.map((k) => h('button', { key: k, onClick: () => toggle(k),
          style: { ...platBtn(enabled.includes(k)), borderColor: enabled.includes(k) ? srcColor(k, light) : 'var(--ui-stroke-secondary, #2a2f3a)' } }, SRC_LABEL[k] || k))
      )
    ),
    h('div', { style: cardStyle },
      LIST_FIELDS.map((f) => h(FeedList, {
        key: f.k, label: f.label, hint: f.hint, ph: f.ph,
        values: src[f.k] || [], onChange: (v) => set(f.k, v),
      })),
      h('div', { style: { marginBottom: 10 } },
        h('label', { style: { fontSize: 11, color: 'var(--ui-text-secondary, #b6bccb)', display: 'block', marginBottom: 1 } }, 'Mastodon instance'),
        h('div', { style: { fontSize: 10.5, color: 'var(--ui-text-tertiary, #8b93a7)', marginBottom: 4 } }, 'Public timeline. mastodon.social needs auth — fosstodon.org does not.'),
        h('input', { placeholder: 'fosstodon.org', value: src.mastodon_instance || '', onChange: (e) => set('mastodon_instance', e.target.value), style: fieldStyle }),
      ),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('button', { onClick: save, disabled: busy, style: btnStyle(true, busy) }, busy ? 'Saving…' : 'Save sources'),
        saved && h('span', { style: { fontSize: 11, color: C_OK } }, 'saved — Timeline will use these on next refresh'),
      )
    )
  )
}

// A list-valued source field: add/remove several feeds of the same kind.
function FeedList({ label, hint, values, onChange, ph }) {
  const [draft, setDraft] = React.useState('')
  const list = values || []
  const add = () => {
    const v = draft.trim()
    if (!v || list.includes(v)) { setDraft(''); return }
    onChange([...list, v]); setDraft('')
  }
  return h('div', { style: { marginBottom: 14 } },
    h('label', { style: { fontSize: 11, color: 'var(--ui-text-secondary, #b6bccb)', display: 'block', marginBottom: 1 } }, label),
    hint && h('div', { style: { fontSize: 10.5, color: 'var(--ui-text-tertiary, #8b93a7)', marginBottom: 4 } }, hint),
    list.length > 0 && h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 5 } },
      list.map((v) => h('span', { key: v, style: {
        display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
        padding: '3px 6px 3px 8px', borderRadius: 999, fontSize: 11,
        border: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
        background: 'rgba(128,128,128,0.10)',
      } },
        h('span', { title: v, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 230 } }, v),
        h('button', { title: 'Remove', onClick: () => onChange(list.filter((x) => x !== v)), style: {
          border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
          color: 'var(--ui-text-tertiary, #8b93a7)', fontSize: 13, lineHeight: 1,
        } }, '×'),
      )),
    ),
    h('div', { style: { display: 'flex', gap: 5 } },
      h('input', { placeholder: ph, value: draft,
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add() } },
        style: { ...fieldStyle, flex: 1 } }),
      h('button', { onClick: add, disabled: !draft.trim(), style: platBtn(false) }, '+ Add'),
    ),
  )
}

const LIST_FIELDS = [
  { k: 'rss_urls', label: 'RSS / Atom feeds', ph: 'https://example.com/feed', hint: 'Any blog or news feed. Several supported.' },
  { k: 'subreddits', label: 'Subreddits', ph: 'robotics', hint: 'Fetched one at a time — Reddit blocks parallel reads.' },
  { k: 'bluesky_handles', label: 'Bluesky handles', ph: 'someone.bsky.social', hint: 'Public posts, no login.' },
  { k: 'youtube_channels', label: 'YouTube channels', ph: 'UCxxxxxxxxxxxxxxxxxxxxxx', hint: 'Channel ID (starts with UC), from the channel’s About page.' },
]

// ── Browse: every social site, live, inside Hermes ────────────────────────────
// A normal <iframe> to x.com is BLOCKED by X-Frame-Options: DENY, so a
// read-only embed is the most an iframe can show. To get the FULL interactive
// site we use an Electron <webview> guest. The Hermes chat window sets
// webviewTag: true (electron/session-windows.cjs) with no CSP webview-src
// restriction, so a webview is a real top-level navigation that ignores
// X-Frame-Options. Each site gets its OWN persistent partition, so logging into
// X doesn't disturb Reddit and every login survives reloads and restarts.
// Posting/scrolling/DMs all work here, exactly like a browser.
const SITES = [
  { key: 'x', label: 'X', color: '#e5e7eb', url: 'https://x.com/home', mark: '𝕏' },
  { key: 'reddit', label: 'Reddit', color: '#f97316', url: 'https://www.reddit.com/', mark: 'r/' },
  { key: 'bluesky', label: 'Bluesky', color: '#3b82f6', url: 'https://bsky.app/', mark: '⧗' },
  { key: 'instagram', label: 'Instagram', color: '#ec4899', url: 'https://www.instagram.com/', mark: 'ig' },
  { key: 'facebook', label: 'Facebook', color: '#2563eb', url: 'https://www.facebook.com/', mark: 'f' },
  { key: 'threads', label: 'Threads', color: '#a3a3a3', url: 'https://www.threads.com/', mark: '@' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0a66c2', url: 'https://www.linkedin.com/feed/', mark: 'in' },
  { key: 'youtube', label: 'YouTube', color: '#ef4444', url: 'https://www.youtube.com/', mark: '▶' },
  { key: 'tiktok', label: 'TikTok', color: '#22d3ee', url: 'https://www.tiktok.com/', mark: '♪' },
  { key: 'twitch', label: 'Twitch', color: '#a855f7', url: 'https://www.twitch.tv/', mark: '⧉' },
  { key: 'mastodon', label: 'Mastodon', color: '#8b5cf6', url: 'https://fosstodon.org/home', mark: 'm' },
  { key: 'discord', label: 'Discord', color: '#5865f2', url: 'https://discord.com/channels/@me', mark: '◈' },
  { key: 'whatsapp', label: 'WhatsApp', color: '#25d366', url: 'https://web.whatsapp.com/', mark: '✆' },
  { key: 'telegram', label: 'Telegram', color: '#29a9eb', url: 'https://web.telegram.org/a/', mark: '✈' },
  { key: 'slack', label: 'Slack', color: '#e01e5a', url: 'https://app.slack.com/client', mark: '#' },
  { key: 'github', label: 'GitHub', color: '#a3a3a3', url: 'https://github.com/', mark: '⌥' },
  { key: 'hn', label: 'Hacker News', color: '#fb923c', url: 'https://news.ycombinator.com/', mark: 'Y' },
  { key: 'producthunt', label: 'Product Hunt', color: '#da552f', url: 'https://www.producthunt.com/', mark: 'P' },
]
const SITE_BY_KEY = SITES.reduce((m, s) => { m[s.key] = s; return m }, {})
// Prefilled compose URLs — one click from the Compose tab to a real post box.
const SITE_INTENT = {
  x: (t) => 'https://x.com/intent/tweet?text=' + encodeURIComponent(t || ''),
  bluesky: (t) => 'https://bsky.app/intent/compose?text=' + encodeURIComponent(t || ''),
  reddit: (t) => 'https://www.reddit.com/submit?title=' + encodeURIComponent((t || '').slice(0, 280)),
  linkedin: () => 'https://www.linkedin.com/feed/?shareActive=true',
  threads: (t) => 'https://www.threads.com/intent/post?text=' + encodeURIComponent(t || ''),
  mastodon: (t) => 'https://fosstodon.org/share?text=' + encodeURIComponent(t || ''),
  telegram: () => 'https://web.telegram.org/a/',
  discord: () => 'https://discord.com/channels/@me',
  facebook: () => 'https://www.facebook.com/',
  instagram: () => 'https://www.instagram.com/',
  tiktok: () => 'https://www.tiktok.com/upload',
  twitch: () => 'https://www.twitch.tv/',
  youtube: () => 'https://studio.youtube.com/',
  hn: () => 'https://news.ycombinator.com/submit',
}
// ── Radar: one keyword, every platform, sorted newest-first ───────────────────
// Each entry is the site's REAL search URL. No API keys, no rate limits, no
// tier gates — it's the same page you'd get typing into their search box, so it
// works on platforms whose APIs are paywalled (X) or dead to anon reads (Reddit).
// Where the platform supports it we force recency sort; algorithmic "top"
// results are worthless for monitoring.
const SITE_SEARCH = {
  x: (q) => 'https://x.com/search?f=live&q=' + encodeURIComponent(q),
  reddit: (q) => 'https://www.reddit.com/search/?sort=new&q=' + encodeURIComponent(q),
  bluesky: (q) => 'https://bsky.app/search?q=' + encodeURIComponent(q),
  youtube: (q) => 'https://www.youtube.com/results?sp=CAI%253D&search_query=' + encodeURIComponent(q),
  linkedin: (q) => 'https://www.linkedin.com/search/results/content/?sortBy=%22date_posted%22&keywords=' + encodeURIComponent(q),
  facebook: (q) => 'https://www.facebook.com/search/posts?q=' + encodeURIComponent(q),
  instagram: (q) => 'https://www.instagram.com/explore/tags/' + encodeURIComponent(q.replace(/[^a-z0-9]/gi, '').toLowerCase()) + '/',
  tiktok: (q) => 'https://www.tiktok.com/search?q=' + encodeURIComponent(q),
  threads: (q) => 'https://www.threads.com/search?q=' + encodeURIComponent(q),
  mastodon: (q) => 'https://fosstodon.org/search?q=' + encodeURIComponent(q),
  twitch: (q) => 'https://www.twitch.tv/search?term=' + encodeURIComponent(q),
  github: (q) => 'https://github.com/search?s=updated&type=repositories&q=' + encodeURIComponent(q),
  hn: (q) => 'https://hn.algolia.com/?sortBy=byDate&query=' + encodeURIComponent(q),
  producthunt: (q) => 'https://www.producthunt.com/search?q=' + encodeURIComponent(q),
  discord: null, whatsapp: null, telegram: null, slack: null,
}

// ── Cleaner: strip the engagement machine out of every feed ───────────────────
// Injected with webview.insertCSS() after dom-ready. This is display-only — we
// hide their slop, we don't touch their network or their code. Selectors are
// kept broad-but-anchored (aria-label / data-testid, the attributes these sites
// need for their own accessibility and tests) so they survive class-name churn.
const CLEAN_CSS = {
  facebook: `
    /* Sponsored posts: FB labels them for a11y — that label is the tell. */
    div[role="feed"] > div:has(a[aria-label="Sponsored"]),
    div[role="feed"] > div:has(span[aria-label="Sponsored"]),
    div[role="article"]:has(a[href*="/ads/about"]),
    /* Reels + Shorts rails, Stories tray, "Suggested for you", People You May Know */
    div[role="feed"] > div:has(h2 a[href*="/reel"]),
    div[role="feed"] > div:has(span:is([aria-label*="Suggested"])),
    div[aria-label="Stories"], div[data-pagelet="Stories"],
    div[data-pagelet^="RightRail"], div[data-pagelet="VideoChaining"],
    /* Right-hand ad rail and the "Complete your profile" nags */
    div[data-pagelet="LeftRail"] a[href*="/games/"],
    div[role="complementary"] { display: none !important; }`,
  x: `
    /* Promoted tweets carry placementTracking; nothing organic does. */
    div[data-testid="placementTracking"],
    article:has(div[data-testid="placementTracking"]),
    /* Sidebar: trends, who-to-follow, premium upsell, Grok pitch */
    div[data-testid="sidebarColumn"] aside,
    div[data-testid="sidebarColumn"] div[aria-label*="Trending"],
    div[data-testid="sidebarColumn"] div[aria-label*="Who to follow"],
    div[data-testid="super-upsell-UpsellCardRenderProperties"],
    a[href="/i/premium_sign_up"], a[href*="/i/grok"] { display: none !important; }`,
  youtube: `
    /* Ad slots, masthead ads, the Shorts shelf, and "People also watched". */
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,
    ytd-promoted-video-renderer, ytd-display-ad-renderer,
    #masthead-ad, ytd-statement-banner-renderer,
    ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer,
    ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    ytd-merch-shelf-renderer { display: none !important; }`,
  reddit: `
    shreddit-ad-post, shreddit-comments-page-ad,
    [data-testid="post-container"]:has([data-testid="promotedlink"]),
    shreddit-dynamic-ad-link, shreddit-sidebar-ad,
    faceplate-tracker[source="nsfw_blocking_modal"],
    /* "Popular communities" / app-download interstitials */
    xpromo-app-selector, shreddit-app-selector { display: none !important; }`,
  instagram: `
    /* Sponsored posts and the Reels/Suggested rails. */
    article:has(span:is([aria-label="Sponsored"])),
    div:has(> span:is([aria-label="Sponsored"])),
    div[role="menuitem"]:has(svg[aria-label="Reels"]),
    section:has(> div > div > span:is([aria-label*="Suggested"])) { display: none !important; }`,
  linkedin: `
    /* "Promoted" is LinkedIn's own label on every sponsored update. */
    .feed-shared-update-v2:has(span:is(.update-components-actor__description)):has(span:is([aria-hidden="true"])),
    div[data-id^="urn:li:activity"]:has(.update-components-header--sponsored),
    .ad-banner-container, .scaffold-layout__aside .news-module,
    .premium-upsell-link, .feed-follows-module { display: none !important; }`,
  tiktok: `
    div[data-e2e="ad-card"], div:has(> div > div[data-e2e="ad-tag"]),
    div[class*="DivAdCard"], div[class*="DivDownloadAppCard"] { display: none !important; }`,
  threads: `
    div[data-pressable-container]:has(span:is([aria-label="Sponsored"])) { display: none !important; }`,
  twitch: `
    div[data-a-target="video-ad-countdown"], div[data-test-selector="sad-overlay"],
    div[data-a-target="prime-offers-button"] { display: none !important; }`,
}
// Every site also gets these: kill cookie-consent walls and "open in app" nags,
// the two things that waste a click on literally every platform.
const CLEAN_UNIVERSAL = `
  div[aria-label*="cookie" i], div[class*="cookie-banner" i],
  div[id*="cookie-consent" i], div[class*="CookieBanner" i],
  div[class*="open-in-app" i], div[class*="AppInstall" i],
  div[class*="smart-banner" i] { display: none !important; }`
const cleanCssFor = (key) => (CLEAN_CSS[key] || '') + CLEAN_UNIVERSAL

const partitionFor = (key) => 'persist:hermes-social-' + key
const XSITE_PARTITION = partitionFor('x')
const XSITE_START = 'https://x.com/home'
// OAuth providers (Apple/Google/Facebook) open their auth page in a popup.
// The webview's allowpopups is off, so that popup is silently dropped and the
// login can never finish. We detect those URLs and run the flow in the SAME
// guest so the session cookie lands in our persistent partition.
const isAuthPopup = (u) => /accounts\.google\.com|appleid\.apple\.com|facebook\.com|\/oauth\/|authorize|sign[_-]?in|auth\./i.test(u)

// Compose → live site. Takes the draft text and opens the real composer of any
// site that supports a prefill intent, inside the Browse hub (already logged in).
function ComposeOnSite({ text, openInBrowse }) {
  const keys = SITES.filter((s) => SITE_INTENT[s.key]).map((s) => s.key)
  if (!openInBrowse) return null
  return h('div', { style: { ...cardShell, display: 'flex', flexDirection: 'column', gap: 8 } },
    h('div', { style: secTitleStyle }, 'Post on the live site'),
    h('div', { style: secBodyStyle },
      'Opens the real composer in Browse with this text prefilled — no API keys, no rate limits.'),
    h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
      keys.map((k) => {
        const s = SITE_BY_KEY[k]
        return h('button', {
          key: k,
          onClick: () => openInBrowse(k, SITE_INTENT[k](text)),
          title: 'Open ' + s.label + ' composer',
          style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
            color: 'var(--ui-text-secondary, #b6bccb)',
            fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.6,
          },
        }, h('span', { style: { color: s.color, fontSize: '0.72rem', lineHeight: 1 } }, s.mark), s.label)
      })
    )
  )
}

// The hub. Sites stay MOUNTED once visited (hidden, not unmounted) so switching
// between X and Reddit keeps both logged in, scrolled and instant.
// Each mounted webview is its own Chromium renderer process — measured at
// 100–360MB apiece on this machine. Mounting all 18 would cost multiple GB, so
// we keep the N most-recently-used guests alive and evict the rest. Evicted
// sites lose scroll position but NOT their login: the session cookie lives in
// the persistent partition, not the guest.
// Unread badges. A live webview is opaque to React, so we approximate "new
// activity" the way a real feed does: while a site's guest is hidden, its
// page emits favicon/title changes (new DMs, notifications, "X new posts").
// We subscribe via the app's webview 'page-title-updated' signal and increment
// a counter when the title changes while the site isn't the active view.
// Clicking the site clears its badge. This is heuristic — it counts title
// mutations, not message contents — but it's a genuine "something changed"
// signal across all 18 sites with zero per-platform API work.
function useUnread(active, split) {
  const [counts, setCounts] = React.useState(() => loadPref('browse.unread', {}))
  const seen = React.useRef({})
  // Reset the visible site's count the moment it becomes active.
  React.useEffect(() => {
    setCounts((c) => {
      if (counts[active] == null && counts[split] == null) return c
      const next = { ...c }
      delete next[active]
      if (split) delete next[split]
      return next
    })
  }, [active, split])
  const bump = React.useCallback((key, title) => {
    if (key === active || key === split) return
    // Many sites append a bracketed count to the title ("(3) New message").
    // Prefer that exact number when present; otherwise just +1 per change.
    let n = null
    if (title) {
      const m = title.match(/\((\d+)\)/) || title.match(/\[(\d+)\]/)
      if (m) n = Math.max(1, parseInt(m[1], 10))
    }
    setCounts((c) => ({ ...c, [key]: n != null ? n : (c[key] || 0) + 1 }))
  }, [active, split])
  React.useEffect(() => { savePref('browse.unread', counts) }, [counts])
  return { counts, bump }
}

const MAX_LIVE = 4

function BrowseHub({ zen, setZen, jump }) {
  const light = useIsLight()
  const [active, setActive] = usePref('browse.active', 'x')
  // MRU order: [0] is the most recently used. Mounted set = first MAX_LIVE.
  const [mru, setMru] = React.useState(() => {
    const prev = loadPref('browse.opened', ['x'])
    const list = (Array.isArray(prev) ? prev : ['x']).filter((k) => SITE_BY_KEY[k])
    return list.length ? list.slice(0, MAX_LIVE) : ['x']
  })
  const [overrides, setOverrides] = React.useState({})
  // Split view: a second live site pinned beside the first.
  const [split, setSplit] = usePref('browse.split', null)
  const { counts, bump } = useUnread(active, split)

  // Promote a site to the front of the MRU list, mounting it if needed.
  const touch = React.useCallback((key) => {
    setMru((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)]
      // Never evict the split partner — it's visible.
      const keep = next.slice(0, MAX_LIVE)
      const sp = loadPref('browse.split', null)
      if (sp && !keep.includes(sp) && next.includes(sp)) keep[keep.length - 1] = sp
      return keep
    })
  }, [])

  // Compose/Radar can hand us a prefilled intent URL to open on a given site.
  // `jump` is shared with Radar, which uses key:'radar' — ignore those here so
  // a palette Radar-scan never corrupts the Browse rail (active/touch expect a
  // real site key; 'radar' would poison the MRU list and ⌘1-9 slots).
  React.useEffect(() => {
    if (!jump || !jump.key || !SITE_BY_KEY[jump.key]) return
    setActive(jump.key)
    touch(jump.key)
    if (jump.url) setOverrides((o) => ({ ...o, [jump.key]: jump.url }))
  }, [jump && jump.nonce])

  React.useEffect(() => { savePref('browse.opened', mru) }, [mru])

  const pick = (key) => { setActive(key); touch(key) }
  // Right-click / ⌥-click a site to pin it as the split partner.
  const pinSplit = (key) => {
    if (split === key) { setSplit(null); return }
    setSplit(key)
    touch(key)
  }
  const close = (key) => {
    setMru((prev) => {
      const next = prev.filter((k) => k !== key)
      return next.length ? next : ['x']
    })
    if (split === key) setSplit(null)
    if (active === key) {
      const rest = mru.filter((k) => k !== key)
      setActive(rest[0] || 'x')
    }
  }

  // ⌘1–⌘9 jump to the Nth site; ⌘\ toggles split on the last-used partner.
  React.useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      if (e.key >= '1' && e.key <= '9') {
        const s = SITES[Number(e.key) - 1]
        if (s) { e.preventDefault(); pick(s.key) }
      } else if (e.key === '\\') {
        e.preventDefault()
        const partner = mru.find((k) => k !== active)
        if (split) setSplit(null)
        else if (partner) setSplit(partner)
      }
    }
    if (typeof window === 'undefined' || !window.addEventListener) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mru, active, split])

  const railBtn = (s, i) => {
    const live = mru.includes(s.key)
    const ink = inkFor(s, light)
    const n = counts[s.key]
    return h('button', {
      key: s.key,
      onClick: (e) => { if (e.altKey || e.metaKey) pinSplit(s.key); else pick(s.key) },
      onContextMenu: (e) => { e.preventDefault(); pinSplit(s.key) },
      title: s.label + (i < 9 ? '  (⌘' + (i + 1) + ')' : '') +
        ' — ⌥click or right-click to pin side-by-side' + (live ? '' : '  · not loaded yet'),
      style: {
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
        background: active === s.key ? tint(light, 0.16) : 'transparent',
        border: '1px solid ' + (active === s.key || split === s.key ? ink : 'var(--ui-stroke-secondary, #2a2f3a)'),
        color: active === s.key ? 'var(--ui-text-primary, #e7e9ee)' : 'var(--ui-text-tertiary, #8b93a7)',
        fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.6,
        opacity: live || active === s.key ? 1 : 0.62,
      },
    },
      h('span', { style: { color: ink, fontSize: '0.72rem', lineHeight: 1 } }, s.mark),
      s.label,
      split === s.key && h('span', { style: { color: ink, fontSize: '0.6rem' } }, '◧'),
      n ? h('span', {
        title: n + ' new on ' + s.label,
        style: {
          minWidth: 15, height: 15, padding: '0 4px', borderRadius: 999,
          background: 'var(--ui-blue, #3b82f6)', color: '#fff',
          fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.04em',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          flexShrink: 0, boxSizing: 'border-box',
        },
      }, n > 99 ? '99+' : String(n)) : null,
    )
  }

  const pill = (label, on, onClick, title) => h('button', {
    onClick, title,
    style: {
      flexShrink: 0, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
      background: on ? 'var(--ui-blue, #3b82f6)' : 'transparent',
      color: on ? '#fff' : 'var(--ui-text-tertiary, #8b93a7)',
      border: '1px solid ' + (on ? 'transparent' : 'var(--ui-stroke-secondary, #2a2f3a)'),
      fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.6,
    },
  }, label)

  // Only MRU-resident sites render a guest; the rest are genuinely unmounted.
  const panes = mru.map((key) => {
    const shown = key === active || key === split
    const isSplit = !!split && key === split && active !== split
    return h('div', {
      key,
      style: {
        minHeight: 0, minWidth: 0,
        display: shown ? 'flex' : 'none', flexDirection: 'column',
        flex: shown ? 1 : 0,
        borderLeft: isSplit ? '1px solid var(--ui-stroke-secondary, #2a2f3a)' : 'none',
      },
    }, h(SiteFrame, { site: SITE_BY_KEY[key] || SITE_BY_KEY.x, override: overrides[key], onClose: () => close(key), onTitle: (t) => bump(key, t) }))
  })

  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    h('div', { style: {
      display: 'flex', gap: 5, padding: '7px 10px', alignItems: 'center', flexShrink: 0,
      overflowX: 'auto', scrollbarWidth: 'none',
      borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
    } },
      SITES.map(railBtn),
      h('span', { style: { flex: 1, minWidth: 8 } }),
      h('span', { title: mru.length + ' of ' + SITES.length + ' sites loaded — Hermes keeps the ' + MAX_LIVE + ' most recent alive and unloads the rest to save memory. Logins are never lost.',
        style: { flexShrink: 0, fontFamily: MONO, fontSize: '0.5rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ui-text-quaternary, #6b7280)', padding: '0 4px' } },
        mru.length + '/' + MAX_LIVE + ' live'),
      split && pill('◧ unsplit', true, () => setSplit(null), 'Close the side-by-side pane (⌘\\)'),
      pill(zen ? '⤢ zen on' : '⤢ zen', zen, () => setZen(!zen),
        zen ? 'Show tabs' : 'Full-pane mode — hide the Hermes Social chrome'),
    ),
    h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' } }, panes)
  )
}

// ── Radar ─────────────────────────────────────────────────────────────────────
// One keyword, fired at every platform's own search page at once, in a live
// grid. This is the thing no social API can do: X's search API is paywalled,
// Reddit killed anon JSON, Instagram/TikTok have no public search API at all —
// but every one of them will render their search page to a logged-in browser.
// Because these are real logged-in sessions, you see what YOU would see.
const RADAR_DEFAULT = ['x', 'reddit', 'bluesky', 'linkedin', 'youtube', 'hn']

// ── Watch ─────────────────────────────────────────────────────────────────────
// Saved keyword monitors over the unified, credential-free timeline. The
// backend already merges RSS + Reddit + HN + Mastodon + YouTube and supports a
// server-side `q` filter, so Watch is pure listening: each query polls the
// filtered stream and watches for items that weren't there on the previous
// poll. Genuinely-new matches surface as a badge on the tab and on the query —
// a "new since you looked" counter, not a firehose. Stored locally, no API keys.
const WATCH_DEFAULT = ['robotics', 'AI']

// One monitor row: polls its query, diffs against the last seen set, shows new.
function WatchQuery({ term, onRemove, onActivate, onNew }) {
  const light = useIsLight()
  const [items, setItems] = React.useState([])
  const [newIds, setNewIds] = React.useState([]) // ids seen since last "view"
  const [seen, setSeen] = React.useState(() => new Set())
  const [err, setErr] = React.useState(null)
  const lastView = React.useRef(term)
  const qs = () => 'per=8&limit=40&q=' + encodeURIComponent(term)

  const poll = React.useCallback(() => {
    fetch(API + '/timeline?' + qs()).then((r) => r.json()).then((d) => {
      const list = (d.items || []).slice(0, 12)
      setItems(list)
      setErr(d.errors && Object.keys(d.errors).length ? 'some sources unavailable' : null)
      const ids = new Set(list.map((i) => i.source + i.id))
      // Anything in this poll but not in our seen set is new — but only count
      // it if we'd already established a baseline (don't badge the first load).
      if (seen.size) {
        const fresh = list.filter((i) => !seen.has(i.source + i.id)).map((i) => i.source + i.id)
        if (fresh.length) setNewIds((prev) => Array.from(new Set([...prev, ...fresh])))
      }
      setSeen(ids)
      if (onNew) onNew(term, newIds.length)
    }).catch(() => setErr('timeline unreachable'))
  }, [term])

  React.useEffect(() => { poll() }, [poll])
  // Poll every 90s. Light enough — 8 sources, cached by the backend.
  React.useEffect(() => {
    const t = setInterval(poll, 90000)
    return () => clearInterval(t)
  }, [poll])

  const view = () => { setNewIds([]); lastView.current = term; onActivate && onActivate(term) }

  return h('div', { style: { ...cardStyle, display: 'flex', flexDirection: 'column', gap: 8 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      h('div', { style: { fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ui-text-primary, #e7e9ee)', flex: 1, cursor: 'pointer' }, onClick: view },
        '◎ ' + term,
        newIds.length > 0 && h('span', { title: newIds.length + ' new since you looked', style: { marginLeft: 8, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 999, background: 'var(--ui-blue, #3b82f6)', color: '#fff', fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } }, newIds.length > 99 ? '99+' : String(newIds.length))),
      h('button', { onClick: () => onRemove(term), title: 'Remove monitor', style: { background: 'transparent', border: 'none', color: 'var(--ui-text-tertiary, #8b93a7)', cursor: 'pointer', fontSize: 13 } }, '✕'),
    ),
    h('div', { style: { fontSize: 11.5, color: 'var(--ui-text-tertiary, #8b93a7)' } },
      items.length + ' recent matches' + (err ? ' · ' + err : '')),
    items.slice(0, 4).map((it) => {
      const s = SRC_BY_KEY[it.source]
      return h('a', {
        key: it.source + it.id, href: it.url || '#', target: '_blank', rel: 'noreferrer',
        onClick: view,
        style: { display: 'flex', gap: 8, alignItems: 'baseline', textDecoration: 'none', color: 'var(--ui-text-secondary, #b6bccb)', fontSize: 12 },
      },
        h('span', { style: { color: s ? inkFor(s, light) : 'var(--ui-text-tertiary, #8b93a7)', fontFamily: MONO, fontSize: '0.58rem', flexShrink: 0 } }, (s && s.mark) || it.source),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          (it.text || it.title || '').slice(0, 90)),
        h('span', { style: { color: 'var(--ui-text-quaternary, #6b7280)', fontSize: '0.55rem', flexShrink: 0 } }, ago(it.date)),
      )
    }),
  )
}

function Watch({ onNewTotal }) {
  const light = useIsLight()
  const [terms, setTerms] = usePref('watch.terms', WATCH_DEFAULT)
  const [draft, setDraft] = React.useState('')
  const [pulse, setPulse] = React.useState(0)

  // Lift per-query new-counts to the parent so the tab badge reflects the total.
  const [totalNew, setTotalNew] = React.useState(0)
  const countsRef = React.useRef({})

  const addTerm = () => {
    const t = draft.trim()
    if (!t || terms.includes(t)) return
    setTerms([...terms, t])
    setDraft('')
  }
  const removeTerm = (t) => {
    delete countsRef.current[t]
    setTerms(terms.filter((x) => x !== t))
    const next = Object.values(countsRef.current).reduce((a, b) => a + b, 0)
    setTotalNew(next)
    if (onNewTotal) onNewTotal(next)
  }
  const onNew = (term, n) => {
    countsRef.current[term] = n
    const next = Object.values(countsRef.current).reduce((a, b) => a + b, 0)
    setTotalNew(next)
    if (onNewTotal) onNewTotal(next)
    setPulse((p) => p + 1)
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      h('input', {
        value: draft, onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') addTerm() },
        placeholder: 'Watch a keyword across the web…',
        style: { ...fieldStyle, flex: 1 },
      }),
      h('button', { onClick: addTerm, disabled: !draft.trim(), style: { ...btnStyle(true, !draft.trim()), padding: '7px 14px' } }, 'Watch'),
    ),
    h('div', { style: { padding: 10, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 } },
      terms.length === 0
        ? h('div', { style: { ...secBodyStyle } }, 'Add a keyword to start monitoring the open web — RSS, Reddit, HN, Mastodon and YouTube — for it.')
        : terms.map((t) => h(WatchQuery, { key: t, term: t, onRemove: removeTerm, onNew })),
      pulse, // force re-render so the tab badge stays in sync
    ),
  )
}

function Radar({ jump }) {
  const light = useIsLight()
  const [q, setQ] = usePref('radar.q', '')
  const [draft, setDraft] = React.useState(() => loadPref('radar.q', ''))
  const [picked, setPicked] = usePref('radar.sites', RADAR_DEFAULT)
  const [cols, setCols] = usePref('radar.cols', 2)
  const [sortMode, setSortMode] = usePref('radar.sort', 'new') // 'new' | 'az' | 'recent'
  const [nonce, setNonce] = React.useState(0)
  const searchable = SITES.filter((s) => SITE_SEARCH[s.key])
  const active = searchable.filter((s) => picked.includes(s.key))
  const ordered = sortMode === 'az'
    ? [...active].sort((a, b) => a.label.localeCompare(b.label))
    : sortMode === 'recent'
      ? [...active].sort((a, b) => (loadPref('browse.opened', ['x']).indexOf(b.key) - loadPref('browse.opened', ['x']).indexOf(a.key)))
      : active

  // A Radar scan handed in via the command palette (jump.url is a prefilled
  // search intent). Run it the moment we mount/receive it. Without this, the
  // palette's "Radar-scan on X" command set BrowseHub's jump and did nothing
  // here — the grid only reads our own q/draft/nonce, which were untouched.
  React.useEffect(() => {
    if (jump && jump.url && (jump.key === 'radar' || !jump.key)) {
      const term = decodeURIComponent((jump.url.split('q=')[1] || '').split('&')[0] || '')
      if (term) { setDraft(term); setQ(term); setNonce((n) => n + 1) }
    }
  }, [jump && jump.nonce])

  const run = () => {
    const t = draft.trim()
    if (!t) return
    setQ(t)
    setNonce((n) => n + 1)
  }
  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))

  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      h('input', {
        value: draft, onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') run() },
        placeholder: 'One keyword — searched on every platform at once…',
        style: { ...fieldStyle, flex: 1 },
      }),
      h('button', { onClick: run, disabled: !draft.trim(), style: { ...btnStyle(true, !draft.trim()), padding: '7px 16px' } }, 'Scan'),
      h('button', {
        onClick: () => setCols((c) => (c >= 3 ? 1 : c + 1)),
        title: 'Grid columns',
        style: { ...platBtn(false), padding: '6px 11px', fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '0.12em', textTransform: 'uppercase' },
      }, cols + '-up'),
      h('select', {
        value: sortMode, onChange: (e) => setSortMode(e.target.value),
        title: 'Tile order',
        style: { ...fieldStyle, width: 'auto', padding: '6px 8px', fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase' },
      },
        h('option', { value: 'new' }, 'Newest'),
        h('option', { value: 'az' }, 'A–Z'),
        h('option', { value: 'recent' }, 'Most used'),
      ),
    ),
    h('div', { style: { display: 'flex', gap: 5, padding: '0 10px 8px', flexWrap: 'wrap', flexShrink: 0, borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      searchable.map((s) => h('button', {
        key: s.key, onClick: () => toggle(s.key), title: s.label,
        style: {
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
          background: picked.includes(s.key) ? tint(light, 0.16) : 'transparent',
          border: '1px solid ' + (picked.includes(s.key) ? inkFor(s, light) : 'var(--ui-stroke-secondary, #2a2f3a)'),
          color: picked.includes(s.key) ? 'var(--ui-text-primary, #e7e9ee)' : 'var(--ui-text-tertiary, #8b93a7)',
          fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.6,
        },
      }, h('span', { style: { color: inkFor(s, light), fontSize: '0.7rem', lineHeight: 1 } }, s.mark), s.label)),
 ),
 // One-tap trending probes — the questions you'll actually ask.
 h('div', { style: { display: 'flex', gap: 5, padding: '0 10px 8px', flexWrap: 'wrap', flexShrink: 0, borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
 h('span', { style: { fontFamily: MONO, fontSize: '0.5rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ui-text-quaternary, #6b7280)', alignSelf: 'center', marginRight: 2 } }, 'Trending:'),
 ['BlackCat Robotics', 'AI agents', 'robotics funding', 'Y Combinator'].map((t) =>
   h('button', {
     key: t, onClick: () => { setDraft(t); setQ(t); setNonce((n) => n + 1) },
     title: 'Radar-scan "' + t + '"',
     style: { padding: '3px 9px', borderRadius: 999, cursor: 'pointer', background: F_SOFT, border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', color: 'var(--ui-text-secondary, #b6bccb)', fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' },
   }, t)),
 ),
    !q
      ? h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 } },
          h('div', { style: { maxWidth: 460, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 } },
            h('div', { style: { fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ui-text-secondary, #b6bccb)' } }, 'Radar'),
            h('div', { style: { fontSize: 13, lineHeight: 1.6, color: 'var(--ui-text-tertiary, #8b93a7)' } },
              'Type a brand, a competitor, or a topic. Hermes opens every platform\u2019s own search — sorted newest-first where they allow it — side by side, in your logged-in sessions.'),
            h('div', { style: { fontSize: 11.5, lineHeight: 1.6, color: 'var(--ui-text-quaternary, #6b7280)' } },
              'No API keys. No rate limits. Reaches what the APIs charge for or block outright.'),
          ))
      : h('div', {
          style: {
            flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gap: 8, padding: 8,
            gridTemplateColumns: 'repeat(' + cols + ', minmax(0, 1fr))',
            gridAutoRows: cols === 1 ? 'minmax(520px, 1fr)' : 'minmax(460px, 1fr)',
          },
        },
          active.length === 0
            ? h('div', { style: secBodyStyle }, 'Pick at least one platform above.')
            : ordered.map((s) => h('div', {
                key: s.key + ':' + nonce,
                style: { minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 10, overflow: 'hidden' },
              }, h(SiteFrame, { site: s, override: SITE_SEARCH[s.key](q), compact: true })))
        )
  )
}


// One live site. `override` (an intent URL from Compose/Radar) wins over the
// default. `compact` trims the chrome for Radar's grid tiles.
function SiteFrame({ site, override, onClose, compact, onTitle }) {
  const start = override || site.url
  const wv = React.useRef(null)
  const light = useIsLight()
  const ink = inkFor(site, light)
  const [url, setUrl] = React.useState(start)
  const [nav, setNav] = React.useState({ canGoBack: false, canGoForward: false })
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState(null)
  // Zoom is per-site and persisted: X at 90% fits far more timeline on screen.
  const [zoom, setZoom] = usePref('zoom.' + site.key, 1)
  // Cleaner is per-site and persisted, default ON.
  const [clean, setClean] = usePref('clean.' + site.key, true)
  const cleanKey = React.useRef(null)

  // webviews are created by the Electron webview-tag machinery, not React's
  // reconciler, so we wire their events imperatively once the node exists.
  React.useEffect(() => {
    const el = wv.current
    if (!el) return
    const onDom = () => { setLoading(true) }
    const onLoad = () => { setLoading(false) }
    const onFail = (e) => {
      setLoading(false)
      const code = e && (e.errorCode || (e.details && e.details.errorCode))
      const desc = e && (e.errorDescription || (e.details && e.details.errorDescription) || '')
      // ERR_ABORTED (-3) fires on normal in-page navigation; ignore it.
      if (code === -3) return
      setErr(site.label + ' failed to load: ' + (desc || ('code ' + code)) +
        '. If you are offline or behind a proxy, the webview cannot reach it.')
    }
    const onNav = (e) => { if (e && e.url) setUrl(e.url) }
    const onTitle = (e) => { if (e && e.title && typeof onTitle === 'function') onTitle(e.title) }
    const onCanGo = (e) => { setNav({ canGoBack: !!(e && e.canGoBack), canGoForward: !!(e && e.canGoForward) }) }
    // Popups (OAuth). Without this, "Continue with Apple/Google" opens a popup
    // that is dropped, so login silently fails. Auth URLs run in this guest;
    // other links open in the OS browser.
    const onNewWindow = (e) => {
      e.preventDefault()
      const u = e && e.url
      if (!u) return
      if (isAuthPopup(u)) {
        setLoading(true); setErr(null)
        if (el && typeof el.loadURL === 'function') el.loadURL(u)
      } else if (typeof window !== 'undefined' && window.open) {
        window.open(u, '_blank')
      }
    }
    el.addEventListener('did-attach', onDom)
    el.addEventListener('did-finish-load', onLoad)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('did-change-can-go-back-forward', onCanGo)
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('new-window', onNewWindow)
    // Restore the saved scroll position once the guest has painted. The route
    // page unmounts the webview on leave, so without this the page jumps to top
    // every time you reopen Social — the one rough edge of the sidebar move.
    const onRestoreScroll = () => {
      try {
        const key = 'hermes-social:scroll:' + site.key
        const y = Number(localStorage.getItem(key) || '0')
        if (y > 0) el.executeJavaScript('try{window.scrollTo(0,' + y + ')}catch(e){}').catch(() => {})
      } catch { /* localStorage unavailable */ }
    }
    el.addEventListener('did-finish-load', onRestoreScroll)
    return () => {
      // Persist scroll on unmount so reopening lands where you left off.
      try {
        const key = 'hermes-social:scroll:' + site.key
        el.executeJavaScript('(window.scrollY||document.documentElement.scrollTop||0)')
          .then((y) => { if (y) localStorage.setItem(key, String(y)) }).catch(() => {})
      } catch { /* ignore */ }
      el.removeEventListener('did-attach', onDom)
      el.removeEventListener('did-finish-load', onLoad)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('did-change-can-go-back-forward', onCanGo)
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('new-window', onNewWindow)
      el.removeEventListener('did-finish-load', onRestoreScroll)
    }
  }, [])

  // Persist scroll continuously (throttled) so a crash/unmount mid-scroll keeps
  // the last position rather than the last full load.
  React.useEffect(() => {
    const el = wv.current
    if (!el || typeof el.getWebContentsId !== 'function') return
    let t = null
    const onScroll = () => {
      if (t) return
      t = setTimeout(() => {
        t = null
        try {
          const key = 'hermes-social:scroll:' + site.key
          el.executeJavaScript('(window.scrollY||document.documentElement.scrollTop||0)')
            .then((y) => { if (y) localStorage.setItem(key, String(y)) }).catch(() => {})
        } catch { /* ignore */ }
      }, 800)
    }
    el.addEventListener('did-navigate-in-page', onScroll)
    return () => el.removeEventListener('did-navigate-in-page', onScroll)
  }, [site.key])

  // A later Compose jump to an already-open site navigates the live guest.
  const lastOverride = React.useRef(override)
  React.useEffect(() => {
    if (!override || override === lastOverride.current) return
    lastOverride.current = override
    const el = wv.current
    setUrl(override); setLoading(true); setErr(null)
    if (el && typeof el.loadURL === 'function') el.loadURL(override)
  }, [override])

  const go = (target) => {
    const el = wv.current
    let u = (target || url || '').trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    setUrl(u); setLoading(true); setErr(null)
    if (el && typeof el.loadURL === 'function') el.loadURL(u)
  }
  const reload = () => { const el = wv.current; if (el && typeof el.reload === 'function') { setLoading(true); el.reload() } }
  const home = () => go(site.url)
  const back = () => { const el = wv.current; if (el && nav.canGoBack && typeof el.goBack === 'function') el.goBack() }
  const fwd = () => { const el = wv.current; if (el && nav.canGoForward && typeof el.goForward === 'function') el.goForward() }
  const openOut = () => { if (typeof window !== 'undefined' && window.open) window.open(url, '_blank') }

  // Apply zoom to the guest. setZoomFactor only exists once the guest is
  // attached, so we also re-apply on every finished load.
  const applyZoom = React.useCallback((z) => {
    const el = wv.current
    if (el && typeof el.setZoomFactor === 'function') {
      try { el.setZoomFactor(z) } catch { /* guest not attached yet */ }
    }
  }, [])
  React.useEffect(() => { applyZoom(zoom) }, [zoom, applyZoom, loading])
  const bumpZoom = (d) => setZoom((z) => Math.min(2, Math.max(0.5, Math.round((z + d) * 100) / 100)))

  // Cleaner. insertCSS returns a key we keep so toggling OFF can remove exactly
  // what we added. SPAs re-render constantly but injected CSS is document-level,
  // so one injection per navigation covers every subsequent virtual-DOM update.
  const applyClean = React.useCallback((on) => {
    const el = wv.current
    if (!el || typeof el.insertCSS !== 'function') return
    if (!on) {
      if (cleanKey.current && typeof el.removeInsertedCSS === 'function') {
        el.removeInsertedCSS(cleanKey.current).catch(() => {})
        cleanKey.current = null
      }
      return
    }
    const css = cleanCssFor(site.key)
    if (!css.trim()) return
    Promise.resolve(el.insertCSS(css)).then((k) => { cleanKey.current = k }).catch(() => {})
  }, [site.key])
  // Re-inject on every completed navigation: a full page load drops prior CSS.
  React.useEffect(() => {
    if (loading) { cleanKey.current = null; return }
    applyClean(clean)
  }, [clean, loading, applyClean])

  const btn = (label, onClick, disabled, primary) => h('button', {
    onClick, disabled: !!disabled, title: label,
    style: {
      background: primary ? 'var(--ui-blue, #3b82f6)' : tint(light, 0.10),
      color: primary ? '#fff' : 'var(--ui-text-secondary, #b6bccb)',
      border: '1px solid ' + (primary ? 'transparent' : 'var(--ui-stroke-secondary, #2a2f3a)'),
      borderRadius: 6, padding: '4px 8px', cursor: disabled ? 'default' : 'pointer',
      fontFamily: MONO, fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.12em',
      textTransform: 'uppercase', lineHeight: 1, opacity: disabled ? 0.4 : 1, flexShrink: 0,
    },
  }, label)

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h('div', { style: { display: 'flex', gap: 5, padding: compact ? '4px 7px' : '6px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)', alignItems: 'center', flexShrink: 0 } },
      h('span', { title: site.label, style: { color: ink, fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, flexShrink: 0, lineHeight: 1 } }, site.mark),
      !compact && btn('‹', back, !nav.canGoBack),
      !compact && btn('›', fwd, !nav.canGoForward),
      !compact && btn('⌂', home, false),
      compact
        ? h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ui-text-secondary, #b6bccb)' } }, site.label)
        : h('input', {
            value: url, onChange: (e) => setUrl(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') go() },
            placeholder: site.url,
            style: { ...fieldStyle, flex: 1, minWidth: 80, padding: '5px 9px' },
          }),
      !compact && btn('Go', () => go(), false, true),
      btn('↻', reload, false),
      // Cleaner: the whole point of the plugin. Off = raw, ads and all.
      CLEAN_CSS[site.key] && h('button', {
        onClick: () => setClean((c) => !c),
        title: clean
          ? 'Cleaner ON — ads, Reels, Stories and upsells hidden. Click for the raw feed.'
          : 'Cleaner OFF — showing the raw feed. Click to strip the slop.',
        style: {
          background: clean
            ? (light ? 'rgba(25,146,70,0.12)' : 'rgba(34,197,94,0.16)')
            : tint(light, 0.10),
          color: clean ? okColor(light) : 'var(--ui-text-tertiary, #8b93a7)',
          border: '1px solid ' + (clean
            ? (light ? 'rgba(25,146,70,0.42)' : 'rgba(34,197,94,0.45)')
            : 'var(--ui-stroke-secondary, #2a2f3a)'),
          borderRadius: 6, padding: '4px 8px', cursor: 'pointer', flexShrink: 0,
          fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', lineHeight: 1,
        },
      }, clean ? '✦ clean' : '✦ raw'),
      !compact && btn('−', () => bumpZoom(-0.1), zoom <= 0.5),
      !compact && h('button', {
        onClick: () => setZoom(1), title: 'Reset zoom to 100%',
        style: {
          background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0,
          color: 'var(--ui-text-tertiary, #8b93a7)', fontFamily: MONO,
          fontSize: '0.55rem', letterSpacing: '0.08em', padding: '4px 2px', minWidth: 34,
        },
      }, Math.round(zoom * 100) + '%'),
      !compact && btn('+', () => bumpZoom(0.1), zoom >= 2),
      btn('↗', openOut, false),
      onClose && btn('✕', onClose, false),
      loading && h('span', { style: { fontFamily: MONO, fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)', flexShrink: 0 } }, '…'),
    ),
    err && h('div', { style: { padding: '8px 12px', fontSize: 12, color: C_ERR, borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } }, err),
    h('webview', {
      ref: wv,
      src: start,
      partition: partitionFor(site.key),
      allowpopups: 'true',
      // Placeholder shown for the split-second before the guest paints. Black
      // on a light theme is a jarring flash, so match the surface.
      style: { flex: 1, width: '100%', minHeight: 0, border: 'none', background: light ? '#fff' : '#000', display: 'flex' },
    }),
  )
}

// Kept for the Timeline's X-only view and the test harness.
function XBrowser({ initialUrl }) {
  return h(SiteFrame, { site: SITE_BY_KEY.x, override: initialUrl && initialUrl !== XSITE_START ? initialUrl : null })
}
// ── styles ──────────────────────────────────────────────────────────────────────
// Colours come from the Hermes design tokens (--ui-*). Earlier this file used
// --bg/--text/--border/--accent, which are defined NOWHERE in the app's CSS, so
// every one silently fell back to a hardcoded literal — that was the black
// boxes and the invisible banner.
const paneStyle = { display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--ui-text-primary, #e7e9ee)', fontFamily: 'var(--dt-font-sans, system-ui, sans-serif)' }
const tabBarStyle = { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)', alignItems: 'center', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }
const fieldStyle = { padding: '7px 9px', borderRadius: 7, border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', background: F_MED, color: 'var(--ui-text-primary, #e7e9ee)', fontSize: 12.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
const cardStyle = { border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 10, padding: 12, background: F_SOFT }
const secTitleStyle = { fontFamily: MONO, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--ui-text-tertiary, #8b93a7)', marginBottom: 5 }
const secBodyStyle = { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' }
const feedItemStyle = { display: 'block', padding: 10, borderRadius: 8, border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', textDecoration: 'none', color: 'var(--ui-text-primary, #e7e9ee)', background: F_SOFT }
const cardShell = { padding: '12px 14px', borderRadius: 12, border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', background: F_FAINT }

function dotStyle(on) {
  return {
    width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
    background: on ? C_OK : 'var(--ui-stroke-secondary, #2a2f3a)',
    boxShadow: on ? '0 0 6px var(--hs-ok-glow)' : 'none',
  }
}
function badgeStyle(on, fontSize = 11) {
  return {
    padding: '2px 6px', borderRadius: 6, fontWeight: 600, fontSize,
    background: on ? 'var(--hs-ok-bg)' : F_STRONG,
    color: on ? C_OK : 'var(--ui-text-tertiary, #8b93a7)',
  }
}
function btnStyle(primary, disabled) {
  return {
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'var(--ui-stroke-secondary, #2a2f3a)' : primary ? 'var(--ui-blue, #3b82f6)' : 'var(--hs-fill-btn)', color: '#fff', fontWeight: 600, fontSize: 13,
  }
}
function platBtn(active, configured, dim) {
  return {
    padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: '1px solid var(--ui-stroke-secondary, #2a2f3a)',
    background: active ? 'var(--ui-blue, #3b82f6)' : 'transparent',
    color: active ? '#fff' : (dim ? 'var(--ui-stroke-secondary, #2a2f3a)' : configured ? 'var(--ui-text-primary, #e7e9ee)' : 'var(--ui-text-tertiary, #8b93a7)'),
    opacity: dim ? 0.6 : 1,
  }
}

// Exported for the render/embed test harnesses (scripts/*.mjs). Not used by the app.
export const __test__ = { StreamItem, Avatar, ImageGrid, LinkCard, QuoteCard, VideoEmbed, Timeline, Inbox, Sources, Messages, Bubble, NewConversation, Engagement, AutoReply, FeedList, BrowseHub, SiteFrame, ComposeOnSite, Radar, Watch, WatchQuery, SocialPane, CommandPalette, useUnread, SITES, SITE_BY_KEY, SITE_INTENT, SITE_SEARCH, CLEAN_CSS, CLEAN_UNIVERSAL, cleanCssFor, MAX_LIVE, readMode, useThemeMode, useIsLight, LIGHT_INK, OK_C, ERR_C, WARN_C, inkFor, okColor, errColor, warnColor, tint, THEME_CSS, THEME_STYLE_ID, SRC_COLOR, SRC_COLOR_LIGHT, srcColor, PLATFORMS, PLAT_LIMITS, ComposePreview }

export default {
  id: ID,
  register(ctx) {
    // Capture ctx so loadPref/savePref can use the plugin-scoped storage.
    PCTX = ctx
    // Relocate Social to the sidebar under Kanban (Kanban-consistent): a sidebar
    // nav row + a paired route page. External plugins go through the same
    // registry as built-ins, so 'sidebar.nav' / 'routes' work here exactly as
    // they do for Kanban. We intentionally DROP the old 'panes' main pane so we
    // don't mount two SocialPane instances (the route page is a separate tree).
    // Tradeoff: like Kanban, Social is now a navigable page — its webviews mount
    // on open and unmount on leave (logins persist via partition; scroll state
    // does not). Clicking the sidebar "Social" row navigates to /social.
    //
    // Native command-palette entry + global hotkey: the app reads PALETTE_AREA
    // and KEYBINDS_AREA via useContributions (verified in command-palette/contrib
    // and lib/keybinds/actions + contributed-actions.test.ts), so both are
    // first-class for external plugins — no TS constants needed, just the area
    // string literals and a hash navigation (the app uses a HashRouter).
    const navSocial = () => { try { window.location.hash = '#/social' } catch { /* noop */ } }
    const contribs = [
      { id: 'nav', area: 'sidebar.nav', order: 60, data: { codicon: 'globe', label: 'Social', path: '/social' } },
      { id: 'route', area: 'routes', data: { path: '/social' }, render: () => h(SocialPane, {}) },
      // ⌘K "Open Social" — click-to-run native palette row.
      { id: 'palette.open', area: 'palette', data: { id: 'social.open', label: 'Open Social', keywords: ['social', 'feeds', 'timeline', 'browse'], run: navSocial } },
      // Global hotkey ⌘⇧S — first-class contributed keybind (dispatches + rebindable).
      { id: 'key.open', area: 'keybinds', data: { id: 'social.openHotkey', category: 'view', defaults: ['mod+shift+s'], label: 'Social: Open', run: navSocial } },
    ]
    return ctx.registerMany ? ctx.registerMany(contribs) : contribs.map((c) => ctx.register(c))
  },
}
