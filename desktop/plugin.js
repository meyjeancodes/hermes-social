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
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    tab === 'timeline' ? h(Timeline, { status })
      : tab === 'inbox' ? h(Inbox, { status })
      : tab === 'compose' ? h(Compose, { status, refresh: loadStatus })
      : tab === 'mass' ? h(MassPost, { status, refresh: loadStatus })
      : h(SettingsHub, { status, refresh: loadStatus })
  )
}

function Tab({ active, onClick, label }) {
  return h('button', { onClick, style: {
    background: active ? 'var(--ui-blue, #3b82f6)' : 'transparent',
    color: active ? '#fff' : 'var(--ui-text-tertiary, #888)',
    border: '1px solid ' + (active ? 'transparent' : 'var(--ui-stroke-secondary, #2a2f3a)'),
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
    fontFamily: MONO, fontSize: '0.58rem', fontWeight: 600,
    letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
  } }, label)
}

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
      testRes && h('span', { style: { fontSize: 11, color: testRes.ok ? '#22c55e' : '#f87171', marginLeft: 'auto' } }, testRes.ok ? '✓ verified' : '✗ failed')
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
      text.length > 0 && platform === 'x' && h('span', { style: { fontSize: 11, color: over ? '#f87171' : 'var(--ui-text-tertiary, #8b93a7)' } }, `${text.length}/280`),
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
    text.length > 0 && h('div', { style: { fontSize: 11, color: over ? '#f87171' : 'var(--ui-text-tertiary, #8b93a7)' } }, `${text.length}/280`),
    h('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'Post to:'),
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
        h('div', { key: k, style: { padding: 10, borderRadius: 8, fontSize: 12, background: '#1a1a1a', border: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
          h('div', { style: { fontWeight: 600, marginBottom: 2 } }, PLATFORMS.find((p) => p.key === k) ? PLATFORMS.find((p) => p.key === k).label : k),
          v.ok && h('div', { style: { color: '#22c55e' } }, '✓ ' + (v.url || v.id || 'Posted')),
          v.ok === false && v.link && h('a', { href: v.link, target: '_blank', rel: 'noreferrer', style: { color: '#60a5fa', textDecoration: 'none' } }, '↗ ' + (v.note || 'Open to post on X')),
          v.ok === false && !v.link && h('div', { style: { color: '#f87171', wordBreak: 'break-word' } }, '✗ ' + (v.error || 'failed')),
        )
      )
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
  // When X is the sole focused source, show the live interactive X site
  // (full browser webview) instead of the API post list — X's free tier
  // blocks API reads, and the live site is what "the X tab" should be.
  const onlyX = only.x && Object.keys(only).filter((k) => only[k]).length === 1

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', alignItems: 'center', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      h('input', { placeholder: 'Search the whole timeline…', value: q,
        onChange: (e) => setQ(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') reload() },
        style: { ...fieldStyle, flex: 1 } }),
      h('button', { onClick: reload, disabled: loading, style: platBtn(false) }, loading ? '↻…' : '↻'),
      h('button', { onClick: () => setAuto((a) => !a), title: 'check for new posts every 60s', style: platBtn(auto) }, auto ? '⏱ on' : '⏱ off'),
    ),
    h('div', { style: { display: 'flex', gap: 6, padding: '0 10px 8px', flexWrap: 'wrap', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } },
      avail.map((k) => h('button', { key: k, onClick: () => toggle(k),
        style: { ...platBtn(!!only[k]), borderColor: only[k] ? SRC_COLOR[k] : 'var(--ui-stroke-secondary, #2a2f3a)' } }, SRC_LABEL[k] || k)),
      Object.keys(only).some((k) => only[k]) && h('button', { onClick: () => setOnly({}), style: { ...platBtn(false), marginLeft: 'auto' } }, 'clear'),
    ),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    Object.keys(errors).length > 0 && h('div', { style: { padding: '6px 10px', fontSize: 11, color: '#f59e0b' } },
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
            loading && items.length === 0 && h('div', { style: secBodyStyle }, 'loading…'),
            !loading && items.length === 0 && h('div', { style: secBodyStyle }, q ? 'no matches' : 'nothing yet'),
            items.map((it) => h(StreamItem, { key: it.source + it.id, it })),
            items.length > 0 && h('div', { style: {
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
          it.author && h('span', { style: { fontSize: 11.5, color: 'var(--ui-text-tertiary, #8b93a7)' } }, '@' + it.author),
          h('span', { style: { fontSize: 10, color: 'var(--ui-text-tertiary, #8b93a7)' } }, '· ' + ago(it.created_at)),
          h('span', { style: { marginLeft: 'auto', fontFamily: MONO, fontSize: '0.48rem', fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
            color: SRC_COLOR[it.source] || 'var(--ui-text-tertiary, #8b93a7)',
            border: '1px solid ' + (SRC_COLOR[it.source] || 'var(--ui-stroke-secondary, #2a2f3a)') + '55',
            background: (SRC_COLOR[it.source] || 'var(--ui-text-tertiary, #8b93a7)') + '18' } }, SRC_LABEL[it.source] || it.source),
        ),
        heading && h('div', { style: { fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, marginTop: 4 } }, heading),
        body && h('div', { style: { fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', marginTop: heading ? 3 : 4, overflowWrap: 'anywhere' } }, body.slice(0, 700)),
        h(VideoEmbed, { video: it.video, url: it.url }),
        images.length > 0 && h(ImageGrid, { images }),
        !it.video && images.length === 0 && h(LinkCard, { link: it.link }),
        h('div', { style: { marginTop: 8, display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: 'var(--ui-text-tertiary, #8b93a7)' } },
          it.score != null && h('span', null, '♥ ' + it.score),
          it.num_comments != null && h('span', null, '💬 ' + it.num_comments),
          it.url && h('a', { href: it.url, target: '_blank', rel: 'noreferrer', style: {
            marginLeft: 'auto', color: 'var(--ui-text-tertiary, #8b93a7)', textDecoration: 'none',
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
        err && h('div', { style: { padding: '6px 12px', color: '#f87171', fontSize: 12 } }, err),
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
        background: cfg.enabled ? '#22c55e' : 'var(--ui-text-tertiary, #8b93a7)',
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
        h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 } }),
        h('span', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 12, fontWeight: 700 } }, p.name || p.address),
          h('div', { style: { fontFamily: MONO, fontSize: 9.5, color: 'var(--ui-text-tertiary, #8b93a7)', overflowWrap: 'anywhere' } }, p.address + ' · ' + (p.url || 'no url')),
        ),
        p.known && h('span', { style: { marginLeft: 'auto', fontFamily: MONO, fontSize: '0.45rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#22c55e' } }, 'known'),
      )),
    ),
    found && !found.running && h('div', { style: { fontSize: 10.5, color: '#f59e0b' } },
      'Network discovery is off' + (found.error ? ': ' + found.error : '') + '. You can still connect manually below.'),
    h('input', { value: addr, onChange: (e) => setAddr(e.target.value), placeholder: 'Agent address (hx_…)', style: fieldStyle }),
    h('input', { value: url, onChange: (e) => setUrl(e.target.value), placeholder: 'Their URL (http://host:8731)', style: fieldStyle }),
    h('textarea', { value: body, onChange: (e) => setBody(e.target.value), placeholder: 'First message…', rows: 3, style: { ...fieldStyle, resize: 'vertical' } }),
    err && h('div', { style: { color: '#f87171', fontSize: 12 } }, err),
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
    background: active ? 'rgba(127,127,127,0.14)' : 'transparent',
    border: '1px solid ' + (active ? 'var(--ui-stroke-secondary, #2a2f3a)' : 'transparent'),
  } }, label)
}

// ── Sources (credential-free feed config) ─────────────────────────────────────
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
    h('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' } }, 'These feeds need no login at all — Bluesky, Mastodon, YouTube, RSS, Hacker News and Reddit all read anonymously. Everything here flows into Timeline.'),
    h('div', { style: cardStyle },
      h('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 8 } }, 'Active in Timeline'),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        TOGGLEABLE.map((k) => h('button', { key: k, onClick: () => toggle(k),
          style: { ...platBtn(enabled.includes(k)), borderColor: enabled.includes(k) ? SRC_COLOR[k] : 'var(--ui-stroke-secondary, #2a2f3a)' } }, SRC_LABEL[k] || k))
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
        saved && h('span', { style: { fontSize: 11, color: '#22c55e' } }, 'saved — Timeline will use these on next refresh'),
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

// ── X Site (full interactive X in a webview) ──────────────────────────────────
// A normal <iframe> to x.com is BLOCKED by X-Frame-Options: DENY, so a
// read-only embed is the most an iframe can show. To get the FULL interactive
// site — the thing Marco (@mfranz_on) embedded — we use an
// Electron <webview> guest. The Hermes chat window sets webviewTag: true
// (electron/session-windows.cjs) with no CSP webview-src restriction, so a
// webview is a real top-level navigation that ignores X-Frame-Options. We give
// it a persistent partition so your X login survives reloads (no infinite
// login loop). Posting/scrolling/DMs all work here, exactly like a browser.
const XSITE_PARTITION = 'persist:hermes-social-x'
const XSITE_START = 'https://x.com/home'
// OAuth providers (Apple/Google/Facebook) open their auth page in a popup.
// The webview's allowpopups is off, so that popup is silently dropped and the
// login can never finish. We detect those URLs and run the flow in the SAME
// guest so the session cookie lands in our persistent partition.
const isAuthPopup = (u) => /accounts\.google\.com|appleid\.apple\.com|facebook\.com|\/oauth\/|authorize|sign[_-]?in|auth\./i.test(u)
function XBrowser({ initialUrl }) {
  const start = initialUrl || XSITE_START
  const wv = React.useRef(null)
  const [url, setUrl] = React.useState(start)
  const [nav, setNav] = React.useState({ canGoBack: false, canGoForward: false })
  const [loading, setLoading] = React.useState(true)
  const [domReady, setDomReady] = React.useState(false)
  const [err, setErr] = React.useState(null)

  // webviews are created by the Electron webview-tag machinery, not React's
  // reconciler, so we wire their events imperatively once the node exists.
  React.useEffect(() => {
    const el = wv.current
    if (!el) return
    const onDom = () => { setDomReady(true); setLoading(true) }
    const onLoad = () => { setLoading(false) }
    const onFail = (e) => {
      setLoading(false)
      const code = e && (e.errorCode || (e.details && e.details.errorCode))
      const desc = e && (e.errorDescription || (e.details && e.details.errorDescription) || '')
      // ERR_ABORTED (-3) fires on normal in-page navigation; ignore it.
      if (code === -3) return
      setErr('x.com failed to load: ' + (desc || ('code ' + code)) +
        '. If you are offline or behind a corporate proxy, the webview cannot reach X.')
    }
    const onNav = (e) => { if (e && e.url) setUrl(e.url) }
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
    el.addEventListener('new-window', onNewWindow)
    return () => {
      el.removeEventListener('did-attach', onDom)
      el.removeEventListener('did-finish-load', onLoad)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('did-change-can-go-back-forward', onCanGo)
      el.removeEventListener('new-window', onNewWindow)
    }
  }, [])

  const go = (target) => {
    const el = wv.current
    let u = (target || url || '').trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    setUrl(u); setLoading(true); setErr(null)
    if (el && typeof el.loadURL === 'function') el.loadURL(u)
  }
  const reload = () => { const el = wv.current; if (el && typeof el.reload === 'function') { setLoading(true); el.reload() } }
  const back = () => { const el = wv.current; if (el && nav.canGoBack && typeof el.goBack === 'function') el.goBack() }
  const fwd = () => { const el = wv.current; if (el && nav.canGoForward && typeof el.goForward === 'function') el.goForward() }

  const btn = (label, onClick, disabled, primary) => h('button', {
    onClick, disabled: !!disabled, title: label,
    style: {
      background: primary ? 'var(--ui-blue, #3b82f6)' : 'rgba(127,127,127,0.10)',
      color: primary ? '#fff' : 'var(--ui-text-secondary, #b6bccb)',
      border: '1px solid ' + (primary ? 'transparent' : 'var(--ui-stroke-secondary, #2a2f3a)'),
      borderRadius: 6, padding: '4px 8px', cursor: disabled ? 'default' : 'pointer',
      fontFamily: MONO, fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.12em',
      textTransform: 'uppercase', lineHeight: 1, opacity: disabled ? 0.4 : 1,
    },
  }, label)

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)', alignItems: 'center', flexShrink: 0 } },
      btn('‹', back, !nav.canGoBack),
      btn('›', fwd, !nav.canGoForward),
      h('input', {
        value: url, onChange: (e) => setUrl(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') go() },
        placeholder: 'https://x.com/...',
        style: { ...fieldStyle, flex: 1, minWidth: 80 },
      }),
      btn('Go', () => go(), false, true),
      btn('↻', reload, false),
    ),
    err && h('div', { style: { padding: '8px 12px', fontSize: 12, color: '#f87171', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } }, err),
    loading && h('div', { style: { fontSize: 11, fontFamily: MONO, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ui-text-tertiary, #8b93a7)', padding: '4px 12px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)' } }, 'loading x.com…'),
    h('webview', {
      ref: wv,
      src: start,
      partition: XSITE_PARTITION,
      // Sandbox is already true at the window level; allow-scripts keeps the
      // SPA alive, allow-popups lets "open in new tab" escape to the OS browser.
      style: { flex: 1, width: '100%', minHeight: 0, border: 'none', background: '#000' },
      // attrs that Electron reads off the element:
    }),
    h('div', { style: { fontSize: 10, color: 'var(--ui-text-tertiary, #8b93a7)', padding: '4px 10px', borderTop: '1px solid var(--ui-stroke-secondary, #2a2f3a)', fontFamily: MONO, letterSpacing: '0.08em' } },
      'Full X inside Hermes — log in once, stays logged in. Not an API feed.'),
  )
}

// ── styles ──────────────────────────────────────────────────────────────────────
// Colours come from the Hermes design tokens (--ui-*). Earlier this file used
// --bg/--text/--border/--accent, which are defined NOWHERE in the app's CSS, so
// every one silently fell back to a hardcoded literal — that was the black
// boxes and the invisible banner.
const paneStyle = { display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--ui-text-primary, #e7e9ee)', fontFamily: 'var(--dt-font-sans, system-ui, sans-serif)' }
const tabBarStyle = { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--ui-stroke-secondary, #2a2f3a)', alignItems: 'center', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }
const fieldStyle = { padding: '7px 9px', borderRadius: 7, border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', background: 'rgba(127,127,127,0.10)', color: 'var(--ui-text-primary, #e7e9ee)', fontSize: 12.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
const cardStyle = { border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', borderRadius: 10, padding: 12, background: 'rgba(127,127,127,0.06)' }
const secTitleStyle = { fontFamily: MONO, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--ui-text-tertiary, #8b93a7)', marginBottom: 5 }
const secBodyStyle = { fontSize: 12, color: 'var(--ui-text-tertiary, #8b93a7)' }
const feedItemStyle = { display: 'block', padding: 10, borderRadius: 8, border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', textDecoration: 'none', color: 'var(--ui-text-primary, #e7e9ee)', background: 'rgba(127,127,127,0.06)' }
const cardShell = { padding: '12px 14px', borderRadius: 12, border: '1px solid var(--ui-stroke-secondary, #2a2f3a)', background: 'rgba(127,127,127,0.05)' }

function dotStyle(on) {
  return {
    width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
    background: on ? '#22c55e' : 'var(--ui-stroke-secondary, #2a2f3a)',
    boxShadow: on ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
  }
}
function badgeStyle(on, fontSize = 11) {
  return {
    padding: '2px 6px', borderRadius: 6, fontWeight: 600, fontSize,
    background: on ? 'rgba(34,197,94,0.18)' : 'rgba(120,120,120,0.15)',
    color: on ? '#22c55e' : 'var(--ui-text-tertiary, #8b93a7)',
  }
}
function btnStyle(primary, disabled) {
  return {
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'var(--ui-stroke-secondary, #2a2f3a)' : primary ? 'var(--ui-blue, #3b82f6)' : 'rgba(128,128,128,0.3)', color: '#fff', fontWeight: 600, fontSize: 13,
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
export const __test__ = { StreamItem, Avatar, ImageGrid, LinkCard, QuoteCard, VideoEmbed, Timeline, Inbox, Sources, Messages, Bubble, NewConversation, Engagement, AutoReply, FeedList }

export default {
  id: ID,
  register(ctx) {
    return ctx.register({ id: 'pane', area: 'panes', title: 'Social', data: { placement: 'main' }, render: () => h(SocialPane, {}) })
  },
}
