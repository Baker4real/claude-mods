import { expect, mock, test } from 'claude-code/testing'

// Local addition: the desktop fold of tool rows, tool groups and the notes the model writes as thinking.

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

function note(value) {
  return { type: 'thinking', thinking: value, signature: 'sig' }
}

function toolUse(id, name = 'Bash') {
  return { type: 'tool_use', id, name, input: { command: 'ls' } }
}

function call(id, name = 'Bash') {
  return { tool_use_id: id, tool: name, input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' }
}

async function mountRow($, component, requestId, props) {
  return $.ui.mount({ plugin: 'collapse-work', surface: 'desktop', component, requestId, props, viewport: VIEWPORT })
}

async function mountText($, requestId, value, isSummary = false) {
  const props = { text: value, isFirstOfReply: false }
  if (isSummary) {
    return mountRow($, 'AssistantMessage', requestId, { ...props, isSummary: true })
  }
  return mountRow($, 'AssistantMessage', requestId, props)
}

async function mountTool($, id, name = 'Bash') {
  return mountRow($, 'ToolUse', id, call(id, name))
}

async function mountResult($, id) {
  return mountRow($, 'ToolResult', id, { tool_use_id: id, tool: 'Bash', output: 'ok', isErrored: false })
}

async function mountGroup($, calls) {
  return mountRow($, 'ToolGroup', 'collapsed-' + calls[0].tool_use_id, { calls, isActive: false, isExpanded: false })
}

async function isEngineRow(row) {
  return (await row.find({ type: 'Text', text: 'drawn by Claude Code' })) !== undefined
}

test('desktop: a finished turn folds its tool rows, groups, notes and text before the answer, and opens on press', async ($, on) => {
  engine(on)
  await runTurn($, 't1', [
    note('Reading the catalogue first.  '),
    toolUse('toolu_1'),
    text('Found two indexes'),
    toolUse('toolu_2'),
    toolUse('toolu_3'),
    text('The answer'),
  ])

  const answer = await mountText($, 'msg_c-t0', 'The answer')
  expect(await answer.find({ key: 'fold' })).toBeDefined()
  expect(await isEngineRow(answer)).toBe(true)

  const folded = [
    await mountText($, 'msg_a-t0', 'Reading the catalogue first.', true),
    await mountText($, 'msg_b-t0', 'Found two indexes'),
    await mountTool($, 'toolu_1'),
    await mountResult($, 'toolu_1'),
    await mountGroup($, [call('toolu_2'), call('toolu_3')]),
  ]
  for (const row of folded) {
    expect(await isEngineRow(row)).toBe(false)
  }

  await answer.press({ key: 'fold' })
  for (const row of folded) {
    expect(await isEngineRow(row)).toBe(true)
  }
})

test('desktop: rows that show the person something stay out of the fold', async ($, on) => {
  engine(on)
  await runTurn($, 't1', [
    toolUse('toolu_1'),
    toolUse('toolu_2', 'AskUserQuestion'),
    toolUse('toolu_3', 'mcp__ccd_turn__wrap_up'),
    text('Done here'),
  ])

  expect(await (await mountText($, 'msg_b-t0', 'Done here')).find({ key: 'fold' })).toBeDefined()
  expect(await isEngineRow(await mountTool($, 'toolu_1'))).toBe(false)
  expect(await isEngineRow(await mountTool($, 'toolu_2', 'AskUserQuestion'))).toBe(true)
  expect(await isEngineRow(await mountTool($, 'toolu_3', 'mcp__ccd_turn__wrap_up'))).toBe(true)
  expect(await isEngineRow(await mountGroup($, [call('toolu_1'), call('toolu_2', 'AskUserQuestion')]))).toBe(true)
})

test('desktop: a turn whose only work is a kept row shows Worked for with nothing to open', async ($, on) => {
  engine(on)
  await runTurn($, 't1', [toolUse('toolu_9', 'mcp__ccd_turn__wrap_up'), text('Short answer')])

  const answer = await mountText($, 'msg_a-t0', 'Short answer')
  expect(await answer.find({ key: 'fold' })).toBeUndefined()
  expect(await answer.find({ type: 'Text', text: 'Worked for 4s' })).toBeDefined()
  expect(await isEngineRow(answer)).toBe(true)
})

test('desktop: the rows of a turn still running are left alone', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await respond($, 't1-0', note('Looking around.'))
  await respond($, 't1-1', toolUse('toolu_1'))

  expect(await isEngineRow(await mountTool($, 'toolu_1'))).toBe(true)
  expect(await isEngineRow(await mountText($, 'msg_a-t0', 'Looking around.', true))).toBe(true)
})
