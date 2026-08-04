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

// X free-tier workaround: the API can't read timelines or post without a paid
// plan, so we route to the real X site instead. The share intent prefills the
// draft text — one click and the user posts on x.com itself.
function xIntent(text) {
  return 'https://x.com/intent/tweet?text=' + encodeURIComponent(text || '')
}
function xFreeTier(err) {
  if (!err) return false
  return /402|credits depleted|403|not authorized|Forbidden/i.test(err)
}
function XFreeTierFallback({ onCompose }) {
  const link = (label, href) => h('a', { href, target: '_blank', rel: 'noreferrer', style: { ...platBtn(false), textDecoration: 'none', display: 'inline-block' } }, label)
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    h('div', { style: { fontSize: 12, color: '#f59e0b' } }, '⚠ X Free tier blocks timeline reads + posting via API. Open X to view & post:'),
    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      link('Open Home ↗', 'https://x.com/home'),
      link('Notifications ↗', 'https://x.com/notifications'),
      h('a', { href: xIntent(''), target: '_blank', rel: 'noreferrer', style: { ...platBtn(true), textDecoration: 'none', display: 'inline-block' } }, 'Compose ↗'),
    )
  )
}

const PLATFORMS = [
  { key: 'x', label: 'X', fields: [
    { k: 'X_API_KEY', label: 'API Key', secret: true },
    { k: 'X_API_SECRET', label: 'API Secret', secret: true },
    { k: 'X_BEARER_TOKEN', label: 'Bearer Token', secret: true },
    { k: 'X_ACCESS_TOKEN', label: 'Access Token', secret: true },
    { k: 'X_ACCESS_TOKEN_SECRET', label: 'Access Token Secret', secret: true },
    { k: 'X_USERNAME', label: '@username (for embedded timeline)' },
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
]

function ago(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (isNaN(t)) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

function SocialPane() {
  const [tab, setTab] = React.useState('feeds')
  const [status, setStatus] = React.useState(null)
  const [err, setErr] = React.useState(null)

  const loadStatus = React.useCallback(() => {
    fetch(API + '/status').then((r) => r.json()).then((d) => { setStatus(d); setErr(null) })
      .catch(() => setErr('Cannot reach social server — run `social serve` (or it auto-starts via launchd).'))
  }, [])
  React.useEffect(() => { loadStatus() }, [loadStatus])

  const connected = (status && status.configured) || {}
  const nConn = PLATFORMS.filter((p) => connected[p.key]).length

  return h('div', { style: paneStyle },
    h('div', { style: tabBarStyle },
      h(Tab, { active: tab === 'feeds', onClick: () => setTab('feeds'), label: 'Feeds' }),
      h(Tab, { active: tab === 'compose', onClick: () => setTab('compose'), label: 'Compose' }),
      h(Tab, { active: tab === 'mass', onClick: () => setTab('mass'), label: 'Mass Post' }),
      h(Tab, { active: tab === 'settings', onClick: () => setTab('settings'), label: 'Settings' }),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#888' } },
        h('span', { style: { marginRight: 4 } }, nConn + '/' + PLATFORMS.length),
        PLATFORMS.map((p) =>
          h('span', { key: p.key, title: p.label + (connected[p.key] ? ' · connected' : ' · not set'),
            style: dotStyle(connected[p.key]) })
        )
      )
    ),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    tab === 'feeds' ? h(Feeds, { status, refresh: loadStatus })
      : tab === 'compose' ? h(Compose, { status, refresh: loadStatus })
      : tab === 'mass' ? h(MassPost, { status, refresh: loadStatus })
      : h(Settings, { status, refresh: loadStatus })
  )
}

function Tab({ active, onClick, label }) {
  return h('button', { onClick, style: {
    background: active ? 'var(--accent, #3b82f6)' : 'transparent', color: active ? '#fff' : 'var(--text)',
    border: '1px solid var(--border)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  } }, label)
}

// ── Settings ──────────────────────────────────────────────────────────────────
function Settings({ status, refresh }) {
  const configured = (status && status.configured) || {}
  return h('div', { style: { overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 } },
    h('div', { style: { fontSize: 12, color: '#888' } }, 'Log in per platform, then hit “Test” to make a real API call and confirm it works before you post.'),
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
      testRes && h('span', { style: { fontSize: 11, color: testRes.ok ? '#22c55e' : '#f87171', marginLeft: 'auto' } }, testRes.ok ? '✓ verified' : '✗ failed')
    ),
    p.fields.map((f) =>
      h('div', { key: f.k, style: { marginBottom: 8 } },
        h('label', { style: { fontSize: 11, color: '#aaa', display: 'block', marginBottom: 3 } }, f.label),
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
      p.fields.some((f) => f.secret) && h('label', { style: { fontSize: 11, color: '#888', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: show, onChange: (e) => setShow(e.target.checked) }), 'show'),
      saved && h('span', { style: { fontSize: 11, color: '#22c55e' } }, 'saved')
    ),
    testRes && !testRes.ok && h('div', { style: { marginTop: 8, fontSize: 12, color: '#f87171', wordBreak: 'break-word' } }, String(testRes.error || 'failed'))
  )
}

// ── Compose ────────────────────────────────────────────────────────────────────
function Compose({ status, refresh }) {
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
    disabled && h('div', { style: { fontSize: 12, color: '#f59e0b' } }, `⚠ ${platform} not configured — add creds in Settings (and hit Test).`),
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
      text.length > 0 && platform === 'x' && h('span', { style: { fontSize: 11, color: over ? '#f87171' : '#888' } }, `${text.length}/280`),
    ),
    result && h('div', { style: { padding: 10, borderRadius: 8, fontSize: 12, background: result.ok ? 'rgba(34,197,94,0.15)' : 'rgba(248,113,113,0.15)', color: result.ok ? '#22c55e' : '#f87171', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, result.ok ? '✓ ' + (result.url || result.id || 'Posted') : '✗ ' + (result.error || 'failed'))
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
  const over = text.length > 280
  const chosen = allConn.filter((k) => sel[k])

  const toggle = (k) => setSel((o) => ({ ...o, [k]: !o[k] }))

  const blast = () => {
    if (busy || !text.trim() || chosen.length === 0) return
    setBusy(true); setResults(null)
    fetch(API + '/mass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, platforms: chosen }) })
      .then((r) => r.json()).then((d) => { setResults(d.results || {}); refresh && refresh() })
      .catch((e) => setResults({ _err: String(e) })).finally(() => setBusy(false))
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' } },
    h('textarea', { placeholder: 'One draft — posted to every platform you pick below.', value: text, onChange: (e) => setText(e.target.value), rows: 4, style: { ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' } }),
    text.length > 0 && h('div', { style: { fontSize: 11, color: over ? '#f87171' : '#888' } }, `${text.length}/280`),
    h('div', { style: { fontSize: 12, color: '#888' } }, 'Post to:'),
    allConn.length === 0 && h('div', { style: { fontSize: 12, color: '#f59e0b' } }, 'No platforms connected yet — add creds in Settings (and hit Test).'),
    h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      allConn.map((k) => h('button', { key: k, onClick: () => toggle(k), style: platBtn(sel[k], true) }, PLATFORMS.find((p) => p.key === k).label))
    ),
    h('button', { onClick: blast, disabled: busy || !text.trim() || chosen.length === 0, style: btnStyle(false, busy || !text.trim() || chosen.length === 0) }, busy ? 'Posting…' : `Post to ${chosen.length || 0} platform${chosen.length === 1 ? '' : 's'}`),
    results && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
      Object.entries(results).map(([k, v]) =>
        h('div', { key: k, style: { padding: 10, borderRadius: 8, fontSize: 12, background: '#1a1a1a', border: '1px solid var(--border)' } },
          h('div', { style: { fontWeight: 600, marginBottom: 2 } }, PLATFORMS.find((p) => p.key === k) ? PLATFORMS.find((p) => p.key === k).label : k),
          v.ok && h('div', { style: { color: '#22c55e' } }, '✓ ' + (v.url || v.id || 'Posted')),
          v.ok === false && v.link && h('a', { href: v.link, target: '_blank', rel: 'noreferrer', style: { color: '#60a5fa', textDecoration: 'none' } }, '↗ ' + (v.note || 'Open to post on X')),
          v.ok === false && !v.link && h('div', { style: { color: '#f87171', wordBreak: 'break-word' } }, '✗ ' + (v.error || 'failed')),
        )
      )
    )
  )
}

// ── Feeds ──────────────────────────────────────────────────────────────────────
function Feeds({ status, refresh }) {
  const [plat, setPlat] = React.useState('all')
  const [feed, setFeed] = React.useState('home')
  const [items, setItems] = React.useState({})
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState(null)
  const configured = (status && status.configured) || {}
  const xUser = (status && status.meta && status.meta.x_username) || ''
  const load = () => {
    if (plat !== 'x' && plat !== 'all') { // X embed needs no API fetch
      setLoading(true); setErr(null)
      const q = 'platform=' + plat + '&limit=12'
      fetch(API + '/feeds?' + q).then((r) => r.json()).then((d) => setItems(d)).catch((e) => setErr(String(e))).finally(() => setLoading(false))
    } else {
      setItems({})
    }
  }
  React.useEffect(() => { load() }, [plat])
  const pmeta = {
    x: { name: 'X', field: 'text', sub: (i) => '@' + (i.author || '?'), dot: (i) => i.author_name },
    reddit: { name: 'Reddit', field: 'title', sub: (i) => 'r/' + (i.subreddit || '?') + ' · ' + (i.score || 0) + '↑' },
    facebook: { name: 'Facebook', field: 'text', sub: () => '' },
    instagram: { name: 'Instagram', field: 'text', sub: () => '' },
    tiktok: { name: 'TikTok', field: 'text', sub: (i) => i.url ? 'video' : '' },
    twitch: { name: 'Twitch', field: 'text', sub: () => '' },
  }
  const keys = plat === 'all' ? ['x', 'reddit', 'facebook', 'instagram', 'tiktok', 'twitch'] : [plat]
  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' } },
      h('button', { onClick: () => setPlat('all'), style: platBtn(plat === 'all') }, 'All'),
      ...PLATFORMS.map((p) => h('button', { key: p.key, onClick: () => setPlat(p.key), style: platBtn(plat === p.key, configured[p.key]) }, p.label)),
    ),
    (plat === 'all' || plat === 'x') && h('div', { style: { display: 'flex', gap: 6, padding: '0 10px 8px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: 11, color: '#888' } }, 'X feed:'),
      h('button', { onClick: () => setFeed('embed'), style: platBtn(feed === 'embed') }, 'Timeline'),
      h('button', { onClick: () => setFeed('home'), style: platBtn(feed === 'home') }, 'Home*'),
      h('button', { onClick: () => setFeed('foryou'), style: platBtn(feed === 'foryou') }, 'For You*'),
      h('button', { onClick: () => setFeed('mentions'), style: platBtn(feed === 'mentions') }, 'Mentions'),
      h('button', { onClick: load, disabled: loading, style: { ...platBtn(false), marginLeft: 'auto' } }, loading ? '↻…' : '↻ Refresh')
    ),
    (plat === 'all' || plat === 'x') && feed === 'foryou' && h('div', { style: { padding: '6px 10px', fontSize: 11, color: '#a78bfa' } }, '* API reads need a paid X tier — these open the real X site.'),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    h('div', { style: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 12 } },
      keys.map((k) => {
        const meta = pmeta[k]; const sec = items[k]; const list = (sec && sec.items) || []
        // X: real embed timeline (no API cost) when a username is set
        if (k === 'x' && (plat === 'all' || plat === 'x') && feed === 'embed') {
          return h('div', { key: k },
            h('div', { style: secTitleStyle }, 'X — Timeline'),
            xUser ? h(XTimeline, { username: xUser })
              : h(XTimeline, { username: 'blackcatrobotics' })
          )
        }
        // unconfigured, no real error -> compact chip (declutter)
        if (!configured[k] && !(sec && !sec.ok && !xFreeTier(sec.error))) {
          return h(ConfigChip, { key: k, label: meta.name })
        }
        return h('div', { key: k },
          h('div', { style: secTitleStyle }, meta.name),
          !sec && h('div', { style: secBodyStyle }, 'loading…'),
          sec && !sec.ok && (k === 'x' && xFreeTier(sec.error)
            ? h(XFreeTierFallback, { onCompose: () => {} })
            : h('div', { style: { fontSize: 12, color: '#f59e0b' } }, '⚠ ' + (sec.error || 'not available'))),
          sec && sec.ok && list.length === 0 && h('div', { style: secBodyStyle }, 'nothing yet'),
          list.map((it) => h(FeedItem, { key: it.id, it, meta }))
        )
      })
    )
  )
}

function ConfigChip({ label }) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px dashed var(--border)', fontSize: 12, color: '#888' } },
    h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: '#555', display: 'inline-block' } }),
    label + ' — add creds in Settings to activate'
  )
}

// Real X timeline via the official Twitter embed widget (no API key, no cost).
function XTimeline({ username }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const id = 'twttr-wjs'
    if (!document.getElementById(id)) {
      const s = document.createElement('script')
      s.id = id; s.src = 'https://platform.twitter.com/widgets.js'; s.async = true
      document.body.appendChild(s)
    }
    const render = () => {
      if (window.twttr && window.twttr.widgets && ref.current) {
        ref.current.innerHTML = ''
        window.twttr.widgets.createTimeline(
          { sourceType: 'profile', screenName: username },
          ref.current,
          { height: 600, theme: 'dark' }
        )
      } else {
        setTimeout(render, 300)
      }
    }
    render()
  }, [username])
  return h('div', { ref, style: { minHeight: 200 } },
    h('div', { style: { fontSize: 12, color: '#888' } }, 'Loading @' + username + ' timeline…')
  )
}

function FeedItem({ it, meta }) {
  const m = it.metrics || {}
  return h('div', { style: feedItemStyle },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 } },
      h('span', { style: { fontWeight: 600, fontSize: 12, color: '#cbd5e1' } }, meta.dot ? (meta.dot(it) || '@' + (it.author || '?')) : ('@' + (it.author || '?'))),
      h('span', { style: { fontSize: 10, color: '#666' } }, ago(it.created_at))
    ),
    h('div', { style: { fontSize: 13, lineHeight: 1.4 } }, it[meta.field] || '(no text)'),
    (m.like_count != null || m.retweet_count != null) && h('div', { style: { marginTop: 6, fontSize: 11, color: '#888', display: 'flex', gap: 12 } },
      h('span', null, '♥ ' + (m.like_count ?? 0)),
      h('span', null, '⟲ ' + (m.retweet_count ?? 0)),
    ),
  )
}

// ── styles ──────────────────────────────────────────────────────────────────────
const paneStyle = { display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--text)', fontFamily: 'system-ui, sans-serif' }
const tabBarStyle = { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }
const fieldStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg, #111)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
const cardStyle = { border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(128,128,128,0.05)' }
const secTitleStyle = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 4 }
const secBodyStyle = { fontSize: 12, color: '#666' }
const feedItemStyle = { display: 'block', padding: 10, borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)', background: 'rgba(128,128,128,0.06)' }

function dotStyle(on) {
  return {
    width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
    background: on ? '#22c55e' : '#444',
    boxShadow: on ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
  }
}
function badgeStyle(on, fontSize = 11) {
  return {
    padding: '2px 6px', borderRadius: 6, fontWeight: 600, fontSize,
    background: on ? 'rgba(34,197,94,0.18)' : 'rgba(120,120,120,0.15)',
    color: on ? '#22c55e' : '#888',
  }
}
function btnStyle(primary, disabled) {
  return {
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? '#555' : primary ? 'var(--accent, #3b82f6)' : 'rgba(128,128,128,0.3)', color: '#fff', fontWeight: 600, fontSize: 13,
  }
}
function platBtn(active, configured, dim) {
  return {
    padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent, #3b82f6)' : 'transparent',
    color: active ? '#fff' : (dim ? '#555' : configured ? 'var(--text)' : '#888'),
    opacity: dim ? 0.6 : 1,
  }
}

export default {
  id: ID,
  register(ctx) {
    return ctx.register({ id: 'pane', area: 'panes', title: 'Social', data: { placement: 'main' }, render: () => h(SocialPane, {}) })
  },
}
