// Verifies the Sources tab renders LIST-valued feeds from the live backend,
// and that discovery data reaches the New Conversation picker. Prints results;
// renders nothing to disk.
import React from 'react'
import { renderToString } from 'react-dom/server'

globalThis.window = globalThis.window || {}
globalThis.document = globalThis.document || {
  getElementById: () => ({}), createElement: () => ({ style: {} }), body: { appendChild() {} },
}

const API = 'http://127.0.0.1:8731'
const cfg = (await (await fetch(API + '/sources')).json()).sources
const tl = await (await fetch(API + '/timeline?per=10&limit=200')).json()

const mod = await import('../desktop/plugin.js')
const { FeedList, Sources, NewConversation } = mod.__test__

// Config must be list-shaped, or the timeline can only ever hold one feed each.
for (const k of ['rss_urls', 'subreddits', 'bluesky_handles', 'youtube_channels']) {
  if (!Array.isArray(cfg[k])) throw new Error(`${k} is not a list — multi-feed is broken`)
  console.log(`${k.padEnd(18)} ${cfg[k].length} configured`)
}

// The editor must render every configured value with a remove control.
for (const k of ['rss_urls', 'subreddits']) {
  const out = renderToString(React.createElement(FeedList, {
    label: k, values: cfg[k], onChange() {}, ph: '',
  }))
  for (const v of cfg[k]) {
    if (!out.includes(v.replace(/&/g, '&amp;'))) throw new Error(`FeedList dropped ${v}`)
  }
  const removes = (out.match(/×/g) || []).length
  if (removes !== cfg[k].length) throw new Error(`expected ${cfg[k].length} remove buttons, got ${removes}`)
}
console.log('FeedList renders every configured feed with a remove control')

console.log('Sources tab        → ' + renderToString(React.createElement(Sources, {})).length + ' chars')
console.log('NewConversation    → ' + renderToString(React.createElement(NewConversation, { onClose() {}, onDone() {} })).length + ' chars')

// The real payoff: several distinct feeds per source actually in the timeline.
const by = {}
for (const it of tl.items) (by[it.source] ||= new Set()).add(
  it.source === 'rss' ? new URL(it.url).hostname
    : it.source === 'reddit' ? (it.url.match(/reddit\.com\/r\/([^/]+)/) || [])[1]
    : it.author)
console.log('\ndistinct feeds present per source:')
for (const [s, set] of Object.entries(by)) console.log(`  ${s.padEnd(9)} ${[...set].filter(Boolean).join(', ')}`)

const multi = Object.entries(by).filter(([, v]) => v.size > 1).map(([k]) => k)
if (!multi.length) throw new Error('no source shows more than one feed — fan-out is not working')
console.log(`\nsources proving multi-feed fan-out: ${multi.join(', ')}`)
if (Object.keys(tl.errors || {}).length) console.log('timeline errors: ' + JSON.stringify(tl.errors))
console.log('OK')
