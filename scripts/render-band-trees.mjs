// Lays out the band trees a mod's tests/layout.dump.tsx printed the way the desktop's engine-surface renderer does
// (its Box, Text and Svg style rules, ported from the desktop bundle: docs/desktop-rendering.md), one HTML page per
// theme. Each page measures itself once laid out and leaves the result in <pre id="metrics"> as base64 JSON: per
// case, how far the band overflows its width and which truncating Text runs past one line. Fonts, spacing tokens,
// colors and button chrome are stand-ins: the rules are the desktop's, the numbers are approximate.
//   node render-band-trees.mjs <trees.txt> <out dir> <px per bodyColumn>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [input, out, columnPx] = process.argv.slice(2)
const px = Number(columnPx)
if (!input || !out || !(px > 0)) throw new Error('usage: node render-band-trees.mjs <trees.txt> <out dir> <px per bodyColumn>')
const trees = readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
  const m = /^DUMP:(.+?-(\d+)):(\{.*)$/.exec(line)
  if (!m) throw new Error(`not a DUMP:<case>-<bodyColumns>:<tree> line: ${line.slice(0, 80)}`)
  return { name: m[1], columns: Number(m[2]), tree: JSON.parse(m[3]) }
})

// Runs in the page: draws each tree into a card <columns> * px wide, then measures.
function main(trees, theme) {
  const Q = (k, v) => (v === undefined ? undefined : `${k}:${v}`)
  const sets = {
    align: new Set(['flex-start', 'center', 'flex-end', 'stretch', 'auto']),
    dir: new Set(['row', 'column', 'row-reverse', 'column-reverse']),
    wrap: new Set(['nowrap', 'wrap', 'wrap-reverse']),
    justify: new Set(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']),
  }
  const pick = (e, k, set) => (typeof e[k] === 'string' && set.has(e[k]) ? e[k] : undefined)
  const num = (e, k) => (typeof e[k] === 'number' && Number.isFinite(e[k]) ? e[k] : undefined)
  // A size: a number in the given unit, a percentage as it is.
  const size = (e, k, unit) => {
    const v = e[k]
    return typeof v === 'number' && Number.isFinite(v) ? v + unit : typeof v === 'string' && /^\d+(?:\.\d+)?%$/.test(v) ? v : undefined
  }
  const steps = new Set(['xs', 'sm', 'md', 'lg', 'xl'])
  // A spacing: a step as a token, a number in ch across or in row units down.
  const space = (e, k, axis, kind) => {
    const s = pick(e, k, steps)
    if (s) return `var(--${kind}-${s})`
    const n = num(e, k)
    return n === undefined ? undefined : axis === 'across' ? `${n}ch` : `calc(${n} * var(--engine-row-unit, .5lh))`
  }
  const sides = (e, k) => {
    const at = (suffix, axis) => space(e, k + suffix, axis, k === 'margin' ? 'gap' : 'pad')
    const all = at('', 'down')
    return [
      all === undefined ? undefined : `${k}:${all} ${at('', 'across')}`,
      Q(`${k}-top`, at('Top', 'down') ?? at('Y', 'down')),
      Q(`${k}-bottom`, at('Bottom', 'down') ?? at('Y', 'down')),
      Q(`${k}-left`, at('Left', 'across') ?? at('X', 'across')),
      Q(`${k}-right`, at('Right', 'across') ?? at('X', 'across')),
    ]
  }
  const color = c => (c === undefined ? undefined : /^#|^rgb/.test(c) ? c : theme.colors[c] ?? 'currentColor')
  const box = e => {
    const gap = space(e, 'gap', 'down', 'gap')
    return [
      'display:flex', 'box-sizing:border-box', `flex-direction:${pick(e, 'flexDirection', sets.dir) ?? 'row'}`,
      Q('flex-grow', num(e, 'flexGrow')), Q('flex-shrink', num(e, 'flexShrink')), Q('flex-wrap', pick(e, 'flexWrap', sets.wrap)),
      Q('align-items', pick(e, 'alignItems', sets.align)), Q('align-self', pick(e, 'alignSelf', sets.align)),
      Q('justify-content', pick(e, 'justifyContent', sets.justify)),
      gap === undefined ? undefined : `gap:${gap} ${space(e, 'gap', 'across', 'gap')}`,
      Q('column-gap', space(e, 'columnGap', 'across', 'gap')), Q('row-gap', space(e, 'rowGap', 'down', 'gap')),
      Q('width', size(e, 'width', 'ch')), Q('height', size(e, 'height', 'lh')), Q('min-width', size(e, 'minWidth', 'ch')),
      ...sides(e, 'margin'), ...sides(e, 'padding'),
      e.borderStyle ? 'border:1px solid var(--border);border-radius:10px;padding:12px 16px' : undefined,
      Q('background-color', color(e.backgroundColor)),
    ].filter(Boolean).join(';')
  }
  const text = e => {
    const c = color(e.color)
    const faded = c === undefined ? 'var(--engine-dim-ink, var(--text-secondary))' : `color-mix(in srgb, ${c} 60%, transparent)`
    const weight = e.weight ?? (e.bold === true ? 'semibold' : undefined)
    const wraps = e.wrap === undefined || e.wrap === 'wrap'
    return [
      Q('color', e.dimColor === true ? faded : c),
      c ? `--engine-dim-ink:color-mix(in srgb, ${c} 60%, transparent)` : undefined,
      Q('background-color', color(e.backgroundColor)),
      weight ? `font-weight:${{ regular: 400, medium: 500, semibold: 600, bold: 700 }[weight]}` : undefined,
      e.mono ? 'font-family:Consolas, monospace' : undefined,
      e.tabular ? 'font-variant-numeric:tabular-nums' : undefined,
      ...(wraps ? ['white-space:pre-wrap', 'overflow-wrap:anywhere'] : ['display:inline-block', 'max-width:100%', 'white-space:pre', 'overflow:hidden', 'text-overflow:ellipsis', 'min-width:0']),
    ].filter(Boolean).join(';')
  }
  // An <img>, with the band's text color written onto the svg root.
  const svg = p => {
    const img = document.createElement('img')
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.source.replace(/^<svg /, `<svg color="${theme.inkRgb}" `))}`
    img.alt = p.alt
    img.setAttribute('style', ['display:block', 'max-width:100%', 'border:0', p.width ? `width:${Math.min(p.width, 4096)}px` : '', p.height ? `height:${p.height}px` : ''].filter(Boolean).join(';'))
    return img
  }
  const draw = n => {
    if (n === null || n === undefined || n === false) return null
    if (typeof n === 'string' || typeof n === 'number') return document.createTextNode(String(n))
    const p = n.props ?? {}
    if (n.type === 'Svg') return svg(p)
    if (n.type === 'Button') {
      const b = document.createElement('button')
      b.textContent = p.label
      if (p.dimColor) b.className = 'dim'
      return b
    }
    const el = document.createElement(n.type === 'Text' ? 'span' : 'div')
    el.setAttribute('style', n.type === 'Text' ? text(p) : box(p))
    if (n.type === 'Text' && typeof p.wrap === 'string' && p.wrap.startsWith('truncate')) el.dataset.truncate = ''
    for (const k of n.children ?? []) {
      const c = draw(k)
      if (c) el.appendChild(c)
    }
    return el
  }

  for (const t of trees) {
    const at = document.createElement('div')
    at.className = 'case'
    const label = document.createElement('div')
    label.className = 'label'
    label.textContent = `${t.name} · ${t.columns} 列 · ${Math.round(t.columns * theme.px)}px`
    const card = document.createElement('div')
    card.className = 'card'
    card.dataset.tree = t.name
    card.style.width = `${t.columns * theme.px}px`
    card.appendChild(draw(t.tree))
    at.append(label, card)
    document.body.appendChild(at)
  }

  const cases = [...document.querySelectorAll('[data-tree]')].map(card => ({
    name: card.dataset.tree,
    width: card.clientWidth,
    height: card.clientHeight,
    overflow: Math.max(0, card.scrollWidth - card.clientWidth),
    wrapped: [...card.querySelectorAll('[data-truncate]')]
      .filter(t => t.getBoundingClientRect().height > parseFloat(getComputedStyle(t).lineHeight) * 1.5)
      .map(t => t.textContent),
  }))
  const page = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }
  const bytes = new TextEncoder().encode(JSON.stringify({ page, cases }))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  document.getElementById('metrics').textContent = btoa(binary)
}

const themes = {
  light: { page: '#ffffff', card: '#f3f3f3', ink: '#1f1e1d', inkRgb: 'rgb(31, 30, 29)', secondary: '#73726c', muted: '#999999', button: '#e6e6e4', border: '#cccccc', colors: { error: '#c0392b', warning: '#a86f00', text: '#1f1e1d' } },
  dark: { page: '#1f1e1d', card: '#2b2a28', ink: '#ece9e1', inkRgb: 'rgb(236, 233, 225)', secondary: '#a3a19a', muted: '#777777', button: '#3a3936', border: '#4a4946', colors: { error: '#e5675b', warning: '#d9a43a', text: '#ece9e1' } },
}
// A tree's text sits in JS string literals once embedded; written out, < can not close the script.
const embed = value => JSON.stringify(value).replace(/</g, '\\x3c')
for (const [name, t] of Object.entries(themes)) {
  const html = `<!doctype html><meta charset="utf-8"><style>
:root { --gap-xs: 4px; --gap-sm: 8px; --gap-md: 12px; --gap-lg: 16px; --gap-xl: 24px; --pad-xs: 4px; --pad-sm: 8px; --pad-md: 12px; --pad-lg: 16px; --pad-xl: 24px; }
body { margin: 0; font: 14px/20px "Segoe UI", system-ui, sans-serif; background: ${t.page}; color: ${t.ink}; }
.case { padding: 14px 16px; width: max-content; }
.label { font-size: 11px; color: ${t.muted}; margin: 0 0 4px 4px; }
.card { box-sizing: content-box; background: ${t.card}; border-radius: 12px; padding: 8px 12px; --text-secondary: ${t.secondary}; --border: ${t.border}; }
button { font: inherit; font-size: 13px; display: inline-flex; flex-shrink: 0; align-items: center; height: 26px; padding: 0 10px; border: 0; border-radius: 7px; background: ${t.button}; color: ${t.ink}; white-space: nowrap; }
button.dim { color: ${t.secondary}; }
</style><body><pre id="metrics" hidden></pre>
<script>(${main.toString()})(${embed(trees)}, ${embed({ ...t, px })})</script>`
  const file = join(out, `band-${name}.html`)
  writeFileSync(file, html)
  console.log(file)
}
