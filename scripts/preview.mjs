// Renders the live timeline to a standalone HTML file for visual inspection.
import React from 'react'
import { renderToString } from 'react-dom/server'

globalThis.window = globalThis.window || {}
globalThis.document = globalThis.document || {
  getElementById: () => ({}), createElement: () => ({ style: {} }), body: { appendChild() {} },
}

const data = await (await fetch('http://127.0.0.1:8731/timeline?per=6&limit=24')).json()
const mod = await import('../desktop/plugin.js')
const { StreamItem } = mod.__test__

// one interesting item per embed type first, then the rest
const seen = new Set()
const featured = []
for (const key of ['video', 'images', 'quote', 'link']) {
  const it = (data.items || []).find((i) => i[key] && !seen.has(i.id) && (key !== 'images' || i.images.length))
  if (it) { featured.push(it); seen.add(it.id) }
}
for (const it of data.items || []) if (!seen.has(it.id) && featured.length < 12) { featured.push(it); seen.add(it.id) }

const cards = featured.map((it) => renderToString(React.createElement(StreamItem, { it }))).join('\n')
const html = `<!doctype html><meta charset="utf-8"><title>Hermes Social — cards</title>
<style>
  :root{--text:#e7e9ee;--border:#242832;--ui-stroke-secondary:#242832;--ui-text-tertiary:#8b93a7;--ui-text-primary:#e7e9ee;--accent:#3b82f6;
        --dt-font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
  body{margin:0;background:#0b0d12;color:var(--text);font-family:system-ui,sans-serif;padding:20px;max-width:660px}
  .hdr{display:flex;align-items:center;gap:10px;padding:10px 12px 8px;border-bottom:1px solid var(--ui-stroke-secondary);margin-bottom:14px}
  .hdr b{font-family:var(--dt-font-mono);font-size:.72rem;letter-spacing:.34em;text-transform:uppercase}
  .hdr span{font-family:var(--dt-font-mono);font-size:.72rem;letter-spacing:.34em;text-transform:uppercase;color:var(--ui-text-tertiary);font-weight:400}
  .stack{display:flex;flex-direction:column;gap:8px}
</style>
<div class="hdr"><b>Hermes</b><span>⁄ Social</span></div>
<div class="stack">${cards}</div>`

const out = '/tmp/hermes-social-cards.html'
await (await import('node:fs/promises')).writeFile(out, html)
console.log(out)
