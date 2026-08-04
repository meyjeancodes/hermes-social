// ~/.hermes/desktop-plugins/hermes-social/plugin.js
// Hermes Social — multi-platform social pane (X, Reddit, Facebook, Instagram).
// Talks to the local `social serve` backend at http://127.0.0.1:8731.
// Secrets live in ~/.hermes/.env; the pane only ever sees JSON results.

import React from 'react'
import { host, cn } from '@hermes/plugin-sdk'

const ID = 'hermes-social'
const h = React.createElement
const API = 'http://127.0.0.1:8731'

const PLATFORMS = [
  { key: 'x', label: 'X' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
]

// boot powered-on: status loads immediately, no "off" default
function SocialPane({ ctx }) {
  const [tab, setTab] = React.useState('compose')
  const [status, setStatus] = React.useState(null)
  const [err, setErr] = React.useState(null)

  const loadStatus = React.useCallback(() => {
    fetch(API + '/status')
      .then((r) => r.json())
      .then((d) => { setStatus(d); setErr(null) })
      .catch((e) => setErr('Cannot reach social server — is it running? (`social serve`)'))
  }, [])

  React.useEffect(() => { loadStatus() }, [loadStatus])

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--text)', fontFamily: 'system-ui, sans-serif' } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)' } },
      h(Tab, { active: tab === 'compose', onClick: () => setTab('compose'), label: 'Compose' }),
      h(Tab, { active: tab === 'feeds', onClick: () => setTab('feeds'), label: 'Feeds' }),
      status && h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 } },
        PLATFORMS.map((p) =>
          h('span', { key: p.key, title: p.label, style: {
            padding: '2px 6px', borderRadius: 6,
            background: (status.configured || {})[p.key] ? 'rgba(34,197,94,0.18)' : 'rgba(120,120,120,0.15)',
            color: (status.configured || {})[p.key] ? '#22c55e' : '#888',
          } }, p.label)
        )
      )
    ),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    tab === 'compose'
      ? h(Compose, { status })
      : h(Feeds, { status })
  )
}

function Tab({ active, onClick, label }) {
  return h('button', {
    onClick,
    style: {
      background: active ? 'var(--accent, #3b82f6)' : 'transparent',
      color: active ? '#fff' : 'var(--text)',
      border: '1px solid var(--border)', borderRadius: 8, padding: '5px 12px',
      cursor: 'pointer', fontSize: 13, fontWeight: 600,
    },
  }, label)
}

function Compose({ status }) {
  const [platform, setPlatform] = React.useState('x')
  const [text, setText] = React.useState('')
  const [sub, setSub] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [imgUrl, setImgUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)

  const configured = (status && status.configured) || {}
  const disabled = !configured[platform]

  const send = () => {
    if (busy || disabled) return
    setBusy(true); setResult(null)
    const body = { text }
    if (platform === 'reddit') { body.subreddit = sub; body.title = title }
    if (platform === 'instagram') body.image_url = imgUrl
    fetch(API + '/post/' + platform, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => { setResult(d); if (d.ok) setText('') })
      .catch((e) => setResult({ ok: false, error: String(e) }))
      .finally(() => setBusy(false))
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' } },
    h('div', { style: { display: 'flex', gap: 6 } },
      PLATFORMS.map((p) =>
        h('button', {
          key: p.key, onClick: () => setPlatform(p.key),
          style: {
            flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: platform === p.key ? 'var(--accent, #3b82f6)' : 'transparent',
            color: platform === p.key ? '#fff' : (configured[p.key] ? 'var(--text)' : '#888'),
            fontSize: 12, fontWeight: 600,
          },
        }, p.label)
      )
    ),
    disabled && h('div', { style: { fontSize: 12, color: '#f59e0b' } }, `⚠ ${platform} not configured — add its creds to ~/.hermes/.env`),
    platform === 'reddit' && h('input', {
      placeholder: 'subreddit (e.g. python)', value: sub,
      onChange: (e) => setSub(e.target.value),
      style: fieldStyle,
    }),
    platform === 'reddit' && h('input', {
      placeholder: 'title', value: title,
      onChange: (e) => setTitle(e.target.value),
      style: fieldStyle,
    }),
    platform === 'instagram' && h('input', {
      placeholder: 'image URL (hosted)', value: imgUrl,
      onChange: (e) => setImgUrl(e.target.value),
      style: fieldStyle,
    }),
    h('textarea', {
      placeholder: platform === 'reddit' ? 'body text' : 'what do you want to say?',
      value: text, onChange: (e) => setText(e.target.value), rows: 5,
      style: { ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' },
    }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      h('button', {
        onClick: send, disabled: busy || disabled,
        style: {
          padding: '8px 18px', borderRadius: 8, border: 'none', cursor: busy || disabled ? 'not-allowed' : 'pointer',
          background: busy || disabled ? '#555' : 'var(--accent, #3b82f6)', color: '#fff', fontWeight: 600, fontSize: 13,
        },
      }, busy ? 'Sending…' : 'Post'),
      text.length > 0 && h('span', { style: { fontSize: 11, color: '#888' } }, platform === 'instagram' || platform === 'facebook' ? '' : `${text.length}/280`)
    ),
    result && h('div', {
      style: {
        padding: 10, borderRadius: 8, fontSize: 12,
        background: result.ok ? 'rgba(34,197,94,0.15)' : 'rgba(248,113,113,0.15)',
        color: result.ok ? '#22c55e' : '#f87171',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
    }, result.ok ? '✓ ' + (result.url || result.id || 'Posted') : '✗ ' + (result.error || 'failed'))
  )
}

function Feeds({ status }) {
  const [plat, setPlat] = React.useState('all')
  const [items, setItems] = React.useState({})
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState(null)

  const load = () => {
    setLoading(true); setErr(null)
    fetch(API + '/feeds?platform=' + plat + '&limit=8')
      .then((r) => r.json())
      .then((d) => setItems(d))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false))
  }
  React.useEffect(() => { load() }, [plat])

  const pmeta = {
    x: { name: 'X', field: 'text', sub: (i) => '@' + (i.author || '?') },
    reddit: { name: 'Reddit', field: 'title', sub: (i) => 'r/' + (i.subreddit || '?') + ' · ' + (i.score || 0) + '↑' },
    facebook: { name: 'Facebook', field: 'text', sub: () => '' },
    instagram: { name: 'Instagram', field: 'text', sub: () => '' },
  }

  const keys = plat === 'all' ? ['x', 'reddit', 'facebook', 'instagram'] : [plat]
  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { style: { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)' } },
      h('button', { onClick: () => setPlat('all'), style: platBtn(plat === 'all') }, 'All'),
      ...PLATFORMS.map((p) => h('button', { key: p.key, onClick: () => setPlat(p.key), style: platBtn(plat === p.key) }, p.label)),
      h('button', { onClick: load, disabled: loading, style: { ...platBtn(false), marginLeft: 'auto' } }, loading ? '…' : 'Refresh')
    ),
    err && h('div', { style: { padding: 10, color: '#f87171', fontSize: 12 } }, err),
    h('div', { style: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 12 } },
      keys.map((k) => {
        const meta = pmeta[k]
        const sec = items[k]
        const list = (sec && sec.items) || []
        return h('div', { key: k },
          h('div', { style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 4 } }, meta.name),
          !sec && h('div', { style: { fontSize: 12, color: '#666' } }, 'loading…'),
          sec && !sec.ok && h('div', { style: { fontSize: 12, color: '#f59e0b' } }, '⚠ ' + (sec.error || 'not available')),
          sec && sec.ok && list.length === 0 && h('div', { style: { fontSize: 12, color: '#666' } }, 'nothing yet'),
          list.map((it) => h('a', {
            key: it.id, href: it.url || '#', target: '_blank', rel: 'noreferrer',
            style: { display: 'block', padding: 10, borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)', background: 'rgba(128,128,128,0.06)' },
          },
            h('div', { style: { fontSize: 13, marginBottom: 4 } }, it[meta.field] || '(no text)'),
            meta.sub(it) && h('div', { style: { fontSize: 11, color: '#888' } }, meta.sub(it))
          ))
        )
      })
    )
  )
}

const fieldStyle = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg, #111)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
}
function platBtn(active) {
  return {
    padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent, #3b82f6)' : 'transparent',
    color: active ? '#fff' : 'var(--text)',
  }
}

export default {
  id: ID,
  register(ctx) {
    return ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Social',
      data: { placement: 'main' },
      render: () => h(SocialPane, { ctx }),
    })
  },
}
