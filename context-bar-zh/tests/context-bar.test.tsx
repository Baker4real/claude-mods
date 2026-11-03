import { describe, expect, mock, test } from 'claude-code/testing'

import { barSvg, cells, cols, headroom, label, legend, resetBandOrder, resetLoads, share, toReading, tokens } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 84 } }

// /context's breakdown as the engine hands it over, for a 1M window.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3_400, color: 'promptBorder', kind: 'used', isDeferred: false },
    { name: 'System tools', tokens: 12_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'MCP tools', tokens: 2_600, color: 'cyan_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'MCP tools (deferred)', tokens: 40_000, color: 'inactive', kind: 'deferred', isDeferred: true },
    { name: 'Skills', tokens: 0, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Messages', tokens: 186_000, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'Autocompact buffer', tokens: 50_000, color: 'inactive', kind: 'buffer', isDeferred: false },
    { name: 'Free space', tokens: 746_000, color: 'promptBorder', kind: 'free', isDeferred: false },
  ],
  totalTokens: 204_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 20,
  autoCompactThreshold: 950_000,
  isAutoCompactEnabled: true,
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  model: 'opus',
  apiUsage: null,
  autocompactSource: 'model-default',
}

// The engine hands fs hooks the host's absolute path: on Windows `/home/me/x` arrives as `D:\home\me\x`.
const posix = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// Stands for the engine beneath the mod.
function engine(on: any, store: Record<string, unknown> = {}, files: Record<string, string> = {}, beneath?: unknown, breakdown: typeof BREAKDOWN = BREAKDOWN) {
  const asked: unknown[] = []
  const reads: string[] = []
  resetBandOrder()
  resetLoads()
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: posix(e.path) in files }))
  on('fs.read', (_$: any, e: any) => (reads.push(posix(e.path)), { value: files[posix(e.path)] ?? '' }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('session.id', () => ({ value: 's' }))
  on('command.register', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('session.usage', (_$: any, e: any) => {
    asked.push(e)
    return { value: { startedAt: 0, context: { tokens: breakdown.totalTokens, window: 1_000_000, percent: breakdown.percentage, breakdown }, rateLimits: {}, cost: { usd: 0 } } }
  })
  on('ui.render', ($: any, e: any) => beneath ?? $.ui.resolve(e).Text({ children: 'band below' }))
  return { asked, store, reads }
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the first refresh runs in the background

// A drawn node's text, its children's joined.
const textOf = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))

describe('context-bar-zh', () => {
  test('helpers', () => {
    expect(tokens(3_400)).toBe('3.4k')
    expect(tokens(186_000)).toBe('186k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(950)).toBe('950')
    expect(share(3_400, 1_000_000)).toBe('0.3%')
    expect(share(186_000, 1_000_000)).toBe('19%')
    expect(share(494, 1_000_000)).toBe('<0.1%')

    const r = toReading(BREAKDOWN)
    // Deferred and empty rows are left out; used first, then free, then the buffer.
    expect(r.slices.map(s => s.name)).toEqual(['system prompt', 'system tools', 'mcp tools', 'messages', 'free space', 'autocompact buffer'])
    // The legend shows them in Chinese; a row not listed keeps its own name.
    expect(r.slices.map(s => label(s.name))).toEqual(['系统提示', '系统工具', 'MCP 工具', '消息', '剩余空间', '自动压缩缓冲'])
    expect(label('a new row')).toBe('a new row')
    // A CJK character takes two columns.
    expect(cols('消息')).toBe(4)
    expect(cols('MCP 工具')).toBe(8)
    expect(r.compactsAt).toBe(950_000)
    // Every used row has its own color, and none matches free space or the buffer.
    const colors = r.slices.filter(s => s.kind === 'used').map(s => s.color)
    expect(new Set(colors).size).toBe(colors.length)
    expect(cells(r, 80).find(c => c.kind === 'buffer')?.text).toMatch(/^░+$/)
    expect(cells(r, 80).find(c => c.kind === 'free')?.text).toMatch(/^─+$/)

    for (const width of [20, 47, 80, 200]) {
      const bar = cells(r, width)
      expect(bar.reduce((n, c) => n + c.text.length, 0)).toBe(width) // always exactly the width
      expect(bar.filter(c => c.kind === 'used').every(c => c.text.length >= 1)).toBe(true) // a small used slice still shows
    }
    for (const line of legend(r, 40)) {
      const size = line.reduce((n, s, i) => n + (i ? 3 : 0) + 2 + cols(label(s.name)) + 1 + tokens(s.tokens).length + (s.kind === 'used' ? 1 + share(s.tokens, r.window).length : 0), 0)
      expect(size <= 40 || line.length === 1).toBe(true)
    }
    expect(toReading({ ...BREAKDOWN, isAutoCompactEnabled: false }).compactsAt).toBeUndefined()
    // CLAUDE_AUTOCOMPACT_PCT_OVERRIDE lowers the point, as a share of the effective window (threshold + 13k);
    // out-of-range values are ignored as auto-compaction does.
    expect(toReading(BREAKDOWN, 50).compactsAt).toBe(481_500)
    expect(toReading(BREAKDOWN, 50.5).compactsAt).toBe(486_315)
    expect(toReading(BREAKDOWN, 98).compactsAt).toBe(943_740)
    expect(toReading(BREAKDOWN, 100).compactsAt).toBe(950_000)
    for (const pct of [undefined, NaN, 0, -5, 150]) expect(toReading(BREAKDOWN, pct).compactsAt).toBe(950_000)
  })

  test('draws the totals and the bar, with an expand button, by default', async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect(asked).toEqual([{ breakdown: 'summary' }]) // estimated locally, never the token-count API

    const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ key: 'expand' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /已用 204k \/ 1M · 950k 时自动压缩/ })).toBeDefined() // the totals stay
    expect(await band.find({ type: 'Text', text: / 20% / })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^上下文$/ })).toBeUndefined() // no title
    expect(await band.find({ type: 'Text', text: /^消息 $/ })).toBeUndefined() // no legend
    expect(await band.find({ type: 'Text', text: 'band below' })).toBeDefined() // the band beneath stays
    // the rows are the bottom of the stack: what other mods draw sits above them
    const root: any = await band.drawn()
    expect(root.props.key).toBe('bands')
    const kids = root.children as any[]
    expect(kids[0].children).toEqual(['band below'])
    expect(kids[1].props.key).toBe('band:context-bar-zh')
    const rows = kids[1].children[0]
    expect(rows.props.borderStyle).toBeUndefined() // no box
    expect(textOf(rows.children[0])).toMatch(/^已用 /) // the totals first
    expect(textOf(rows.children[1])).toMatch(/^█+─+░+$/) // then the bar: used, free, then the buffer
    expect(textOf(rows.children[1]).length).toBe(84) // the full width: the button sits on the totals row
    expect(rows.children[1].props.mono).toBe(true) // the cells a graphical surface counts in
    await band.unmount()
  })

  test('the vector bar', () => {
    const r = toReading(BREAKDOWN)
    const svg = barSvg(r, 1 / 84)
    // what every turn carries, then the conversation, the room left up to the compaction point, the buffer past it
    expect(svg).toContain('<rect y="2" width="1.8%" height="6" fill="currentColor" fill-opacity=".42"/>')
    expect(svg).toContain('<rect x="1.8%" y="2" width="18.6%" height="6" fill="#d97757"/>')
    expect(svg).toContain('<rect x="20.4%" y="2" width="74.6%" height="6" fill="currentColor" fill-opacity=".13"/>')
    expect(svg).toContain('<rect x="95%" y="2" width="5%" height="6" fill="currentColor" fill-opacity=".06"/>')
    expect(svg).toContain('<rect x="95%" width="2" height="10" rx="1" transform="translate(-1 0)" fill="currentColor" fill-opacity=".55"/></svg>')
    // gaps cut between the parts and round the tick
    expect(svg).toContain('<rect x="1.8%" width="2" height="10" transform="translate(-1 0)"/>')
    expect(svg).toContain('<rect x="20.4%" width="2" height="10" transform="translate(-1 0)"/>')
    expect(svg).toContain('<rect x="95%" width="6" height="10" transform="translate(-3 0)"/>')
    expect(barSvg(r, 1 / 84, '#d03b3b')).toContain('transform="translate(-1 0)" fill="#d03b3b"/></svg>')
    expect(barSvg(r, 0.05)).toContain('<rect y="2" width="5%" height="6"') // a used part is at least a column wide
    // auto-compaction off: no tick, and no buffer without one
    const off = toReading({ ...BREAKDOWN, isAutoCompactEnabled: false, categories: BREAKDOWN.categories.filter(c => c.kind !== 'buffer') })
    expect(barSvg(off, 1 / 84)).not.toContain('rx="1"')
    expect(barSvg(off, 1 / 84)).not.toContain('fill-opacity=".06"')
    expect(headroom(off)).toBe('剩余 796k')
    expect(headroom(r)).toBe('距自动压缩 746k')
    expect(headroom({ ...r, total: 960_000 })).toBe('已到自动压缩点')
  })

  test('draws a vector bar across the band on the desktop', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await settle()

    const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'desktop', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /^上下文 20% {2}204k \/ 1M$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^距自动压缩 746k$/ })).toBeDefined()
    expect(await band.find({ key: 'expand' })).toBeDefined()
    const rows = ((await band.drawn()) as any).children[1].children[0]
    expect(rows.props.borderStyle).toBeUndefined() // no box, collapsed or not
    const bar = rows.children[1]
    expect(bar.type).toBe('Svg')
    expect(bar.props).toMatchObject({ width: 4096, height: 10 }) // drawn at most the band's width
    expect(bar.props.source).toBe(barSvg(toReading(BREAKDOWN), 1 / 84))
    expect(bar.props.alt).toBe('上下文已用 20%（204k / 1M）：固定占用 18k，消息 186k；距自动压缩 746k')
    expect(await band.find({ type: 'Text', text: /^固定占用/ })).toBeUndefined() // no legend

    await band.press({ key: 'expand' })
    expect(await band.find({ type: 'Text', text: /^固定占用 18k 1\.8%$/ })).toBeDefined()
    for (const row of ['系统提示 3.4k', '系统工具 12k', 'MCP 工具 2.6k']) expect(await band.find({ type: 'Text', text: row })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^消息 186k 19%$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^剩余空间 746k 75%$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^自动压缩缓冲 50k 5%$/ })).toBeDefined()
    expect((await band.findAll({ type: 'Svg' })).length).toBe(5) // the bar and a swatch for each part
    expect(await band.find({ key: 'collapse' })).toBeDefined()
    expect((((await band.drawn()) as any).children[1].children[0]).props.borderStyle).toBeUndefined()
    await band.press({ key: 'collapse' })
    expect(await band.find({ type: 'Text', text: /^固定占用/ })).toBeUndefined()
    await band.unmount()
  })

  test('a narrow band drops the totals, then what is left, rather than wrap', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const at = (bodyColumns: number) => $.ui.mount({ plugin: 'context-bar-zh', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns } } as any)
    let band = await at(40)
    expect(await band.find({ type: 'Text', text: /^上下文 20%$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^距自动压缩 746k$/ })).toBeDefined()
    await band.unmount()
    band = await at(30)
    expect(await band.find({ type: 'Text', text: /^上下文 20%$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /距自动压缩/ })).toBeUndefined()
    expect(await band.find({ key: 'expand' })).toBeDefined()
    await band.unmount()
    band = await at(19)
    expect(await band.find({ key: 'expand' })).toBeUndefined() // too narrow for the bar at all
    await band.unmount()
  })

  test('warns near auto-compaction on the desktop', async ($, on) => {
    const near = {
      ...BREAKDOWN,
      categories: BREAKDOWN.categories.map(c => (c.name === 'Messages' ? { ...c, tokens: 882_000 } : c.name === 'Free space' ? { ...c, tokens: 50_000 } : c)),
      totalTokens: 900_000,
      percentage: 90,
    }
    engine(on, {}, {}, undefined, near)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'desktop', ...BAND } as any)
    const rows = ((await band.drawn()) as any).children[1].children[0]
    const left = rows.children[0].children[1].children[0] // what is left, beside the expand button
    expect(textOf(left)).toBe('距自动压缩 50k')
    expect(left.props.color).toBe('error') // 900k of 950k
    expect(rows.children[1].props.source).toContain('fill="#d03b3b"/></svg>') // and the tick
    await band.unmount()
  })

  test('notes which copy of the plugin a surface drew, once per surface', async ($, on) => {
    const older = Array.from({ length: 20 }, (_, i) => ({ at: `older ${i}` }))
    const { store } = engine(on, { loads: older })
    mock.clock(on, { now: Date.parse('2026-11-01T08:00:00Z') })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await settle()
    for (let i = 0; i < 2; i++) {
      const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'desktop', ...BAND } as any)
      await band.drawn()
      await band.unmount()
    }
    await settle()
    const loads = store.loads as any[]
    expect(loads.length).toBe(20) // the oldest goes
    expect(loads[0].at).toBe('older 1')
    expect(loads.filter(l => l.surface === 'desktop').length).toBe(1) // drawn twice, noted once
    const load = loads.at(-1)
    expect(load.at).toBe('2026-11-01T08:00:00.000Z')
    expect(load.session).toBe('s')
    expect(load.surface).toBe('desktop')
    expect(load.root).toMatch(/context-bar-zh$/) // the plugin's folder, as this session loaded it
  })

  test('expands to the title and legend, and collapses back', async ($, on) => {
    const { store } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()

    let band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    await band.press({ key: 'expand' })
    expect(await band.find({ type: 'Text', text: /^上下文$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /已用 204k \/ 1M · 950k 时自动压缩/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: / 20% / })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^消息 $/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^186k$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /deferred/ })).toBeUndefined()
    expect(await band.find({ key: 'expand' })).toBeUndefined()
    const root: any = await band.drawn()
    expect(root.children[1].children[0].props.borderStyle).toBe('round')
    expect('isExpanded' in store).toBe(false) // this session only: a new one starts collapsed
    await band.unmount()

    band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /^消息 $/ })).toBeDefined() // still expanded
    await band.press({ key: 'collapse' })
    expect(await band.find({ type: 'Text', text: /^消息 $/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /已用 204k/ })).toBeDefined() // the totals stay
    expect(await band.find({ key: 'expand' })).toBeDefined()
    await band.unmount()
  })

  test('follows the band order file', async ($, on) => {
    // another band mod drew its column beneath
    const beneath = {
      type: 'Box',
      props: { key: 'bands', flexDirection: 'column' },
      children: [{ type: 'Box', props: { key: 'band:where-am-i' }, children: [{ type: 'Text', children: ['here'] }] }],
    }
    engine(on, {}, { '/home/me/.claude/claude-code-mods/bands.json': '{"order":["context-bar-zh","where-am-i"]}' }, beneath)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    const root: any = await band.drawn()
    expect(root.children.map((c: any) => c.props.key)).toEqual(['band:context-bar-zh', 'band:where-am-i'])
    await band.unmount()
  })

  test('reads the band order file once per session', async ($, on) => {
    const { reads } = engine(on, {}, { '/home/me/.claude/claude-code-mods/bands.json': '{"order":["context-bar-zh"]}' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    for (let i = 0; i < 2; i++) {
      const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
      await band.drawn()
      await band.unmount()
    }
    expect(reads).toEqual(['/home/me/.claude/claude-code-mods/bands.json'])
  })

  test('refreshes after a main turn, not after a subagent turn', async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, agentId: 'a1' } as any)
    expect(asked.length).toBe(1)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(asked.length).toBe(2)
  })

  test('refreshes after a compaction', async ($, on) => {
    const { asked } = engine(on)
    on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
    await settle()
    expect(asked.length).toBe(2)
  })

  test('reads the new window after a /clear, not after an exit', async ($, on) => {
    const { asked } = engine(on)
    const clock = mock.clock(on)
    on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect(asked.length).toBe(1)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: {} } as any)
    await clock.advance(20_000)
    expect(asked.length).toBe(1)
    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as any)
    await clock.advance(1)
    await settle()
    expect(asked.length).toBe(1) // not inside the end step's time bound
    await clock.advance(20_000) // past it, whatever the bound
    await settle()
    expect(asked.length).toBe(2)
  })

  test('/context-bar hides and shows it, and remembers the choice', async ($, on) => {
    const { store } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect((await $.command.run({ command: 'context-bar', args: '' } as any)).text).toMatch(/已隐藏/)
    expect(store.isHidden).toBe(true)
    let band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ key: 'expand' })).toBeUndefined()
    await band.unmount()

    expect((await $.command.run({ command: 'context-bar', args: '' } as any)).text).toBe('上下文条已显示')
    expect(store.isHidden).toBe(false)
    band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ key: 'expand' })).toBeDefined()
    await band.unmount()
  })

  test('a /clear drops the old window and takes the stored hidden choice', async ($, on) => {
    const { asked, store } = engine(on)
    const clock = mock.clock(on)
    on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect(asked.length).toBe(1)
    store.isHidden = true // hidden since, as another session would store it
    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as any)
    let band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ key: 'expand' })).toBeUndefined() // the old window is gone at once
    await band.unmount()
    await clock.advance(20_000)
    await settle()
    expect(asked.length).toBe(1) // hidden: no read
    band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ key: 'expand' })).toBeUndefined()
    await band.unmount()
  })

  test('a session that hid it starts hidden', async ($, on) => {
    engine(on, { isHidden: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ key: 'expand' })).toBeUndefined()
    await band.unmount()
  })
})
