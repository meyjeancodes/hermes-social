// Theme harness. Renders the whole pane in BOTH modes and asserts the thing
// that actually matters: every colour we ship clears WCAG contrast against the
// surface it sits on. A render test alone would happily pass white-on-white.
import React from 'react'
import { renderToString } from 'react-dom/server'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

// Minimal DOM so readMode()/useThemeVars() can run. `mode` is swapped per pass.
let MODE = 'dark'
const head = { children: [], appendChild(el) { this.children.push(el) } }
globalThis.document = {
  get documentElement() {
    return {
      dataset: { hermesMode: MODE },
      classList: { contains: (c) => (c === 'dark' ? MODE === 'dark' : false), toggle() {} },
      style: { setProperty() {} },
    }
  },
  head,
  getElementById: (id) => head.children.find((e) => e.id === id) || null,
  createElement: () => ({ id: '', textContent: '', style: {} }),
}
globalThis.window = { open() {}, addEventListener() {}, removeEventListener() {}, matchMedia: null }
globalThis.MutationObserver = class { observe() {} disconnect() {} }

const mod = await import('../desktop/plugin.js')
const T = mod.__test__
const { SITES, LIGHT_INK, OK_C, ERR_C, WARN_C, inkFor, readMode, THEME_CSS,
        SRC_COLOR, SRC_COLOR_LIGHT, srcColor, SocialPane, BrowseHub, Radar } = T

let fail = 0
const ok = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? ' — ' + extra : ''))
  if (!cond) fail++
}

// ── contrast math (WCAG 2.1 relative luminance) ──────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const L = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * (n & 255 ? lin(n & 255) : lin(0))
}
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const ratio = (a, b) => {
  const la = lum(a), lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
// Surfaces the plugin actually paints on, taken from the app's own neutrals.
const SURFACE = { light: '#ffffff', dark: '#0d0d0e' }
// 3.0:1 is WCAG AA for large text / UI components; these are 700-weight mono
// marks and 1px borders, i.e. non-body UI.
const MIN = 3.0

// ── 1. brand marks in both modes ─────────────────────────────────────────────
console.log('brand marks — contrast vs surface (min ' + MIN + ':1):')
for (const mode of ['dark', 'light']) {
  const bg = SURFACE[mode]
  const bad = []
  for (const s of SITES) {
    const c = inkFor(s, mode === 'light')
    const r = ratio(c, bg)
    if (r < MIN) bad.push(`${s.key} ${c} ${r.toFixed(2)}:1`)
  }
  ok(mode.padEnd(5) + ' all ' + SITES.length + ' site marks', bad.length === 0, bad.join(', '))
}

// ── 2. status colours in both modes ──────────────────────────────────────────
console.log('status colours:')
for (const [name, pair] of [['ok', OK_C], ['err', ERR_C], ['warn', WARN_C]]) {
  for (const mode of ['dark', 'light']) {
    const r = ratio(pair[mode], SURFACE[mode])
    ok(`${name}/${mode.padEnd(5)} ${pair[mode]} ${r.toFixed(2)}:1`, r >= MIN)
  }
}

// ── 3. timeline source dots ──────────────────────────────────────────────────
console.log('timeline source colours:')
for (const mode of ['dark', 'light']) {
  const bad = []
  for (const k of Object.keys(SRC_COLOR)) {
    const c = srcColor(k, mode === 'light')
    if (!c.startsWith('#')) continue
    const r = ratio(c, SURFACE[mode])
    if (r < MIN) bad.push(`${k} ${c} ${r.toFixed(2)}:1`)
  }
  ok(mode.padEnd(5) + ' all source chips', bad.length === 0, bad.join(', '))
}

// ── 4. the CSS var block defines every var in both modes ─────────────────────
console.log('css variable blocks:')
const darkBlock = THEME_CSS.slice(THEME_CSS.indexOf('[data-hs-mode] {'), THEME_CSS.indexOf('[data-hs-mode="light"]'))
const lightBlock = THEME_CSS.slice(THEME_CSS.indexOf('[data-hs-mode="light"]'))
const names = (b) => [...b.matchAll(/(--hs-[a-z-]+):/g)].map((m) => m[1]).sort()
const dn = names(darkBlock), ln = names(lightBlock)
ok('dark defines ' + dn.length + ' vars', dn.length > 0)
ok('light overrides every dark var', JSON.stringify(dn) === JSON.stringify(ln),
  'missing in light: ' + dn.filter((n) => !ln.includes(n)).join(', '))
ok('css braces balanced',
  (THEME_CSS.match(/{/g) || []).length === (THEME_CSS.match(/}/g) || []).length)

// ── 5. readMode reflects the DOM, and the pane renders in both modes ─────────
console.log('mode detection + render:')
for (const mode of ['dark', 'light']) {
  MODE = mode
  ok(mode.padEnd(5) + ' readMode()', readMode() === mode, 'got ' + readMode())
  try {
    const html = renderToString(React.createElement(SocialPane))
    ok(mode.padEnd(5) + ' SocialPane ' + String(html.length).padStart(6) + ' chars',
      html.includes('data-hs-mode="' + mode + '"'), 'root missing data-hs-mode')
  } catch (e) {
    ok(mode + ' SocialPane', false, e.message)
  }
}

// ── 6. no raw dark-only literals survive in rendered light output ────────────
console.log('leak check (light mode must not emit dark-only literals):')
MODE = 'light'
const lightHtml = renderToString(React.createElement(SocialPane)) +
  renderToString(React.createElement(BrowseHub, { zen: false, setZen() {}, jump: null })) +
  renderToString(React.createElement(Radar))
const leaks = ['#22c55e', '#f87171', '#f59e0b', 'rgba(127,127,127', '#e5e7eb']
for (const lit of leaks) {
  const n = (lightHtml.match(new RegExp(lit.replace(/[()#]/g, '\\$&'), 'g')) || []).length
  ok('no ' + lit, n === 0, n + ' occurrence(s)')
}

console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nALL THEME CHECKS PASSED')
process.exit(fail ? 1 : 0)
