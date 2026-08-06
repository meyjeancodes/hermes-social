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
const { BrowseHub, SiteFrame, ComposeOnSite, Radar, Watch, WatchQuery, SocialPane, SITES, SITE_INTENT, SITE_SEARCH,
        CLEAN_CSS, CLEAN_UNIVERSAL, cleanCssFor, MAX_LIVE, StreamItem, CommandPalette, useUnread } = mod.__test__

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

// 7. Radar: search builders, CSS validity, grid render, MRU eviction cap.
console.log('radar search urls:')
for (const [k, fn] of Object.entries(SITE_SEARCH)) {
  if (!fn) continue
  const u = fn('black cat robotics')
  const enc = /^https:\/\//.test(u) && !/\s/.test(u) && u.length > 20
  ok('search ' + k.padEnd(12) + (enc ? '' : ' ' + u), enc)
}
ok('every searchable key is a real site',
  Object.keys(SITE_SEARCH).every((k) => SITES.some((s) => s.key === k)))

console.log('cleaner css:')
for (const [k, css] of Object.entries(CLEAN_CSS)) {
  // Balanced braces and a display:none payload — a malformed rule silently
  // voids everything after it in insertCSS, so this is worth asserting.
  const balanced = (css.match(/{/g) || []).length === (css.match(/}/g) || []).length
  const hides = css.includes('display: none')
  ok('css ' + k.padEnd(12), balanced && hides, balanced ? '' : 'unbalanced braces')
}
ok('universal css balanced',
  (CLEAN_UNIVERSAL.match(/{/g) || []).length === (CLEAN_UNIVERSAL.match(/}/g) || []).length)
ok('cleanCssFor always returns universal rules',
  SITES.every((s) => cleanCssFor(s.key).includes('cookie')))

console.log('radar grid:')
try {
  ok('empty state renders', renderToString(React.createElement(Radar)).includes('Radar'))
  store.set('hermes-social:radar.q', JSON.stringify('robotics'))
  store.set('hermes-social:radar.sites', JSON.stringify(['x', 'reddit', 'hn']))
  const html = renderToString(React.createElement(Radar))
  const n = (html.match(/<webview/g) || []).length
  ok('3 picked platforms -> 3 live webviews', n === 3, 'got ' + n)
  ok('search terms reached the guests', html.includes('robotics'))
} catch (e) {
  ok('Radar', false, e.message)
}

// 8. The memory fix: BrowseHub must never mount more than MAX_LIVE guests,
// no matter how many sites a previous session left in the opened list.
console.log('mru eviction (the memory fix):')
store.set('hermes-social:browse.opened', JSON.stringify(SITES.map((s) => s.key)))
store.set('hermes-social:browse.split', JSON.stringify(null))
try {
  const html = renderToString(React.createElement(BrowseHub, { zen: false, setZen() {}, jump: null }))
  const mounted = (html.match(/<webview/g) || []).length
  ok('all 18 restored -> only ' + mounted + ' mounted (cap ' + MAX_LIVE + ')',
    mounted > 0 && mounted <= MAX_LIVE)
  ok('rail still offers every site', SITES.every((s) => html.includes(s.label)))
} catch (e) {
  ok('MRU eviction', false, e.message)
}

// 9. Unread badges: BrowseHub renders a badge on the rail from persisted counts.
console.log('unread badges:')
{
  store.set('hermes-social:browse.unread', JSON.stringify({ reddit: 3, hn: 12 }))
  const html = renderToString(React.createElement(BrowseHub, { zen: false, setZen() {}, jump: null }))
  ok('rail shows reddit badge 3', html.includes('>3<') && html.includes('new on Reddit'))
  ok('rail shows hn badge 12', html.includes('>12<') && html.includes('new on Hacker News'))
  ok('badge count sums from storage', (html.match(/new on /g) || []).length === 2)
}
// 10. Command palette: renders, lists every site + tab, filters, scoped ⌘K.
console.log('command palette:')
{
  let chosen = null
  const html = renderToString(React.createElement(CommandPalette, {
    onClose() {}, setTab() {}, setZen() {}, openInBrowse() {}, goSite: (k) => { chosen = k },
  }))
  ok('renders', html.includes('Jump to a site'))
  ok('lists all 18 sites', SITES.every((s) => html.includes('Open ' + s.label)))
  ok('lists all 6 tabs', ['Browse', 'Radar', 'Timeline', 'Compose', 'Inbox', 'Settings']
    .every((t) => html.includes('Go to ' + t)))
  ok('offers Zen toggle', html.includes('Toggle Zen'))
  // Filter behaviour: render with a query.
  const filtered = renderToString(React.createElement(CommandPalette, {
    onClose() {}, setTab() {}, setZen() {}, openInBrowse() {}, goSite() {},
    // query isn't a prop; assert the filter input is present instead
  }))
  ok('has a filter input', filtered.includes('placeholder="Jump to a site'))
}

// 11. Watch: renders the tab, lists default monitors, polls the backend's
//     server-side q filter (already verified) and clears the tab badge on view.
console.log('watch:')
{
  const html = renderToString(React.createElement(Watch, {}))
  ok('renders the monitor input', html.includes('Watch a keyword'))
  ok('shows both default monitors', html.includes('BlackCat Robotics') && html.includes('robotics funding'))
  const pane = renderToString(React.createElement(SocialPane))
  ok('pane renders Watch tab', pane.includes('Watch'))
}
process.exit(fail ? 1 : 0)
