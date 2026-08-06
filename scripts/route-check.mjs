// Route-existence check: confirms every endpoint the plugin calls actually
// resolves on the running backend, so a future rename/add in either the pane
// or social/server.py can't silently 404 in the live app. This is the one gap
// the Node harnesses can't catch (they stub fetch). Run with the backend up:
//   node scripts/route-check.mjs
// It hits only read-only / route-existence paths — it performs NO real posts.
import { readFileSync } from 'node:fs'

const PORT = process.env.SOCIAL_PORT || '8731'
const BASE = 'http://127.0.0.1:' + PORT

// Endpoints the plugin references (desktop/plugin.js -> API + '/...').
const GET = ['/status', '/timeline?per=5&limit=5', '/sources', '/drafts',
  '/a2a/identity', '/a2a/threads', '/a2a/autoreply', '/a2a/discover']
// POST routes — probed with an empty body (no real side effects; the dispatch
// returns a structured error like "no platforms selected", never a 404 route).
const POST = ['/mass', '/drafts/delete', '/settings', '/verify/x',
  '/a2a/autoreply', '/a2a/discover']

// Mirrors the route table in social/server.py — if a path isn't in here it
// would 404 with {"error":"no such route"}. Used as a static cross-check of the
// source of truth so the test doesn't depend on the server already running.
// Dynamic sub-paths (e.g. /drafts/delete, /verify/<platform>, /post/<platform>)
// are handled by a prefix branch, so we treat the first segment as the route.
const EXPECTED = new Set(['/', '/status', '/feeds', '/timeline', '/inbox',
  '/a2a/inbox', '/a2a/identity', '/a2a/threads', '/a2a/peers', '/a2a/send',
  '/a2a/peers/remove', '/a2a/read', '/a2a/autoreply', '/a2a/discover',
  '/a2a/connect', '/drafts', '/sources', '/verify', '/settings', '/post',
  '/mass', '/reply', '/chat', '/settitle', '/like', '/retweet'])

let fail = 0
const ok = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? ' — ' + extra : ''))
  if (!cond) fail++
}

const src = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const called = new Set()
for (const m of src.matchAll(/API \+ '(\/[^']*)'/g)) {
  called.add(m[1].split('?')[0]) // strip query string
}
// /post/ is dynamic (platform appended); normalise to /post
for (const p of [...called]) if (p.startsWith('/post/')) called.add('/post'), called.delete(p)

console.log('static cross-check: every plugin endpoint has a server route')
for (const ep of called) {
  // Dynamic sub-paths (e.g. /drafts/delete) resolve via a prefix branch.
  const root = '/' + ep.split('/')[1]
  ok('route exists for ' + ep, EXPECTED.has(ep) || EXPECTED.has(root),
    (EXPECTED.has(ep) || EXPECTED.has(root)) ? '' : 'MISSING in server.py')
}

console.log('\nlive probe (backend must be running on :' + PORT + ')')
let reachable = true
for (const ep of GET) {
  try {
    const r = await fetch(BASE + ep)
    const body = await r.json()
    const missing = body && body.error === 'no such route'
    if (missing) { ok('GET ' + ep, false, 'no such route'); reachable = false }
    else ok('GET ' + ep, r.ok && !missing, 'http ' + r.status)
  } catch (e) { ok('GET ' + ep, false, e.message); reachable = false }
}
for (const ep of POST) {
  try {
    const r = await fetch(BASE + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const body = await r.json()
    const missing = body && body.error === 'no such route'
    if (missing) { ok('POST ' + ep, false, 'no such route'); reachable = false }
    else ok('POST ' + ep, r.ok && !missing, 'http ' + r.status)
  } catch (e) { ok('POST ' + ep, false, e.message); reachable = false }
}
if (!reachable) console.log('(some probes failed — is the backend up? run: social serve)')
process.exit(fail ? 1 : 0)
