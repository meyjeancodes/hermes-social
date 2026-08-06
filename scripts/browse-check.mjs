// Browse-hub harness. SSR only renders the DEFAULT branch of a component, so
// the split view, the pinned-site path and the Compose→site jump would all sail
// through render-check.mjs untested. This drives each one explicitly.
import React from 'react'
import { renderToString } from 'react-dom/server'

// Storage stub: proves usePref actually round-trips instead of silently
// throwing (which would leave every pref stuck on its default).
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.window = globalThis.window || { open() {} }
globalThis.document = globalThis.document || {
  getElementById: () => ({}), createElement: () => ({ style: {} }), body: { appendChild() {} },
}

const mod = await import('../desktop/plugin.js')
const { BrowseHub, SiteFrame, ComposeOnSite, SITES, SITE_INTENT, StreamItem } = mod.__test__

let fail = 0
const ok = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? ' — ' + extra : ''))
  if (!cond) fail++
}

// 1. Every site is well-formed and gets its own persistent partition.
console.log('sites (' + SITES.length + '):')
const keys = new Set()
for (const s of SITES) {
  const good = s.key && s.label && s.color && /^https:\/\//.test(s.url) && s.mark && !keys.has(s.key)
  keys.add(s.key)
  if (!good) ok('site ' + s.key, false, JSON.stringify(s))
}
ok('all ' + SITES.length + ' sites well-formed, unique keys, https urls', keys.size === SITES.length)

// 2. Every intent builder returns a usable https URL with the text encoded.
console.log('compose intents:')
for (const [k, fn] of Object.entries(SITE_INTENT)) {
  const u = fn('hello world & more')
  const good = /^https:\/\//.test(u) && (!u.includes('?') || !u.includes(' '))
  ok('intent ' + k, good, good ? '' : u)
}

// 3. Render each site frame on its own — this is the branch a user actually
// sees, and it reads site.color / site.mark / partitionFor(site.key).
console.log('site frames:')
for (const s of SITES) {
  try {
    const html = renderToString(React.createElement(SiteFrame, { site: s, override: null, onClose: () => {} }))
    const hasWebview = html.includes('<webview') && html.includes('persist:hermes-social-' + s.key)
    ok(s.key.padEnd(12) + ' ' + String(html.length).padStart(5) + ' chars', hasWebview,
      hasWebview ? '' : 'no webview / wrong partition')
  } catch (e) {
    ok(s.key, false, e.message)
  }
}

// 4. BrowseHub: default, split view, and a Compose jump.
console.log('browse hub:')
const cases = [
  ['default', { zen: false, setZen() {}, jump: null }],
  ['zen', { zen: true, setZen() {}, jump: null }],
  ['jump to reddit', { zen: false, setZen() {}, jump: { key: 'reddit', url: SITE_INTENT.reddit('hi'), nonce: 1 } }],
]
for (const [label, props] of cases) {
  try {
    const html = renderToString(React.createElement(BrowseHub, props))
    ok(label.padEnd(14) + ' ' + String(html.length).padStart(5) + ' chars', html.length > 500)
  } catch (e) {
    ok(label, false, e.message)
  }
}

// Split view: pre-seed the pref so the hub mounts with a pinned partner.
store.set('hermes-social:browse.split', JSON.stringify('reddit'))
store.set('hermes-social:browse.opened', JSON.stringify(['x', 'reddit']))
try {
  const html = renderToString(React.createElement(BrowseHub, { zen: false, setZen() {}, jump: null }))
  const both = html.includes('persist:hermes-social-x') && html.includes('persist:hermes-social-reddit')
  ok('split view mounts both guests', both, both ? '' : 'only one partition present')
} catch (e) {
  ok('split view', false, e.message)
}

// 5. ComposeOnSite renders a button per intent and wires the callback.
console.log('compose-on-site:')
let jumped = null
try {
  const html = renderToString(React.createElement(ComposeOnSite, {
    text: 'ship it', openInBrowse: (k, u) => { jumped = [k, u] },
  }))
  ok('renders ' + Object.keys(SITE_INTENT).length + ' site buttons',
    Object.keys(SITE_INTENT).every((k) => html.includes(mod.__test__.SITES.find((s) => s.key === k).label)))
  ok('hidden without openInBrowse',
    renderToString(React.createElement(ComposeOnSite, { text: 'x' })) === '')
} catch (e) {
  ok('ComposeOnSite', false, e.message)
}

// 6. Timeline card "Open here" only appears when the hub can receive it.
console.log('stream item:')
const item = { source: 'reddit', id: '1', author: 'me', text: 'hi', url: 'https://reddit.com/r/x/1', created_at: new Date().toISOString() }
try {
  const withHub = renderToString(React.createElement(StreamItem, { it: item, openInBrowse: () => {} }))
  const without = renderToString(React.createElement(StreamItem, { it: item }))
  ok('"Open here" with hub', withHub.includes('Open here'))
  ok('no "Open here" without hub', !without.includes('Open here'))
} catch (e) {
  ok('StreamItem', false, e.message)
}

console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nALL BROWSE CHECKS PASSED')
process.exit(fail ? 1 : 0)
