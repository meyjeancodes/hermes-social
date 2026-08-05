// Renders StreamItem against REAL live backend items — one per source, and
// specifically the ones carrying images / link cards / quotes / video, so the
// embed code paths actually execute instead of being skipped by empty SSR data.
import React from 'react'
import { renderToString } from 'react-dom/server'

globalThis.window = globalThis.window || {}
globalThis.document = globalThis.document || {
  getElementById: () => ({}), createElement: () => ({ style: {} }), body: { appendChild() {} },
}

const res = await fetch('http://127.0.0.1:8731/timeline?per=15&limit=90')
const data = await res.json()
const items = data.items || []
if (!items.length) throw new Error('backend returned no items — is `social serve` running?')

const mod = await import('../desktop/plugin.js')
const StreamItem = mod.__test__ && mod.__test__.StreamItem
if (!StreamItem) throw new Error('plugin.js does not export __test__.StreamItem')

const pick = (pred, label) => {
  const it = items.find(pred)
  if (!it) return console.log('  (none) ' + label)
  const out = renderToString(React.createElement(StreamItem, { it }))
  console.log('  ' + label.padEnd(16) + it.source.padEnd(10) + out.length + ' chars')
  return out
}

console.log('rendering ' + items.length + ' live items, one per embed type:')
const withImages = pick((i) => (i.images || []).length > 0, 'images')
const withLink = pick((i) => i.link, 'link card')
const withQuote = pick((i) => i.quote, 'quote post')
const withVideo = pick((i) => i.video && i.video.youtube_id, 'youtube')
pick((i) => i.avatar, 'avatar')
pick((i) => !i.avatar, 'no avatar')

if (withImages && !/<img/.test(withImages)) throw new Error('image item rendered no <img>')
if (withLink && !/href=/.test(withLink)) throw new Error('link card rendered no href')
if (withVideo && !/▶/.test(withVideo)) throw new Error('youtube item rendered no play button')

// every item must render without throwing
let total = 0
for (const it of items) total += renderToString(React.createElement(StreamItem, { it })).length
console.log('all ' + items.length + ' items rendered, ' + total + ' chars total')
console.log('OK')
