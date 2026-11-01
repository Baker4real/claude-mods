import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On, RenderPropsOf, RenderSurface } from 'claude-code'

const PLUGIN = 'handoff-status'
const SURFACES = ['terminal', 'desktop'] as const
const DENIAL =
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Modify Shared Resources]. If you have other tasks that do not depend on this action, continue working on those.'
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 40,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 39 },
  view: {},
}
const SPINNER: RenderPropsOf['Spinner'] = { word: 'Working', message: null, suffix: '…', mode: 'tool-use' }

type World = {
  clock: MockClock
  allowed: Set<string>
  submitted: { text: string; asUser: boolean }[]
  commands: string[]
  toasts: string[]
  statuses: (string | undefined)[]
  copies: { argv: readonly string[]; text: string | undefined }[]
  surfaces: RenderSurface[]
  invalidated: number
}

// What the session beneath the plugin answers. The classifier denies every Bash command not in `allowed`, unless
// `bashMs` makes each one a slow command that succeeds. `surfaces` is the roster of attached surfaces: a terminal
// unless given, none for a plain -p run. `beneath` is a line another mod draws above the prompt.
function world(on: On, options: { bashMs?: number; surfaces?: RenderSurface[]; beneath?: string } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: 1_000_000 }),
    allowed: new Set(),
    submitted: [],
    commands: [],
    toasts: [],
    statuses: [],
    copies: [],
    surfaces: [...(options.surfaces ?? ['terminal'])],
    invalidated: 0,
  }
  on('session.surfaces', () => ({ value: [...w.surfaces] }))
  on('session.attach', ($, e) => {
    w.surfaces.push(e.surface)
    return { clientId: e.clientId }
  })
  on('session.detach', ($, e) => {
    const at = w.surfaces.indexOf(e.surface)
    if (at >= 0) w.surfaces.splice(at, 1)
    return { clientId: e.clientId }
  })
  on('ui.invalidate', ($, e, next) => {
    if (e.event === 'ui.render') w.invalidated += 1
    return next(e)
  })
  on('prompt.submit', ($, e) => {
    w.submitted.push({ text: e.text, asUser: e.origin.kind === 'plugin' && e.origin.asUser === true })
    return { text: e.text }
  })
  on('command.run', ($, e) => {
    w.commands.push(e.command)
    return { text: '' }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
  on('process.run', ($, e) => {
    w.copies.push({ argv: e.argv, text: e.init?.env?.HANDOFF_STATUS_TEXT })
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.fork', () => ({
    value: { isAnswered: true, text: '做到第 2 步，还剩跑测试；没有在等你的事。', usage: USAGE },
  }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.StopFailure', () => ({}))
  // No band order file.
  on('env.get', () => ({ value: undefined }))
  // The engine's own band, empty as when nothing holds it, or another mod's line.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return options.beneath === undefined ? Box({}) : Box({ children: [Text({ children: options.beneath })] })
  })
  on('tool.call', { tool: 'Bash' }, async ($, e) => {
    if (options.bashMs !== undefined) {
      await w.clock.sleep(options.bashMs)
      return { result: 'ok' }
    }
    return w.allowed.has(String(e.command)) ? { result: 'ok' } : { result: DENIAL, isError: true, text: DENIAL }
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, () => ({ result: 'ok' }))
  return w
}

for (const surface of SURFACES) {
  test(`a command the classifier denied waits in the band and answers back once (${surface})`, async ($, on) => {
    const w = world(on)
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push origin main', description: 'Push main' })
    expect(ran.isError).toBe(true)
    await $.tool.call({ tool: 'Bash', command: 'git push origin main', description: 'Push main' })

    const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
    expect(await band.findAll({ type: 'Text', text: /等你运行/ })).toHaveLength(1)
    expect((await band.find({ type: 'Text', text: /#1 等你运行（bash）/ }))?.text).toBe(
      '#1 等你运行（bash）：分类器拦下（Modify Shared Resources）：Bash：Push main',
    )

    await band.press({ key: 'ran-1' })
    expect(w.submitted).toEqual([
      { text: '第 1 项我已经自己运行了，请核对结果：\n```bash\ngit push origin main\n```', asUser: true },
    ])
    expect(await band.find({ key: 'delegate-1' })).toBeUndefined()
  })
}

test('a denied command that later runs cleanly (authorized in chat) leaves the band', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ key: 'ran-1' })).toBeDefined()

  w.allowed.add('git push')
  await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push' })
  expect(await band.find({ key: 'ran-1' })).toBeUndefined()
  expect(w.submitted).toEqual([])
})

test('授权你执行 sends the exact command, 忽略 sends nothing, 复制 falls back to the host clipboard', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: 'Remove-Item x', description: 'Remove x' })
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard', description: 'Reset' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })

  await band.press({ key: 'copy-1' })
  expect(w.copies).toEqual([
    {
      argv: ['pwsh', '-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value $env:HANDOFF_STATUS_TEXT'],
      text: 'Remove-Item x',
    },
  ])
  expect(w.toasts).toEqual(['已复制'])

  await band.press({ key: 'delegate-1' })
  await band.press({ key: 'ignore-2' })
  expect(w.submitted.map(one => one.text)).toEqual(['我授权你执行第 1 项，只执行这一条：\n```bash\nRemove-Item x\n```'])
  expect(await band.find({ type: 'Text', text: /等你运行/ })).toBeUndefined()
})

test('hand_off adds items the model can close, and 授权 names the exact target', async ($, on) => {
  const w = world(on)
  const missing = await $.tool.call({ tool: 'mcp__handoff-status__hand_off', kind: 'run', title: '运行' })
  expect(String(missing.result)).toBe('Not added: kind "run" needs command.')
  const added = await $.tool.call({
    tool: 'mcp__handoff-status__hand_off',
    kind: 'authorize',
    title: '推送到远端',
    target: 'git push origin main（D:\\repo）',
  })
  expect(String(added.result)).toContain('item 1')
  const second = await $.tool.call({
    tool: 'mcp__handoff-status__hand_off',
    kind: 'run',
    title: '重启服务',
    command: 'Restart-Service x',
    shell: 'PowerShell 7',
  })
  expect(String(second.result)).toContain('item 2')
  const closed = await $.tool.call({ tool: 'mcp__handoff-status__close_handoff', ids: [2] })
  expect(String(closed.result)).toBe('Closed: 2.')

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ key: 'ran-2' })).toBeUndefined()
  expect((await band.find({ type: 'Text', text: /#1 等你授权/ }))?.text).toBe('#1 等你授权：推送到远端')
  await band.press({ key: 'grant-1' })
  expect(w.submitted.map(one => one.text)).toEqual(['我授权第 1 项：git push origin main（D:\\repo）。只做这一项。'])
  expect(await band.find({ key: 'grant-1' })).toBeUndefined()
})

test('a turn that ends on a question offers 按推荐执行 and names what is unverified', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: '做第一步', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'D:\\x\\a.md' })
  await $.turn.complete({
    answer: '第一步改好了。\n\n## 未验证\n- 桌面端 Pane 的显示\n\n推荐接着做第二步，要我继续吗？',
    durationMs: 75_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { ...USAGE, model: 'claude-opus-5-5' },
  })
  expect(w.statuses.at(-1)).toBe('在等你回答 · 有未验证项 · claude-opus-5-5')

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ type: 'Text', text: '在等你回答' })).toBeDefined()
    expect((await band.find({ type: 'Text', text: /有未验证项/ }))?.text).toBe('有未验证项：桌面端 Pane 的显示')
    expect((await band.find({ type: 'Text', text: /用时/ }))?.text).toBe('用时 1 分 15 秒 · 工具 1 次 · claude-opus-5-5')
    expect(await band.find({ key: 'neat-freak' })).toBeUndefined()
    await band.unmount()
  }

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'recommend' })
  await band.press({ key: 'recommend' }).catch(() => undefined)
  expect(w.submitted).toEqual([{ text: '按照你的推荐执行。', asUser: true }])
  expect(await band.find({ key: 'recommend' })).toBeUndefined()
})

test('a question with no recommendation leaves the answer to the person', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.turn.complete({ answer: '你想用 A 还是 B？', durationMs: 2_000, isAborted: false, turnId: 't1', reason: 'answer' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: '在等你回答' })).toBeDefined()
  expect(await band.find({ key: 'recommend' })).toBeUndefined()
})

test('wrap_up with an ask leaves the question to the app; a finished turn offers /neat-freak and /retro', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: '改好了', ask: '先修哪个？' })
  await $.turn.complete({ answer: '先修哪个？', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: '在等你回答' })).toBeDefined()
  expect(await band.find({ key: 'recommend' })).toBeUndefined()

  await $.turn.start({ text: 'b', turnId: 't2' })
  await $.turn.complete({
    answer: '都改好了，测试通过，没有未验证项。',
    durationMs: 5_000,
    isAborted: false,
    turnId: 't2',
    reason: 'answer',
  })
  expect(w.statuses.at(-1)).toBe('已完成')
  expect(await band.find({ type: 'Text', text: '已完成' })).toBeDefined()
  await band.press({ key: 'neat-freak' })
  await band.press({ key: 'retro' })
  expect(w.commands).toEqual(['neat-freak', 'retro'])

  await $.turn.start({ text: 'c', turnId: 't3' })
  await $.turn.complete({ answer: '', durationMs: 1_000, isAborted: true, turnId: 't3', reason: 'aborted' })
  expect(w.statuses.at(-1)).toBe('已中断')
  await band.press({ key: 'hide' })
  expect(await band.find({ type: 'Text', text: '已中断' })).toBeUndefined()
})

test('the spinner row says which tool runs, how long it and the turn have run; a long turn offers a side question', async ($, on) => {
  const w = world(on, { bashMs: 100_000 })
  const drawn: (string | null)[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    drawn.push(e.props.message)
    const { Text } = $.ui.resolve(e)
    return Text({ children: e.props.message ?? e.props.word })
  })

  await $.turn.start({ text: '跑测试', turnId: 't1' })
  await w.clock.advance(20_000)
  const pending = $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
  await w.clock.advance(5_000)
  const spinner = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Spinner', props: SPINNER })
  expect(drawn.at(-1)).toBe('工具 1 次 · 当前 Bash：Run the tests · 25 秒')
  await w.clock.advance(60_000)
  await spinner.redraw()
  expect(drawn.at(-1)).toBe('工具 1 次 · 当前 Bash：Run the tests（已 1 分 05 秒） · 1 分 25 秒')
  expect(await spinner.find({ type: 'Text', text: /工具 1 次/ })).toBeDefined()

  const band = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { ...BAND, isWorking: true },
  })
  await band.press({ key: 'ask' })
  expect((await band.find({ type: 'Text', text: /做到第 2 步/ }))?.text).toBe('做到第 2 步，还剩跑测试；没有在等你的事。')
  await band.press({ key: 'answer-close' })
  expect(await band.find({ type: 'Text', text: /做到第 2 步/ })).toBeUndefined()

  await w.clock.advance(40_000)
  expect((await pending).result).toBe('ok')
  await $.turn.complete({ answer: '测试都过了。', durationMs: 125_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await spinner.redraw()
  expect(drawn.at(-1)).toBeNull()
})

test('the band stacks above what another mod draws there instead of replacing it', async ($, on) => {
  world(on, { beneath: '已用 120k / 200k' })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: '已用 120k / 200k' })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push' })
  const texts = (await band.findAll({ type: 'Text' })).map(one => one.text)
  const item = texts.findIndex(text => text.startsWith('#1 等你运行'))
  expect(item).toBeGreaterThanOrEqual(0)
  expect(texts.indexOf('已用 120k / 200k')).toBeGreaterThan(item)
})

test('an API error that may clear by itself says why and offers 继续, sent once', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.classic.StopFailure({ error: 'overloaded', last_assistant_message: 'API Error: 529 Overloaded' })
  await $.turn.complete({
    answer: 'API Error: 529 Overloaded',
    durationMs: 3_000,
    isAborted: false,
    turnId: 't1',
    reason: 'error',
  })
  expect(w.statuses.at(-1)).toBe('出错结束')

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: '出错结束：API Error: 529 Overloaded' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'API 过载' })).toBeDefined()
  await band.press({ key: 'resume' })
  await band.press({ key: 'resume' }).catch(() => undefined)
  expect(w.submitted).toEqual([{ text: '继续', asUser: true }])
  expect(await band.find({ key: 'resume' })).toBeUndefined()
})

test('an API error that 继续 cannot get past says what to do first and offers no 继续', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.classic.StopFailure({ error: 'authentication_failed', last_assistant_message: 'Invalid API key · Please run /login' })
  await $.turn.complete({
    answer: 'Invalid API key · Please run /login',
    durationMs: 1_000,
    isAborted: false,
    turnId: 't1',
    reason: 'error',
  })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: '认证失败：先处理登录或密钥，再发消息继续' })).toBeDefined()
  expect(await band.find({ key: 'resume' })).toBeUndefined()

  const limit = "You've hit your limit · resets 3pm (Asia/Shanghai)"
  await $.turn.start({ text: '继续', turnId: 't2' })
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: limit })
  await $.turn.complete({ answer: limit, durationMs: 1_000, isAborted: false, turnId: 't2', reason: 'error' })
  expect(await band.find({ type: 'Text', text: '用量到了上限：3pm 重置后再继续' })).toBeDefined()
  expect(await band.find({ key: 'resume' })).toBeUndefined()
})

test("an API error no StopFailure of the main loop named stays unclassified and still offers 继续", async ($, on) => {
  world(on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  // A subagent's failure is not this turn's.
  await $.classic.StopFailure({ error: 'authentication_failed', agent_id: 'a1' })
  await $.turn.complete({
    answer: 'API Error: Connection error.',
    durationMs: 1_000,
    isAborted: false,
    turnId: 't1',
    reason: 'error',
  })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: '错误未分类' })).toBeDefined()
  expect(await band.find({ key: 'resume' })).toBeDefined()
})

test('a plain -p run, with no surface, asks for no redraw while a turn runs', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await $.turn.start({ text: 'a', turnId: 't1' })
  await w.clock.advance(5_000)
  expect(w.invalidated).toBe(0)
  await $.turn.complete({ answer: '改好了。', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.statuses.at(-1)).toBe('已完成')
})

test('a terminal gets one redraw a second while the turn runs, and none after', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await w.clock.advance(3_000)
  expect(w.invalidated).toBe(3)
  await $.turn.complete({ answer: '改好了。', durationMs: 3_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(3_000)
  expect(w.invalidated).toBe(3)
})

test('a surface attaching mid-turn starts the redraws, the last one leaving stops them', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await $.turn.start({ text: 'a', turnId: 't1' })
  await w.clock.advance(2_000)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await w.clock.advance(3_000)
  expect(w.invalidated).toBe(3)
  await $.session.detach({ surface: 'desktop', clientId: 'desktop:default', reason: 'detach' })
  await w.clock.advance(3_000)
  expect(w.invalidated).toBe(3)

  await $.turn.complete({ answer: '改好了。', durationMs: 8_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await w.clock.advance(3_000)
  expect(w.invalidated).toBe(3)
})
