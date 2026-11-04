// The bands scripts/Test-BandLayout.ps1 lays out. Not named *.test.tsx, so claude plugin test on this folder skips
// it; the script runs it alone in a copy. Each line it prints is DUMP:<case>-<bodyColumns>:<tree>. The widths are
// where each header tier is tightest: 86 a common band, 48 the narrowest with the totals (TOTALS), 34 the narrowest
// with what is left before compaction (HEADROOM), 20 the narrowest drawn at all (MIN_WIDTH).
import { describe, expect, test } from 'claude-code/testing'

import { resetBandOrder, resetLoads } from '../hooks/register'

// A window like the one in the 2026-11-03 screenshot: 251k of 456k, auto-compaction at 423k.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3_200, color: 'promptBorder', kind: 'used', isDeferred: false },
    { name: 'System tools', tokens: 22_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'MCP tools', tokens: 18_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'MCP server instructions', tokens: 2_500, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'Custom agents', tokens: 1_100, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'Memory files', tokens: 9_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'Skills', tokens: 12_000, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Messages', tokens: 183_000, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'Free space', tokens: 172_200, color: 'promptBorder', kind: 'free', isDeferred: false },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', kind: 'buffer', isDeferred: false },
  ],
  totalTokens: 250_800,
  maxTokens: 456_000,
  rawMaxTokens: 456_000,
  percentage: 55,
  autoCompactThreshold: 423_000,
  isAutoCompactEnabled: true,
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  model: 'opus',
  apiUsage: null,
  autocompactSource: 'model-default',
}

// Stands for the engine beneath the mod.
function engine(on: any) {
  resetBandOrder()
  resetLoads()
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('session.id', () => ({ value: 's' }))
  on('command.register', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: BREAKDOWN.totalTokens, window: 456_000, percent: 55, breakdown: BREAKDOWN }, rateLimits: {}, cost: { usd: 0 } } }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({}))
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the first refresh runs in the background
const print = (line: string) => (globalThis as any).console.log(line)

describe('layout dump', () => {
  test('desktop bands, collapsed and expanded', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await settle()
    let printed = 0
    for (const columns of [86, 48, 34, 20]) {
      const band = await $.ui.mount({ plugin: 'context-bar-zh', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: columns } } as any)
      print(`DUMP:collapsed-${columns}:${JSON.stringify(await band.drawn())}`)
      await band.press({ key: 'expand' })
      print(`DUMP:expanded-${columns}:${JSON.stringify(await band.drawn())}`)
      await band.press({ key: 'collapse' })
      await band.unmount()
      printed += 2
    }
    expect(printed).toBe(8)
  })
})
