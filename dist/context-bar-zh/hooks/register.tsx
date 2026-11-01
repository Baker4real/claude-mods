// Context Bar (zh): what is filling my context window?
//   Local Simplified Chinese adaptation of hamzafer/claude-code-mods context-bar 0.1.5, Copyright (c) 2026
//   Hamza Zafar, MIT License (see LICENSE and SOURCE.md).
//   Above the prompt, collapsed by default to two rows: the totals, where auto-compaction runs and the
//   share used, with an expand button; under them the window as one stacked bar, a color per category as
//   /context draws them. Expanded, the bordered box adds a title and a legend of tokens and shares. It
//   refreshes after each turn and a /clear. /context-bar shows or hides it, and the choice is kept across
//   sessions; the expanded view lasts for the session, so every new session starts collapsed. Each surface's
//   first draw notes in the plugin's store (`loads`) which copy of the plugin the session loaded.
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
    const { Box, Button, Text } = $.ui.resolve(e)
    const order = await (bandOrder ??= readBandOrder($).catch(() => []))

    const expanded = await read($, isExpanded)
    const inner = expanded ? e.props.bodyColumns - 4 : e.props.bodyColumns // expanded, the border and padding take 4 cells
    if (inner < MIN_WIDTH) return rest
    const head = `已用 ${tokens(r.total)} / ${tokens(r.window)}${r.compactsAt ? ` · ${tokens(r.compactsAt)} 时自动压缩` : ''}`
    const pct = ` ${r.percent}% `
    const level = r.compactsAt ? r.total / r.compactsAt : r.total / r.window
    const usage = (
      <Text wrap="truncate-start">
        <Text dimColor>{`${head} `}</Text>
        <Text bold color="black" backgroundColor={level >= 0.9 ? 'red' : level >= 0.7 ? 'yellow' : 'green'}>{pct}</Text>
      </Text>
    )
    // A graphical surface counts bodyColumns in its code font's advance: drawn in its text font, these
    // glyphs come out wider and the bar wraps. The terminal ignores mono.
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

// Which copy of the plugin this session loaded, and the surface drawing it, in the store file (plugins/store/
// under the config directory): a surface's own logs do not say. The last LOADS are kept; two sessions noting
// theirs at once may drop one.
async function recordLoad($: EngineInterface, surface: string) {
  const at = new Date(await $.clock.now()).toISOString()
  const session = await $.session.id().catch(() => undefined)
  const loads = await $.store.get('loads').catch(() => undefined)
  const kept = Array.isArray(loads) ? loads.slice(-(LOADS - 1)) : []
  await $.store.set('loads', [...kept, { at, session, surface, root: $.plugin.root }])
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
