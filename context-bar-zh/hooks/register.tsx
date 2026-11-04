// Context Bar (zh): what is filling my context window?
//   Local Simplified Chinese adaptation of hamzafer/claude-code-mods context-bar 0.1.5, Copyright (c) 2026
//   Hamza Zafar, MIT License (see LICENSE and SOURCE.md).
//   Above the prompt, collapsed by default to two rows: the totals, where auto-compaction runs and the
//   share used, with an expand button; under them the window as one stacked bar. The terminal draws the bar
//   in cells, a color per category as /context draws them, and expanded, a bordered box with a title and a
//   legend. A graphical surface (desktop, VS Code, phone) draws it as a thin vector bar across the band: what
//   every turn carries in a neutral tone, the conversation in the accent, a tick where auto-compaction runs;
//   expanded, a legend of those parts and the rows inside them. It refreshes after each turn and a /clear.
//   /context-bar shows or hides it, and the choice is kept across sessions; the expanded view lasts for the
//   session, so every new session starts collapsed. Each surface's first draw notes in the plugin's store
//   (`loads`) which copy of the plugin the session loaded, and its version.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading, Slice } from '../types'
import { bandsFile, parseOrder, stackBands } from './bands'

const BAND = 'context-bar-zh' // the band's name in the band order file
const MIN_WIDTH = 20 // narrower than this, the bar is not drawn
const LOADS = 20 // the loads the store keeps
const SPLIT = '   '
// /context's theme gives several rows the same grey, so each used row gets its own color, in order.
const PALETTE = ['#7aa2f7', '#7dcfff', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#73daca', '#ff9e64', '#c0caf5']
const MESSAGES = '#d97757' // the row that grows, in the accent color
const FREE = '#808080' // a mid grey thin line reads as empty on dark and light themes alike
const BUFFER = '#808080'
const GLYPH = { used: '█', free: '─', buffer: '░' } as const
// The graphical bar's parts. It is an image, so the theme reaches it only as currentColor, the text ink the
// desktop sets on it: the neutral parts are that ink at an opacity, which reads on light and dark alike.
const PAINT = {
  fixed: 'fill="currentColor" fill-opacity=".42"', // every used row but the conversation
  messages: `fill="${MESSAGES}"`,
  free: 'fill="currentColor" fill-opacity=".13"',
  buffer: 'fill="currentColor" fill-opacity=".06"', // past the compaction point: recedes
} as const
const TICK = 'fill="currentColor" fill-opacity=".55"'
// Near auto-compaction the tick takes the status colors; the text under it takes the theme's own.
const TONE = { warning: '#c98500', error: '#d03b3b' } as const
// The graphical header's widths, in bodyColumns: a nested Text wraps on its own, so instead of truncating,
// the totals give way below TOTALS and what is left before compaction below HEADROOM.
const TOTALS = 48
const HEADROOM = 34
// /context's row names, lowercased, as the legend shows them; a row not listed keeps its own name.
const NAMES: Record<string, string> = {
  'system prompt': '系统提示',
  'system tools': '系统工具',
  'mcp tools': 'MCP 工具',
  'mcp server instructions': 'MCP 服务说明',
  'custom agents': '自定义代理',
  'memory files': '记忆文件',
  'skills': 'Skills',
  'slash commands': '斜杠命令',
  'messages': '消息',
  'free space': '剩余空间',
  'autocompact buffer': '自动压缩缓冲',
  'compact buffer': '压缩缓冲',
}

// Held by the host, so the bar survives a hot reload of this file.
const reading = atom({ plugin: 'context-bar-zh', key: 'reading' } as const, null as Reading | null)
const isHidden = atom({ plugin: 'context-bar-zh', key: 'isHidden' } as const, false)
const isExpanded = atom({ plugin: 'context-bar-zh', key: 'isExpanded' } as const, false)

let bandOrder: Promise<string[]> | undefined // read once per session: restart to apply
const noted = new Set<string>() // the surfaces this process has noted its load on

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'context-bar', description: '显示或隐藏输入框上方的上下文用量条' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    const hidden = (await $.store.get('isHidden').catch(() => undefined)) === true
    await update($, isHidden, () => hidden)
    void refresh($).catch(() => {})
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await refresh($).catch(() => {}) // a subagent's turn fills its own window, not this one
    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && 'messages' in r) void refresh($).catch(() => {}) // a /compact empties the window without a turn ending
    return r
  })

  // A /clear starts a new session with no session.start and no turn yet: read the new window once the
  // end step's time bound has passed (a read still running at it would be aborted).
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason !== 'clear') return r
    await update($, reading, () => null) // the old window is gone
    const hidden = (await $.store.get('isHidden').catch(() => undefined)) === true
    await update($, isHidden, () => hidden) // a hidden bar stays hidden in the new session
    const left = next.budget.remainingMs
    try {
      $.clock.after(Number.isFinite(left) ? left : 0, () => void refresh($).catch(() => {}))
    } catch {
      // no clock: the next turn refreshes
    }
    return r
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    const hidden = await update($, isHidden, h => !h)
    await $.store.set('isHidden', hidden).catch(() => {})
    if (!hidden) await refresh($).catch(() => {})
    return { text: hidden ? '上下文条已隐藏，/context-bar 可重新显示' : '上下文条已显示' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays, drawn above the box so one-row mods stay visible
    if (!noted.has(e.surface)) {
      noted.add(e.surface)
      void recordLoad($, e.surface).catch(() => {})
    }
    const r = await read($, reading)
    if (e.props.hasSurvey || (await read($, isHidden)) || !r) return rest
    const order = await (bandOrder ??= readBandOrder($).catch(() => []))
    const expanded = await read($, isExpanded)
    const level = r.compactsAt ? r.total / r.compactsAt : r.total / r.window

    if (e.surface === 'desktop' || e.surface === 'vscode' || e.surface === 'mobile') {
      const columns = e.props.bodyColumns
      if (columns < MIN_WIDTH) return rest
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      const tone = level >= 0.9 ? 'error' : level >= 0.7 ? 'warning' : undefined
      const { fixed, messages } = parts(r)
      // A part of the bar in the legend: its swatch, centred on the first line, beside its name, tokens and
      // share of the window, and under them, hanging from the name, the rows it sums.
      const item = (part: keyof typeof PAINT, name: string, n: number, rows: Slice[] = []) => (
        <Box flexDirection="row" columnGap={1}>
          <Box height={1} alignItems="center" flexShrink={0}>
            <Svg source={swatchSvg(part, part === 'buffer' && r.compactsAt !== undefined)} alt={`${name}色块`} width={12} height={10} />
          </Box>
          <Box flexDirection="column">
            <Text>
              <Text>{`${name} `}</Text>
              <Text weight="semibold">{tokens(n)}</Text>
              <Text dimColor>{` ${share(n, r.window)}`}</Text>
            </Text>
            {rows.length > 0 && (
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                {rows.map(s => (
                  <Text dimColor>{`${label(s.name)} ${tokens(s.tokens)}`}</Text>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )
      // What every turn carries, with its rows; then the rest of the bar in its order on one line.
      const legend = (
        <Box flexDirection="column" rowGap="xs">
          {fixed > 0 && item('fixed', '固定占用', fixed, r.slices.filter(s => s.kind === 'used' && s.name !== 'messages'))}
          <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            {messages > 0 && item('messages', label('messages'), messages)}
            {r.slices.filter(s => s.kind !== 'used').map(s => item(s.kind === 'free' ? 'free' : 'buffer', label(s.name), s.tokens))}
          </Box>
        </Box>
      )
      // The totals and what is left before auto-compaction, over the bar at the band's full width; the
      // least a used part is drawn at is one column, as bodyColumns counts the band in code-font cells.
      const rows = (
        <Box flexDirection="column" rowGap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
            <Text wrap="truncate-end">
              <Text dimColor>上下文 </Text>
              <Text weight="semibold">{`${r.percent}%`}</Text>
              {columns >= TOTALS && <Text dimColor>{`  ${tokens(r.total)} / ${tokens(r.window)}`}</Text>}
            </Text>
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              {columns >= HEADROOM && (tone ? <Text color={tone}>{headroom(r)}</Text> : <Text dimColor>{headroom(r)}</Text>)}
              {expanded ? (
                <Button key="collapse" label="收起" dimColor onPress={() => update($, isExpanded, () => false)} />
              ) : (
                <Button key="expand" label="展开" dimColor onPress={() => update($, isExpanded, () => true)} />
              )}
            </Box>
          </Box>
          <Svg source={barSvg(r, 1 / columns, tone && TONE[tone])} alt={describe(r)} width={4096} height={10} />
          {expanded && legend}
        </Box>
      )
      return stackBands(rest, BAND, rows, 'below', order)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const inner = expanded ? e.props.bodyColumns - 4 : e.props.bodyColumns // expanded, the border and padding take 4 cells
    if (inner < MIN_WIDTH) return rest
    const head = `已用 ${tokens(r.total)} / ${tokens(r.window)}${r.compactsAt ? ` · ${tokens(r.compactsAt)} 时自动压缩` : ''}`
    const pct = ` ${r.percent}% `
    const usage = (
      <Text wrap="truncate-start">
        <Text dimColor>{`${head} `}</Text>
        <Text bold color="black" backgroundColor={level >= 0.9 ? 'red' : level >= 0.7 ? 'yellow' : 'green'}>{pct}</Text>
      </Text>
    )
    // A graphical surface not named above counts bodyColumns in its code font's advance: drawn in its text
    // font, these glyphs come out wider and the bar wraps. The terminal ignores mono.
    const bar = (
      <Text mono>
        {cells(r, inner).map(c => (
          <Text color={c.color}>{c.text}</Text>
        ))}
      </Text>
    )

    if (!expanded) {
      // the totals with the expand button, over the bar at the full width
      const rows = (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            {usage}
            <Button key="expand" label="展开" dimColor onPress={() => update($, isExpanded, () => true)} />
          </Box>
          {bar}
        </Box>
      )
      return stackBands(rest, BAND, rows, 'below', order) // below what other mods draw, unless the band order says otherwise
    }

    const box = (
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color="#d97757">{'◆ '}</Text>
            <Text bold>上下文</Text>
          </Text>
          <Box flexDirection="row" columnGap={1}>
            {usage}
            <Button key="collapse" label="收起" dimColor onPress={() => update($, isExpanded, () => false)} />
          </Box>
        </Box>
        {bar}
        {legend(r, inner).map(line => (
          <Text wrap="truncate-end">
            {line.map((s, i) => (
              <Text>
                {i > 0 && <Text>{SPLIT}</Text>}
                <Text color={s.color}>{s.kind === 'used' ? '■ ' : `${GLYPH[s.kind]} `}</Text>
                <Text dimColor={s.kind !== 'used'}>{`${label(s.name)} `}</Text>
                <Text bold={s.kind === 'used'}>{tokens(s.tokens)}</Text>
                {s.kind === 'used' && <Text dimColor>{` ${share(s.tokens, r.window)}`}</Text>}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )
    return stackBands(rest, BAND, box, 'below', order)
  })
}

// The band order file, as the claude-code-mods checklist saves it; [] on any error.
async function readBandOrder($: EngineInterface): Promise<string[]> {
  const file = bandsFile(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME'))
  return file && (await $.fs.exists(file)) ? parseOrder(await $.fs.read(file)) : []
}

// Forgets the cached band order, for tests.
export function resetBandOrder() {
  bandOrder = undefined
}

// Which copy of the plugin this session loaded, its version and the surface drawing it, in the store file
// (plugins/store/ under the config directory): a surface's own logs do not say. The version is the one in that
// copy's own plugin.json. The last LOADS are kept; two sessions noting theirs at once may drop one.
async function recordLoad($: EngineInterface, surface: string) {
  const at = new Date(await $.clock.now()).toISOString()
  const session = await $.session.id().catch(() => undefined)
  const manifest = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => '')
  const version = manifest ? (JSON.parse(manifest) as { version?: string }).version : undefined
  const loads = await $.store.get('loads').catch(() => undefined)
  const kept = Array.isArray(loads) ? loads.slice(-(LOADS - 1)) : []
  await $.store.set('loads', [...kept, { at, session, surface, root: $.plugin.root, version }])
}

// Forgets the surfaces noted, for tests.
export function resetLoads() {
  noted.clear()
}

// Asks the engine for /context's breakdown, estimated locally (no token-count calls).
async function refresh($: EngineInterface) {
  if (await read($, isHidden)) return
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b || !(b.rawMaxTokens > 0)) return // no window to measure against
  const pct = await $.env.get('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE').catch(() => undefined)
  const pctOverride = pct ? parseFloat(pct) : undefined // parsed as auto-compaction parses it
  await update($, reading, () => toReading(b, pctOverride))
}

// The breakdown's threshold leaves out CLAUDE_AUTOCOMPACT_PCT_OVERRIDE; auto-compaction applies it
// as min(threshold, effective window * pct / 100) when 0 < pct <= 100. The effective window (the
// window less room for output) is what the threshold sits a fixed 13k buffer below.
const AUTOCOMPACT_BUFFER = 13_000
export function compactPoint(threshold: number, pctOverride?: number) {
  if (!(pctOverride !== undefined && pctOverride > 0 && pctOverride <= 100)) return threshold
  return Math.min(threshold, Math.floor((threshold + AUTOCOMPACT_BUFFER) * (pctOverride / 100)))
}

export function toReading(b: {
  categories: { name: string; tokens: number; color: string; kind: string }[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
}, pctOverride?: number): Reading {
  const slices: Slice[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name.toLowerCase(), tokens: c.tokens, color: c.color, kind: c.kind as Slice['kind'] }))
  const order = { used: 0, free: 1, buffer: 2 }
  slices.sort((x, y) => order[x.kind] - order[y.kind]) // stable: used rows keep /context's order
  let next = 0
  for (const s of slices) {
    s.color = s.kind === 'free' ? FREE : s.kind === 'buffer' ? BUFFER : s.name === 'messages' ? MESSAGES : PALETTE[next++ % PALETTE.length]!
  }
  return {
    slices,
    total: b.totalTokens,
    window: b.rawMaxTokens,
    percent: b.percentage,
    compactsAt: b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined
      ? compactPoint(b.autoCompactThreshold, pctOverride)
      : undefined,
  }
}

// The bar as runs of cells: each slice gets its share of `width`, a used one at least one cell.
export function cells(r: Reading, width: number) {
  const sizes = r.slices.map(s => Math.max(s.kind === 'used' ? 1 : 0, Math.round((s.tokens / r.window) * width)))
  // Rounding leaves the sum a few cells off: free space takes the difference first, then the largest slices.
  let diff = width - sizes.reduce((a, n) => a + n, 0)
  const isUsed = (i: number) => r.slices[i]!.kind === 'used'
  const order = r.slices.map((_, i) => i).sort((a, b) => Number(isUsed(a)) - Number(isUsed(b)) || sizes[b]! - sizes[a]!)
  for (const i of order) {
    if (diff === 0) break
    const size = Math.max(isUsed(i) ? 1 : 0, sizes[i]! + diff)
    diff -= size - sizes[i]!
    sizes[i] = size
  }
  return r.slices.map((s, i) => ({ color: s.color, kind: s.kind, text: GLYPH[s.kind].repeat(sizes[i]!) })).filter(c => c.text !== '')
}

// The used rows in two parts: what every turn carries (system prompt, tools, memory, skills), and the
// conversation, the part that grows.
export function parts(r: Reading) {
  let fixed = 0
  let messages = 0
  for (const s of r.slices) {
    if (s.kind !== 'used') continue
    if (s.name === 'messages') messages += s.tokens
    else fixed += s.tokens
  }
  return { fixed, messages }
}

// What is left before auto-compaction runs, or of the window when it is off.
export function headroom(r: Reading) {
  if (r.compactsAt === undefined) return `剩余 ${tokens(Math.max(0, r.window - r.total))}`
  return r.total < r.compactsAt ? `距自动压缩 ${tokens(r.compactsAt - r.total)}` : '已到自动压缩点'
}

// The graphical bar in words, for a reader that cannot see the image.
export function describe(r: Reading) {
  const { fixed, messages } = parts(r)
  return `上下文已用 ${r.percent}%（${tokens(r.total)} / ${tokens(r.window)}）：固定占用 ${tokens(fixed)}，消息 ${tokens(messages)}；${headroom(r)}`
}

// The graphical bar as an SVG document the size of its slot: a graphical surface draws an Svg as an image,
// at most the band's width. Positions are shares of the width, so it fills the band unstretched; the gaps
// between parts are cut from a mask, the band's own background showing through. A used part is drawn at
// least `cell` wide; `tone` paints the compaction tick, which is neutral without it.
export function barSvg(r: Reading, cell: number, tone?: string) {
  const { fixed, messages } = parts(r)
  const a = fixed > 0 ? Math.max(cell, fixed / r.window) : 0
  const end = Math.min(1, a + (messages > 0 ? Math.max(cell, messages / r.window) : 0))
  const buffer = r.slices.reduce((n, s) => n + (s.kind === 'buffer' ? s.tokens : 0), 0)
  const at = Math.max(0, Math.min(1, r.compactsAt !== undefined ? r.compactsAt / r.window : 1 - buffer / r.window))
  const free = Math.max(end, at) // where the room left gives way to the buffer
  const x = (share: number) => `${+(share * 100).toFixed(3)}%`
  const cuts = [end > a && a > 0 ? a : 0, end < 1 ? end : 0].filter(c => c > 0)
  const tick = r.compactsAt !== undefined
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="10"><defs>' +
    '<clipPath id="bar"><rect y="2" width="100%" height="6" rx="3"/></clipPath>' +
    '<mask id="gaps" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="10">' +
    '<rect width="100%" height="10" fill="#fff"/><g fill="#000">' +
    cuts.map(c => `<rect x="${x(c)}" width="2" height="10" transform="translate(-1 0)"/>`).join('') +
    (tick ? `<rect x="${x(at)}" width="6" height="10" transform="translate(-3 0)"/>` : '') +
    '</g></mask></defs><g clip-path="url(#bar)" mask="url(#gaps)">' +
    (a > 0 ? `<rect y="2" width="${x(a)}" height="6" ${PAINT.fixed}/>` : '') +
    (end > a ? `<rect x="${x(a)}" y="2" width="${x(end - a)}" height="6" ${PAINT.messages}/>` : '') +
    (free > end ? `<rect x="${x(end)}" y="2" width="${x(free - end)}" height="6" ${PAINT.free}/>` : '') +
    (free < 1 ? `<rect x="${x(free)}" y="2" width="${x(1 - free)}" height="6" ${PAINT.buffer}/>` : '') +
    '</g>' +
    (tick ? `<rect x="${x(at)}" width="2" height="10" rx="1" transform="translate(-1 0)" ${tone ? `fill="${tone}"` : TICK}/>` : '') +
    '</svg>'
  )
}

// A legend swatch: a stub of the bar painted as `part`, the buffer's after the compaction tick when there is one.
export function swatchSvg(part: keyof typeof PAINT, tick = false) {
  const x = tick ? 4 : 0
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="10">' +
    `<rect x="${x}" y="2" width="${12 - x}" height="6" rx="3" ${PAINT[part]}/>` +
    (tick ? `<rect width="2" height="10" rx="1" ${TICK}/>` : '') +
    '</svg>'
  )
}

// The legend, packed into lines no wider than `width` display columns.
export function legend(r: Reading, width: number) {
  const lines: Slice[][] = [[]]
  let used = 0
  for (const s of r.slices) {
    const size = 2 + cols(label(s.name)) + 1 + tokens(s.tokens).length + (s.kind === 'used' ? 1 + share(s.tokens, r.window).length : 0)
    const line = lines.at(-1)!
    if (line.length > 0 && used + SPLIT.length + size > width) {
      lines.push([s])
      used = size
    } else {
      used += (line.length > 0 ? SPLIT.length : 0) + size
      line.push(s)
    }
  }
  return lines.filter(l => l.length > 0)
}

// A row's name as the legend shows it.
export function label(name: string) {
  return NAMES[name] ?? name
}

// Display columns: CJK and fullwidth characters take two.
export function cols(text: string) {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
    n += wide ? 2 : 1
  }
  return n
}

export function tokens(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(n)
}

export function share(n: number, window: number) {
  const p = (n / window) * 100
  if (p > 0 && p < 0.1) return '<0.1%'
  return `${p >= 10 ? Math.round(p) : +p.toFixed(1)}%`
}
