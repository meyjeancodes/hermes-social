// Render harness: deeply renders the plugin pane with a stubbed SDK + fetch
// against the LIVE local backend, so TDZ/hook errors that `node --check`
// misses actually throw here.
import React from 'react'
import { renderToString } from 'react-dom/server'
const h = React.createElement

globalThis.window = globalThis.window || { twttr: null }
globalThis.document = globalThis.document || {
  getElementById: () => ({}), createElement: () => ({ style: {} }), body: { appendChild() {} },
}

const mod = await import('../desktop/plugin.js')
const plugin = mod.default
// Capture ALL contributions (register() may call ctx.registerMany with several).
const contribs = []
const fakeCtx = {
  register: (c) => { contribs.push(c); return c },
  registerMany: (cs) => { cs.forEach((c) => contribs.push(c)); return cs },
}
plugin.register(fakeCtx)
if (!contribs.length) throw new Error('register() yielded no contributions')
const byArea = (a) => contribs.filter((c) => c.area === a)
const pane = contribs.find((c) => c.area === 'routes')
console.log('contributions:', contribs.map((c) => c.area + ':' + c.id).join(', '))
// Nav + route + native palette entry + global keybind must all be registered.
if (!byArea('sidebar.nav').length) throw new Error('missing sidebar.nav contribution')
if (!byArea('routes').length) throw new Error('missing routes contribution')
const pal = byArea('palette')[0]
if (!pal || !pal.data || typeof pal.data.run !== 'function') throw new Error('missing palette contribution with run()')
const kb = byArea('keybinds')[0]
if (!kb || !kb.data || typeof kb.data.run !== 'function') throw new Error('missing keybinds contribution with run()')
if (!kb.data.defaults || !kb.data.defaults.includes('mod+shift+s')) throw new Error('keybind missing mod+shift+s default')
console.log('registered sidebar.nav + routes + palette(Open Social) + keybinds(⌘⇧S)')

// Sources folded into Settings; Browse (live sites) is now the default tab.
const tabs = ['Browse', 'Radar', 'Timeline', 'Inbox', 'Compose', 'Mass Post', 'Settings']
const html = renderToString(pane.render())
for (const t of tabs) {
  if (!html.includes(t)) throw new Error('tab missing from render: ' + t)
}
// ComposePreview must render and reflect real per-platform limits (no guessing).
const { ComposePreview, PLAT_LIMITS } = mod.__test__
const previewHtml = renderToString(h(ComposePreview, { platforms: ['x', 'instagram'], text: 'hello world', media: 'image' }))
if (!previewHtml.includes('X') || !previewHtml.includes('Instagram')) throw new Error('ComposePreview did not render per-platform rows')
if (!previewHtml.includes('280')) throw new Error('ComposePreview missing X char limit (280)')
if (PLAT_LIMITS.x.limit !== 280 || PLAT_LIMITS.instagram.limit !== 2200) throw new Error('PLAT_LIMITS wrong')
console.log('ComposePreview renders with real per-platform limits (X 280, IG 2200)')

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
// body washes the whole surface grey instead of letting the host background
// show through; the shipped Entertainment pack uses zero of them for this
// reason. The two exceptions below are scoped to the command-palette POPOVER
// (an elevated floating surface that legitimately needs its own fill), never
// the pane body — so they're allowed.
const bgUses = pluginSrc.split('--ui-bg-').length - 1
const bgOk = (pluginSrc.match(/--ui-bg-elevated/g) || []).length // popover only
if (bgUses - bgOk) throw new Error(`${(bgUses - bgOk)} use(s) of --ui-bg-* (non-elevated) — these grey out the pane; use a translucent rgba overlay instead`)
console.log('no undefined design tokens, no --ui-bg-* pane fills')

// Force every tab to actually execute: stub useState so the pane's first
// useState (the tab) returns each tab key in turn. Catches TDZ/hook errors in
// Timeline / Inbox / Settings that the default view would never hit.
const realUseState = React.useState
for (const key of ['browse', 'radar', 'timeline', 'watch', 'inbox', 'compose', 'mass', 'settings']) {
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
