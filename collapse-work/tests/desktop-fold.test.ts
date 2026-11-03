import { expect, mock, test } from 'claude-code/testing'

// Local addition: the desktop fold holds only the text before the answer, leaves tool rows to the app, and adds no margin there.

const VIEWPORT = { columns: 100, rows: 30, isFullscreen: true } as const
const MODEL = { kind: 'model', model: 'claude-test' } as const

function engine(on) {
  mock.store(on, {})
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

// The kit has nothing beneath session.append to keep a row, so the call rejects once the mod's hook has seen it.
async function append($, row) {
  await $.session.append(row).catch((error) => {
    if (!error.message.includes('no implementation for session.append')) {
      throw error
    }
  })
}

async function respond($, uuid, block) {
  await append($, { uuid, door: 'response', origin: MODEL, message: { type: 'assistant', role: 'assistant', content: [block] } })
}

async function runTurn($, turnId, blocks) {
  await $.turn.start({ text: 'go', turnId })
  for (const [index, block] of blocks.entries()) {
    await respond($, turnId + '-' + index, block)
  }
  await $.turn.complete({ turnId, answer: '', durationMs: 4000, isAborted: false, reason: 'answer' })
}

function text(value) {
  return { type: 'text', text: value }
}

function toolUse(id) {
  return { type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }
}

function call(id) {
  return { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' }
}

async function mountRow($, surface, component, requestId, props) {
  return $.ui.mount({ plugin: 'collapse-work', surface, component, requestId, props, viewport: VIEWPORT })
}

async function mountText($, requestId, value, surface = 'desktop') {
  return mountRow($, surface, 'AssistantMessage', requestId, { text: value, isFirstOfReply: false })
}

async function isEngineRow(row) {
  return (await row.find({ type: 'Text', text: 'drawn by Claude Code' })) !== undefined
}

test('desktop: a finished turn folds its text before the answer, leaves its tool rows to the app, and opens on press', async ($, on) => {
  engine(on)
  await runTurn($, 't1', [toolUse('toolu_1'), text('Found two indexes'), toolUse('toolu_2'), toolUse('toolu_3'), text('The answer')])

  const answer = await mountText($, 'msg_c-t0', 'The answer')
  expect(await answer.find({ key: 'fold' })).toBeDefined()
  expect(await isEngineRow(answer)).toBe(true)

  const before = await mountText($, 'msg_b-t0', 'Found two indexes')
  expect(await isEngineRow(before)).toBe(false)

  const toolRows = [
    await mountRow($, 'desktop', 'ToolUse', 'toolu_1', call('toolu_1')),
    await mountRow($, 'desktop', 'ToolResult', 'toolu_1', { tool_use_id: 'toolu_1', tool: 'Bash', output: 'ok', isErrored: false }),
    await mountRow($, 'desktop', 'ToolGroup', 'collapsed-toolu_2', { calls: [call('toolu_2'), call('toolu_3')], isActive: false, isExpanded: false }),
  ]
  for (const row of toolRows) {
    expect(await isEngineRow(row)).toBe(true)
  }

  await answer.press({ key: 'fold' })
  expect(await isEngineRow(before)).toBe(true)
})

test('desktop: the Worked for line takes no margin, which the terminal keeps', async ($, on) => {
  engine(on)
  await runTurn($, 't1', [text('Let me look'), toolUse('toolu_1'), text('The answer')])

  const desktop = (await (await mountText($, 'msg_b-t0', 'The answer')).drawn()).children[0]
  expect(desktop.type).toBe('Box')
  expect(desktop.props?.marginTop).toBeUndefined()

  const terminal = (await (await mountText($, 't1-0', 'Let me look', 'terminal')).drawn()).children[0]
  expect(terminal.type).toBe('Box')
  expect(terminal.props?.marginTop).toBe(1)
})

test('desktop: a turn with only tool calls before its answer shows Worked for with nothing to open', async ($, on) => {
  engine(on)
  await runTurn($, 't1', [toolUse('toolu_9'), text('Short answer')])

  const answer = await mountText($, 'msg_a-t0', 'Short answer')
  expect(await answer.find({ key: 'fold' })).toBeUndefined()
  expect(await answer.find({ type: 'Text', text: 'Worked for 4s' })).toBeDefined()
  expect(await isEngineRow(answer)).toBe(true)
})

test('desktop: the rows of a turn still running are left alone', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await respond($, 't1-0', text('Looking around.'))
  await respond($, 't1-1', toolUse('toolu_1'))

  expect(await isEngineRow(await mountText($, 'msg_a-t0', 'Looking around.'))).toBe(true)
})
