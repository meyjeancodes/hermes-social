// Renders the messaging UI against REAL a2a data from the running agent.
// SSR skips effects, so Messages() alone renders empty — instead we drive the
// presentational components with live thread data to prove they handle it.
import React from 'react'
import { renderToString } from 'react-dom/server'

globalThis.window = globalThis.window || {}
globalThis.document = globalThis.document || {
  getElementById: () => ({}), createElement: () => ({ style: {} }), body: { appendChild() {} },
}

const API = 'http://127.0.0.1:8731'
const id = await (await fetch(API + '/a2a/identity')).json()
const th = await (await fetch(API + '/a2a/threads')).json()
console.log('identity: ' + id.address + '  (' + id.name + ')')
console.log('threads: ' + (th.threads || []).length + ', unread ' + th.unread)

const mod = await import('../desktop/plugin.js')
const { Bubble, NewConversation, Messages, Inbox, AutoReply } = mod.__test__
for (const [n, C] of [['Bubble', Bubble], ['NewConversation', NewConversation], ['Messages', Messages], ['Inbox', Inbox], ['AutoReply', AutoReply]]) {
  if (!C) throw new Error('plugin.js does not export __test__.' + n)
}

// Shell components must render without live data.
console.log('Inbox shell        → ' + renderToString(React.createElement(Inbox, {})).length + ' chars')
console.log('Messages shell     → ' + renderToString(React.createElement(Messages, {})).length + ' chars')
console.log('NewConversation    → ' + renderToString(React.createElement(NewConversation, { onClose() {}, onDone() {} })).length + ' chars')

// Bubbles must render real messages, both directions, and show the signed mark.
const msgs = (th.threads || []).flatMap((t) => t.messages)
if (!msgs.length) throw new Error('no a2a messages to render — run scripts/a2a_test.py first')
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]))
let sawIn = false, sawOut = false
for (const m of msgs) {
  const out = renderToString(React.createElement(Bubble, { m }))
  if (!out.includes(esc(m.body.slice(0, 20))))
    throw new Error('bubble did not render its body: ' + m.body)
  if (m.dir === 'in') { sawIn = true; if (!out.includes('signed')) throw new Error('inbound bubble missing signed marker') }
  if (m.dir === 'out') sawOut = true
}
// An auto-reply must be visibly labelled as machine-generated.
const auto = msgs.find((m) => m.auto)
if (auto && !renderToString(React.createElement(Bubble, { m: auto })).includes('auto'))
  throw new Error('auto-reply bubble is not labelled auto')
console.log('auto-reply bubbles labelled: ' + (auto ? 'yes' : 'none present'))
console.log('rendered ' + msgs.length + ' real message bubbles (in=' + sawIn + ' out=' + sawOut + ')')

// Timestamps must not render blank — ago() has to accept epoch seconds.
const stamp = renderToString(React.createElement(Bubble, { m: { ...msgs[0], ts: Date.now() / 1000 - 90 } }))
if (!/1m|90s/.test(stamp)) throw new Error('ago() rendered no relative time for an epoch ts')
console.log('epoch timestamps render correctly')
console.log('OK')
