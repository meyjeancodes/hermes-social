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

const tabs = ['Timeline', 'Inbox', 'Feeds', 'Compose', 'Mass Post', 'Sources', 'Settings']
const html = renderToString(pane.render())
for (const t of tabs) {
  if (!html.includes(t)) throw new Error('tab missing from render: ' + t)
}
console.log('rendered ' + html.length + ' chars; all ' + tabs.length + ' tabs present')

// Force every tab to actually execute: stub useState so the pane's first
// useState (the tab) returns each tab key in turn. Catches TDZ/hook errors in
// Timeline / Inbox / Sources that the default view would never hit.
const realUseState = React.useState
for (const key of ['timeline', 'inbox', 'feeds', 'compose', 'mass', 'sources', 'settings']) {
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
