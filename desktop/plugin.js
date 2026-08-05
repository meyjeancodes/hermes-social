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
  { key: 'hn', label: 'Hacker News', fields: [], public: true },
]

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
const JH = { 'Content-Type': 'application/json' }

function Banner({ nConn, total, onRefresh }) {
  return h('div', { style: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px 8px', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))',
  } },
    h('span', { style: {
      fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700,
      letterSpacing: '0.34em', textTransform: 'uppercase',
      color: 'var(--ui-text-primary, var(--text))',
    } }, 'Hermes'),
    h('span', { style: {
      fontFamily: MONO, fontSize: '0.72rem', fontWeight: 400,
      letterSpacing: '0.34em', textTransform: 'uppercase',
      color: 'var(--ui-text-tertiary, #6b7280)',
    } }, '⁄ Social'),
    h('span', { style: { flex: 1 } }),
    h('span', { style: {
      fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.16em',
      textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #6b7280)',
      border: '1px solid var(--ui-stroke-secondary, var(--border))',
      borderRadius: 4, padding: '2px 6px', background: 'rgba(255,255,255,0.03)',
    } }, nConn + '/' + total + ' linked'),
  )
}

function SocialPane() {
  const [tab, setTab] = React.useState('timeline')
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
    h(Banner, { nConn, total: PLATFORMS.length }),
    h('div', { style: tabBarStyle },
      h(Tab, { active: tab === 'timeline', onClick: () => setTab('timeline'), label: 'Timeline' }),
      h(Tab, { active: tab === 'inbox', onClick: () => setTab('inbox'), label: 'Inbox' }),
      h(Tab, { active: tab === 'feeds', onClick: () => setTab('feeds'), label: 'Feeds' }),
      h(Tab, { active: tab === 'compose', onClick: () => setTab('compose'), label: 'Compose' }),
      h(Tab, { active: tab === 'mass', onClick: () => setTab('mass'), label: 'Mass Post' }),
      h(Tab, { active: tab === 'sources', onClick: () => setTab('sources'), label: 'Sources' }),
      h(Tab, { active: tab === 'settings', onClick: () => setTab('settings'), label: 'Settings' }),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' } },
        PLATFORMS.map((p) =>
          h('span', { key: p.key, title: p.label + (connected[p.key] ? ' · connected' : ' · not set'),
            style: dotStyle(connected[p.key]) })
        )
      )
    ),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    tab === 'timeline' ? h(Timeline, { status })
      : tab === 'inbox' ? h(Inbox, { status })
      : tab === 'sources' ? h(Sources, {})
      : tab === 'feeds' ? h(Feeds, { status, refresh: loadStatus })
      : tab === 'compose' ? h(Compose, { status, refresh: loadStatus })
      : tab === 'mass' ? h(MassPost, { status, refresh: loadStatus })
      : h(Settings, { status, refresh: loadStatus })
  )
}

function Tab({ active, onClick, label }) {
  return h('button', { onClick, style: {
    background: active ? 'var(--accent, #3b82f6)' : 'transparent',
    color: active ? '#fff' : 'var(--ui-text-tertiary, #888)',
    border: '1px solid ' + (active ? 'transparent' : 'var(--ui-stroke-secondary, var(--border))'),
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
    fontFamily: MONO, fontSize: '0.58rem', fontWeight: 600,
    letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
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
    text.length > 0 && h('div', { style: { fontSize: 11, color: over ? '#f87171' : '#888' } }, `${text.length}/280`),
    h('div', { style: { fontSize: 12, color: '#888' } }, 'Post to:'),
    allConn.length === 0 && h('div', { style: { fontSize: 12, color: '#f59e0b' } }, 'No platforms connected yet — add creds in Settings (and hit Test).'),
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
      note && h('span', { style: { fontSize: 11, color: '#22c55e' } }, note),
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
    hn: { name: 'Hacker News', field: 'title', sub: (i) => '▲ ' + (i.score ?? 0) + ' · ' + (i.num_comments ?? 0) + ' comments' },
  }
  const keys = plat === 'all' ? ['x', 'reddit', 'facebook', 'instagram', 'tiktok', 'twitch', 'hn'] : [plat]
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

// ── Timeline (unified, searchable, credential-free) ──────────────────────────
const SRC_LABEL = { bluesky: 'Bluesky', mastodon: 'Mastodon', youtube: 'YouTube', rss: 'RSS', hn: 'HN', reddit: 'Reddit', instagram: 'Instagram', facebook: 'Facebook', twitch: 'Twitch', x: 'X' }
const SRC_COLOR = { bluesky: '#3b82f6', mastodon: '#8b5cf6', youtube: '#ef4444', rss: '#f59e0b', hn: '#fb923c', reddit: '#f97316', instagram: '#ec4899', facebook: '#2563eb', twitch: '#a855f7', x: '#e5e7eb' }

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

function Timeline({ status }) {
  const { data, loading, err, load } = useStream('/timeline')
  const [q, setQ] = React.useState('')
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
    if (q.trim()) p.push('q=' + encodeURIComponent(q.trim()))
    if (sel.length) p.push('sources=' + sel.join(','))
    return p.join('&')
  }, [q, only])

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

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', alignItems: 'center', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))' } },
      h('input', { placeholder: 'Search the whole timeline…', value: q,
        onChange: (e) => setQ(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') reload() },
        style: { ...fieldStyle, flex: 1 } }),
      h('button', { onClick: reload, disabled: loading, style: platBtn(false) }, loading ? '↻…' : '↻'),
      h('button', { onClick: () => setAuto((a) => !a), title: 'check for new posts every 60s', style: platBtn(auto) }, auto ? '⏱ on' : '⏱ off'),
    ),
    h('div', { style: { display: 'flex', gap: 6, padding: '0 10px 8px', flexWrap: 'wrap', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))' } },
      avail.map((k) => h('button', { key: k, onClick: () => toggle(k),
        style: { ...platBtn(!!only[k]), borderColor: only[k] ? SRC_COLOR[k] : 'var(--border)' } }, SRC_LABEL[k] || k)),
      Object.keys(only).some((k) => only[k]) && h('button', { onClick: () => setOnly({}), style: { ...platBtn(false), marginLeft: 'auto' } }, 'clear'),
    ),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    Object.keys(errors).length > 0 && h('div', { style: { padding: '6px 10px', fontSize: 11, color: '#f59e0b' } },
      Object.entries(errors).map(([k, v]) => (SRC_LABEL[k] || k) + ': ' + v).join('  ·  ')),
    pending.length > 0 && h('button', { onClick: showPending, style: {
      position: 'absolute', top: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
      padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
      background: 'var(--accent, #3b82f6)', color: '#fff', border: 'none',
      fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
      letterSpacing: '0.14em', textTransform: 'uppercase',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    } }, '↑ ' + pending.length + ' new post' + (pending.length === 1 ? '' : 's')),
    h('div', { ref: scroller, onScroll, style: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
      loading && items.length === 0 && h('div', { style: secBodyStyle }, 'loading…'),
      !loading && items.length === 0 && h('div', { style: secBodyStyle }, q ? 'no matches' : 'nothing yet'),
      items.map((it) => h(StreamItem, { key: it.source + it.id, it })),
      items.length > 0 && h('div', { style: {
        padding: '10px 0 4px', textAlign: 'center', fontFamily: MONO,
        fontSize: '0.5rem', letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--ui-text-tertiary, #6b7280)',
      } }, loading ? 'loading more…' : (maxedOut || per >= 60) ? '· end of feed ·' : 'scroll for more'),
    )
  )
}

function Avatar({ src, name, size = 34 }) {
  const initial = (name || '?').replace(/^@/, '').slice(0, 1).toUpperCase()
  if (src) {
    return h('img', { src, alt: name || '', style: {
      width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
      border: '1px solid var(--ui-stroke-secondary, var(--border))', background: 'rgba(128,128,128,0.15)',
    } })
  }
  return h('div', { style: {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(128,128,128,0.18)', color: 'var(--ui-text-tertiary, #9ca3af)',
    fontFamily: MONO, fontSize: size * 0.4, fontWeight: 700,
  } }, initial)
}

function ImageGrid({ images }) {
  const n = images.length
  if (!n) return null
  const cols = n === 1 ? 1 : 2
  return h('div', { style: {
    marginTop: 8, display: 'grid', gap: 4, gridTemplateColumns: `repeat(${cols}, 1fr)`,
    borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ui-stroke-secondary, var(--border))',
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
    border: '1px solid var(--ui-stroke-secondary, var(--border))', borderRadius: 10,
    overflow: 'hidden', background: 'rgba(128,128,128,0.06)',
  } },
    link.thumb && h('img', { src: link.thumb, alt: '', loading: 'lazy', style: { width: 92, height: 92, objectFit: 'cover', flexShrink: 0 } }),
    h('div', { style: { padding: '8px 10px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
      host && h('span', { style: { fontFamily: MONO, fontSize: '0.52rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #9ca3af)' } }, host),
      link.title && h('span', { style: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 } }, link.title.slice(0, 120)),
      link.description && h('span', { style: { fontSize: 11.5, color: 'var(--ui-text-tertiary, #9ca3af)', lineHeight: 1.35 } }, link.description.slice(0, 140)),
    )
  )
}

function QuoteCard({ q }) {
  if (!q) return null
  return h('div', { style: {
    marginTop: 8, padding: 10, borderRadius: 10,
    border: '1px solid var(--ui-stroke-secondary, var(--border))', background: 'rgba(128,128,128,0.06)',
  } },
    h('div', { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4 } },
      h(Avatar, { src: q.avatar, name: q.name || q.author, size: 20 }),
      h('span', { style: { fontSize: 11.5, fontWeight: 600 } }, q.name || q.author),
      h('span', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #9ca3af)' } }, '@' + q.author),
      q.created_at && h('span', { style: { fontSize: 10, color: '#666', marginLeft: 'auto' } }, ago(q.created_at)),
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
      border: '1px solid var(--ui-stroke-secondary, var(--border))', borderRadius: 10,
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

function StreamItem({ it }) {
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
          it.author && h('span', { style: { fontSize: 11.5, color: 'var(--ui-text-tertiary, #9ca3af)' } }, '@' + it.author),
          h('span', { style: { fontSize: 10, color: '#666' } }, '· ' + ago(it.created_at)),
          h('span', { style: { marginLeft: 'auto', fontFamily: MONO, fontSize: '0.48rem', fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
            color: SRC_COLOR[it.source] || '#9ca3af',
            border: '1px solid ' + (SRC_COLOR[it.source] || '#555') + '55',
            background: (SRC_COLOR[it.source] || '#888') + '18' } }, SRC_LABEL[it.source] || it.source),
        ),
        heading && h('div', { style: { fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, marginTop: 4 } }, heading),
        body && h('div', { style: { fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', marginTop: heading ? 3 : 4, overflowWrap: 'anywhere' } }, body.slice(0, 700)),
        h(VideoEmbed, { video: it.video, url: it.url }),
        images.length > 0 && h(ImageGrid, { images }),
        !it.video && images.length === 0 && h(LinkCard, { link: it.link }),
        h('div', { style: { marginTop: 8, display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: 'var(--ui-text-tertiary, #9ca3af)' } },
          it.score != null && h('span', null, '♥ ' + it.score),
          it.num_comments != null && h('span', null, '💬 ' + it.num_comments),
          it.url && h('a', { href: it.url, target: '_blank', rel: 'noreferrer', style: {
            marginLeft: 'auto', color: 'var(--ui-text-tertiary, #9ca3af)', textDecoration: 'none',
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
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))' } },
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
    h('div', { style: { width: 210, borderRight: '1px solid var(--ui-stroke-secondary, var(--border))', display: 'flex', flexDirection: 'column' } },
      h('div', { style: { padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))' } },
        h('button', { onClick: () => setShowAdd(true), style: { ...platBtn(false), width: '100%' } }, '+ New conversation'),
      ),
      h('div', { style: { flex: 1, overflowY: 'auto' } },
        threads.length === 0 && h('div', { style: { ...secBodyStyle, padding: 10 } }, 'No conversations yet.'),
        threads.map((t) => h('button', { key: t.thread, onClick: () => setActive(t.thread), style: {
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          padding: '9px 10px', border: 'none', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))',
          background: active === t.thread ? 'rgba(59,130,246,0.14)' : 'transparent', color: 'var(--text)',
        } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.peer_name || t.peer),
            t.unread > 0 && h('span', { style: { marginLeft: 'auto', minWidth: 16, textAlign: 'center', borderRadius: 999, background: 'var(--accent, #3b82f6)', color: '#fff', fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700, padding: '1px 5px' } }, String(t.unread)),
          ),
          h('div', { style: { fontSize: 11, color: 'var(--ui-text-tertiary, #9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 } }, t.preview || ''),
        )),
      ),
      me && h('div', { style: { padding: '8px 10px', borderTop: '1px solid var(--ui-stroke-secondary, var(--border))' } },
        h('div', { style: { fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #6b7280)' } }, 'Your address'),
        h('div', { title: 'Share this with another agent so they can message you',
          style: { fontFamily: MONO, fontSize: 10, marginTop: 3, overflowWrap: 'anywhere', color: 'var(--text)' } }, me.address),
      ),
    ),
    // ── conversation ──
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 } },
      showAdd && h(NewConversation, { onClose: () => setShowAdd(false), onDone: (th) => { setShowAdd(false); refresh(); if (th) setActive(th) } }),
      !conv && !showAdd && h('div', { style: { ...secBodyStyle, padding: 16 } },
        me ? 'Pick a conversation, or start one with another agent’s hx_ address.' : 'connecting…'),
      conv && h(React.Fragment, null,
        h('div', { style: { padding: '8px 12px', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))' } },
          h('div', { style: { fontSize: 13, fontWeight: 700 } }, conv.peer_name || conv.peer),
          h('div', { style: { fontFamily: MONO, fontSize: 10, color: 'var(--ui-text-tertiary, #6b7280)', overflowWrap: 'anywhere' } }, conv.peer),
        ),
        h('div', { style: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
          conv.messages.map((m) => h(Bubble, { key: m.id, m })),
          h('div', { ref: endRef }),
        ),
        err && h('div', { style: { padding: '6px 12px', color: '#f87171', fontSize: 12 } }, err),
        h('div', { style: { display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--ui-stroke-secondary, var(--border))' } },
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

function Bubble({ m }) {
  const out = m.dir === 'out'
  return h('div', { style: { display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' } },
    h('div', { style: {
      maxWidth: '78%', padding: '8px 11px', borderRadius: 12,
      borderBottomRightRadius: out ? 3 : 12, borderBottomLeftRadius: out ? 12 : 3,
      background: out ? 'var(--accent, #3b82f6)' : 'rgba(128,128,128,0.14)',
      color: out ? '#fff' : 'var(--text)',
      border: out ? 'none' : '1px solid var(--ui-stroke-secondary, var(--border))',
    } },
      h('div', { style: { fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, m.body),
      h('div', { title: 'Signature verified on receipt', style: {
        marginTop: 4, fontFamily: MONO, fontSize: '0.45rem', letterSpacing: '0.1em',
        textTransform: 'uppercase', opacity: 0.7,
      } }, (out ? '' : '✓ signed · ') + ago(m.ts)),
    )
  )
}

function NewConversation({ onClose, onDone }) {
  const [addr, setAddr] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')
  const go = () => {
    if (!addr.trim() || !body.trim()) return
    setBusy(true); setErr('')
    fetch(API + '/a2a/send', { method: 'POST', headers: JH, body: JSON.stringify({ to: addr.trim(), url: url.trim(), body: body.trim() }) })
      .then((r) => r.json()).then((d) => {
        if (!d.ok) setErr(d.error || 'send failed')
        else onDone(d.thread)
      }).catch((e) => setErr(String(e))).finally(() => setBusy(false))
  }
  return h('div', { style: { padding: 14, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))' } },
    h('div', { style: { fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #6b7280)' } }, 'New conversation'),
    h('input', { value: addr, onChange: (e) => setAddr(e.target.value), placeholder: 'Agent address (hx_…)', style: fieldStyle }),
    h('input', { value: url, onChange: (e) => setUrl(e.target.value), placeholder: 'Their URL (http://host:8731) — needed for first contact', style: fieldStyle }),
    h('textarea', { value: body, onChange: (e) => setBody(e.target.value), placeholder: 'First message…', rows: 3, style: { ...fieldStyle, resize: 'vertical' } }),
    err && h('div', { style: { color: '#f87171', fontSize: 12 } }, err),
    h('div', { style: { display: 'flex', gap: 6 } },
      h('button', { onClick: go, disabled: busy || !addr.trim() || !body.trim(), style: platBtn(true) }, busy ? 'Sending…' : 'Send'),
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
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))' } },
      h('span', { style: { fontSize: 12, color: '#888' } }, 'Mentions, replies and new followers across connected platforms.'),
      h('button', { onClick: () => load('limit=40'), disabled: loading, style: { ...platBtn(false), marginLeft: 'auto' } }, loading ? '↻…' : '↻ Refresh'),
    ),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    data && data.hint && h('div', { style: { padding: 10, fontSize: 12, color: '#f59e0b' } }, '⚠ ' + data.hint),
    Object.keys(errors).length > 0 && h('div', { style: { padding: '6px 10px', fontSize: 11, color: '#f59e0b' } },
      Object.entries(errors).map(([k, v]) => (SRC_LABEL[k] || k) + ': ' + v).join('  ·  ')),
    h('div', { style: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
      loading && items.length === 0 && h('div', { style: secBodyStyle }, 'loading…'),
      !loading && items.length === 0 && !((data || {}).hint) && h('div', { style: secBodyStyle }, 'nothing yet'),
      items.map((it) => h(StreamItem, { key: it.source + it.id, it })),
    )
  )
}

// ── Sources (credential-free feed config) ─────────────────────────────────────
const SRC_FIELDS = [
  { k: 'bluesky_handle', label: 'Bluesky handle', ph: 'someone.bsky.social' },
  { k: 'mastodon_instance', label: 'Mastodon instance', ph: 'fosstodon.org' },
  { k: 'youtube_channel_id', label: 'YouTube channel ID', ph: 'UCxxxxxxxxxxxxxxxxxxxxxx' },
  { k: 'rss_url', label: 'RSS / Atom feed URL', ph: 'https://example.com/feed' },
  { k: 'subreddit', label: 'Subreddit', ph: 'robotics' },
]
const TOGGLEABLE = ['bluesky', 'mastodon', 'youtube', 'rss', 'hn', 'reddit']

function Sources() {
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
    h('div', { style: { fontSize: 12, color: '#888' } }, 'These feeds need no login at all — Bluesky, Mastodon, YouTube, RSS, Hacker News and Reddit all read anonymously. Everything here flows into Timeline.'),
    h('div', { style: cardStyle },
      h('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 8 } }, 'Active in Timeline'),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        TOGGLEABLE.map((k) => h('button', { key: k, onClick: () => toggle(k),
          style: { ...platBtn(enabled.includes(k)), borderColor: enabled.includes(k) ? SRC_COLOR[k] : 'var(--border)' } }, SRC_LABEL[k] || k))
      )
    ),
    h('div', { style: cardStyle },
      SRC_FIELDS.map((f) => h('div', { key: f.k, style: { marginBottom: 10 } },
        h('label', { style: { fontSize: 11, color: '#aaa', display: 'block', marginBottom: 3 } }, f.label),
        h('input', { placeholder: f.ph, value: src[f.k] || '', onChange: (e) => set(f.k, e.target.value), style: fieldStyle })
      )),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('button', { onClick: save, disabled: busy, style: btnStyle(true, busy) }, busy ? 'Saving…' : 'Save sources'),
        saved && h('span', { style: { fontSize: 11, color: '#22c55e' } }, 'saved — Timeline will use these on next refresh'),
      )
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
const tabBarStyle = { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, var(--border))', alignItems: 'center', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }
const fieldStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg, #111)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
const cardStyle = { border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(128,128,128,0.05)' }
const secTitleStyle = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 4 }
const secBodyStyle = { fontSize: 12, color: '#666' }
const feedItemStyle = { display: 'block', padding: 10, borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)', background: 'rgba(128,128,128,0.06)' }
const cardShell = { padding: '12px 14px', borderRadius: 12, border: '1px solid var(--ui-stroke-secondary, var(--border))', background: 'rgba(128,128,128,0.05)' }

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

// Exported for the render/embed test harnesses (scripts/*.mjs). Not used by the app.
export const __test__ = { StreamItem, Avatar, ImageGrid, LinkCard, QuoteCard, VideoEmbed, Timeline, Inbox, Sources, Messages, Bubble, NewConversation, Engagement }

export default {
  id: ID,
  register(ctx) {
    return ctx.register({ id: 'pane', area: 'panes', title: 'Social', data: { placement: 'main' }, render: () => h(SocialPane, {}) })
  },
}
