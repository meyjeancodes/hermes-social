// Render harness: deeply renders the plugin pane with a stubbed SDK + fetch
// against the LIVE local backend, so TDZ/hook errors that `node --check`
// misses actually throw here.
import React from 'react'
import { renderToString } from 'react-dom/server'

globalThis.window = globalThis.window || { twttr: null }
globalThis.document = globalThis.document || {
  getElementById: () => ({}), createElement: () => ({ style: {} }), body: { appendChild() {} },
}

const mod = await import('../desktop/plugin.js')
const plugin = mod.default
let pane = null
plugin.register({ register: (c) => { pane = c; return c } })
if (!pane) throw new Error('register() did not yield a contribution')
console.log('contribution:', pane.id, pane.area, JSON.stringify(pane.data))

// Sources folded into Settings, so the top-level tab is gone.
const tabs = ['Timeline', 'Inbox', 'Feeds', 'Compose', 'Mass Post', 'Settings']
const html = renderToString(pane.render())
for (const t of tabs) {
  if (!html.includes(t)) throw new Error('tab missing from render: ' + t)
}
console.log('rendered ' + html.length + ' chars; all ' + tabs.length + ' tabs present')

// Every colour must come from a Hermes design token. --bg/--text/--border/
// --accent are defined nowhere in the app's CSS, so any use of them silently
// renders as a hardcoded fallback — that was the black-box bug.
const pluginSrc = await (await import('node:fs/promises')).readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const dead = ['var(--text)', 'var(--bg,', 'var(--bg)', 'var(--border)', 'var(--accent']
for (const t of dead) {
  const n = pluginSrc.split(t).length - 1
  if (n) throw new Error(`${n} use(s) of undefined token ${t} — will render as a black box`)
}
// --ui-bg-* are color-mix chrome fills. Painting them inside a plugin pane
// washes the whole surface grey instead of letting the host background show
// through; the shipped Entertainment pack uses zero of them for this reason.
const bgUses = pluginSrc.split('--ui-bg-').length - 1
if (bgUses) throw new Error(`${bgUses} use(s) of --ui-bg-* — these grey out the pane; use a translucent rgba overlay instead`)
console.log('no undefined design tokens, no --ui-bg-* pane fills')

// Force every tab to actually execute: stub useState so the pane's first
// useState (the tab) returns each tab key in turn. Catches TDZ/hook errors in
// Timeline / Inbox / Settings that the default view would never hit.
const realUseState = React.useState
for (const key of ['timeline', 'inbox', 'feeds', 'compose', 'mass', 'settings']) {
  let first = true
  React.useState = function (init) {
    if (first) { first = false; return realUseState(key) }
    return realUseState(init)
  }
  try {
    const out = renderToString(pane.render())
    console.log('  ' + key.padEnd(9) + ' → ' + out.length + ' chars')
  } finally {
    React.useState = realUseState
  }
}

console.log('OK')
