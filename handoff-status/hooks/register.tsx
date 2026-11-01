import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  HookFailure,
  ModelForkResult,
  Register,
  RenderSurface,
  Timer,
  ToolCallResult,
  TurnCompleteInput,
} from 'claude-code'

import type { Item, Meta, Progress, Stop, Verdict } from '../types'
import { bandsFile, parseOrder, stackBands } from './bands'

// The band above the prompt lists what waits on the person: commands the auto-mode classifier denied, and steps
// Claude handed over with hand_off. A button answers back as the person's own message, the same as typing it, and
// the item leaves the band at once, so two answers to one item (ran it myself AND run it for me) cannot both go out.
// After a main-loop turn the band says how it ended and which model, gateway and session this is; a turn an API
// error ended says why, with 继续 where the error may clear by itself. While a turn runs, the spinner row says how
// many tools ran, which one runs now and for how long. The band stacks on what other mods draw above the prompt.

type Dollar = EngineInterface
type Fields = Readonly<Record<string, unknown>>
type Reply = 'ran' | 'delegate' | 'grant'
// What StopFailure said of the API error that is ending the turn.
type Failure = { error: string; said: string }

const WRAP_UP = 'mcp__ccd_turn__wrap_up'
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])
const DENIED = /denied by the Claude Code auto mode classifier/
const UNVERIFIED = /未验证|没验证|未经验证|没有验证|未核实|没核实|待验证|未测试|没测试|无法验证|unverified|not verified/i
// "没有未验证项", "未验证项：无": the answer says there is none.
const NONE_UNVERIFIED =
  /(没有|无|不存在)\S{0,4}(未验证|未核实|待验证)|(未验证|未核实|待验证)\S{0,3}[:：]\s*(无|没有|none)[。.]?$/i
const NOTHING = /^(无|没有|none|n\/a)[。.]?$/i
const RECOMMENDS = /推荐|建议|recommend/i
const LONG_TURN_MS = 60_000
const LONG_TOOL_MS = 10_000
const BAND = 'handoff-status' // the band's name in the band order file
const RESUME = '继续'
// The engine's error kinds an API error may clear from by itself; any other kind needs the person first.
const TRANSIENT = new Set(['rate_limit', 'overloaded', 'server_error', 'max_output_tokens', 'unknown'])
const USAGE_LIMIT = /\bhit your\b.*\blimit\b/i
const RESETS = /\bresets\s+(?:at\s+)?([^·(\n]+?)\s*(?:\(|·|$)/im
const FORK_PROMPT = [
  '用户在界面上按了「现在什么状态？」。这是旁路提问：回答只显示在按钮旁，不进对话，你也不能调用工具。',
  '只依据上面的对话，用不超过 4 行简体中文回答：做到哪一步；接下来还要做什么；有没有在等用户做的事或决定（没有就写“没有”）。不要寒暄。',
].join('\n')

const HAND_OFF = {
  name: 'hand_off',
  description: [
    'Puts one step that waits on the user into the 待你处理 band above their prompt, with buttons that answer you back as their own message.',
    'kind "run": a command the user runs themselves (give command and shell); buttons: copy, 我已运行 (you then check the result), 授权你执行 (you run it), ignore.',
    'kind "authorize": an action that needs their explicit go-ahead (give target, the exact action and target); buttons: 授权, 先不做.',
    'Commands the auto-mode classifier denies are added by themselves: do not hand those off again. Keep showing the command in your reply as usual.',
    'Returns the item number; remove an item that got resolved some other way with close_handoff.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['run', 'authorize'] },
      title: { type: 'string', description: "One short line in the user's language: what the step is for." },
      command: { type: 'string', description: 'kind "run": the exact command, verbatim; may span lines.' },
      shell: { type: 'string', description: 'kind "run": where to run it, e.g. "PowerShell 7" or "bash".' },
      target: {
        type: 'string',
        description: 'kind "authorize": the exact action and target, e.g. "git push origin main in D:\\repo".',
      },
    },
    required: ['kind', 'title'],
  },
  isDeferred: false,
}

const CLOSE_HANDOFF = {
  name: 'close_handoff',
  description:
    'Removes items from the 待你处理 band once they are resolved some other way (the user answered in chat, or the step is no longer needed).',
  inputSchema: {
    type: 'object',
    properties: { ids: { type: 'array', items: { type: 'integer' }, description: 'The item numbers to remove.' } },
    required: ['ids'],
  },
  isDeferred: false,
}

const IDLE: Progress = { isRunning: false, startedAt: 0, tools: 0, current: null, currentAt: 0, parallel: 0 }

const items = atom({ plugin: 'handoff-status', key: 'items' } as const, [])
const nextId = atom({ plugin: 'handoff-status', key: 'nextId' } as const, 1)
const progress = atom({ plugin: 'handoff-status', key: 'progress' } as const, IDLE)
const verdict = atom({ plugin: 'handoff-status', key: 'verdict' } as const, null)
const meta = atom({ plugin: 'handoff-status', key: 'meta' } as const, null)
const answer = atom({ plugin: 'handoff-status', key: 'answer' } as const, null)
const isAsking = atom({ plugin: 'handoff-status', key: 'isAsking' } as const, false)
const isHidden = atom({ plugin: 'handoff-status', key: 'isHidden' } as const, false)
const isDeciding = atom({ plugin: 'handoff-status', key: 'isDeciding' } as const, false)
const canResume = atom({ plugin: 'handoff-status', key: 'canResume' } as const, false)

let bandOrder: Promise<string[]> | undefined // read once per session: restart to apply

export const register: Register = on => {
  const running = new Map<string, { label: string; at: number }>()
  let tick: Timer | undefined
  let hasAsk = false
  let failure: Failure | undefined

  const stopTicking = () => {
    tick?.cancel()
    tick = undefined
  }

  on('session.start', async ($, e, next) => {
    await $.tool.register(HAND_OFF)
    await $.tool.register(CLOSE_HANDOFF)
    const base = await $.env.get('ANTHROPIC_BASE_URL')
    const info: Meta = {
      session: (await $.session.id()).slice(0, 8),
      cwd: await $.session.cwd(),
      gateway: base === undefined ? null : hostOf(base),
      configured: await $.session.model(),
    }
    await update($, meta, () => info)
    // A reload ends whatever the old module was doing.
    await update($, progress, () => IDLE)
    await update($, isAsking, () => false)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    running.clear()
    hasAsk = false
    failure = undefined
    const startedAt = await $.clock.now()
    await update($, progress, () => ({ ...IDLE, isRunning: true, startedAt }))
    await update($, isDeciding, () => false)
    await update($, canResume, () => false)
    await update($, answer, () => null)
    stopTicking()
    if (await isDrawnTurn($)) tick ??= everySecond($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    stopTicking()
    running.clear()
    const { tools } = await read($, progress)
    const last = judge(e, tools, failure)
    await update($, progress, () => IDLE)
    await update($, verdict, () => last)
    // 按推荐执行 needs a recommendation to accept; wrap_up with an ask already drew the app's own question box.
    await update($, isDeciding, () => last.isQuestion && RECOMMENDS.test(e.answer) && !hasAsk)
    await update($, canResume, () => last.stop !== null && TRANSIENT.has(last.stop.error))
    await update($, isHidden, () => false)
    const info = await read($, meta)
    $.ui.status([outcome(last), last.model ?? info?.configured].filter(Boolean).join(' · '))
    return next(e)
  })

  // The engine names the kind of an API error here, before the turn it ends completes.
  on('classic.StopFailure', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id === undefined) failure = { error: String(e.error), said: e.last_assistant_message ?? '' }
    return r
  })

  // A surface can join or leave mid-turn: the desktop app, a phone.
  on('session.attach', async ($, e, next) => {
    const joined = await next(e)
    if (await isDrawnTurn($)) tick ??= everySecond($)
    return joined
  })

  on('session.detach', async ($, e, next) => {
    const left = await next(e)
    if ((await $.session.surfaces()).length === 0) stopTicking()
    return left
  })

  // Watches every call and holds none back: when it fails, the tool runs once, or what it already returned stands.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const input = fields(e)
    if (e.tool === WRAP_UP && text(input.ask) !== undefined) hasAsk = true
    const label = describe(e.tool, input)
    const at = await $.clock.now()
    running.set(e.tool_use_id, { label, at })
    await update($, progress, p => ({ ...p, tools: p.tools + 1, current: label, currentAt: at, parallel: running.size }))
    try {
      const ran = await next(e)
      await follow($, e.tool, input, label, ran)
      return ran
    } finally {
      running.delete(e.tool_use_id)
      const latest = [...running.values()].at(-1)
      await update($, progress, p => ({
        ...p,
        current: latest?.label ?? null,
        currentAt: latest?.at ?? 0,
        parallel: running.size,
      }))
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__handoff-status__hand_off' }, async ($, e) => {
    const input = fields(e)
    const kind = input.kind
    const title = text(input.title)
    const command = text(input.command)
    const target = text(input.target)
    if ((kind !== 'run' && kind !== 'authorize') || title === undefined) {
      return { result: 'Not added: kind must be "run" or "authorize", and title is required.' }
    }
    if (kind === 'run' && command === undefined) return { result: 'Not added: kind "run" needs command.' }
    if (kind === 'authorize' && target === undefined) return { result: 'Not added: kind "authorize" needs target.' }
    const id = await addItem($, { kind, title, command, shell: text(input.shell), target, source: 'model' })
    return { result: `Added as item ${id} in the 待你处理 band above the user's prompt.` }
  }).catch(($, e, next) => failed('Not added', next.error))

  on('tool.call', { tool: 'mcp__handoff-status__close_handoff' }, async ($, e) => {
    const asked = fields(e).ids
    const ids = Array.isArray(asked) ? asked.filter((id): id is number => typeof id === 'number') : []
    let closed: number[] = []
    await update($, items, list => {
      closed = list.filter(one => ids.includes(one.id)).map(one => one.id)
      return list.filter(one => !ids.includes(one.id))
    })
    return { result: closed.length === 0 ? `No open item among: ${ids.join(', ')}.` : `Closed: ${closed.join(', ')}.` }
  }).catch(($, e, next) => failed('Nothing closed', next.error))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const now = await read($, progress)
    // The engine's own message (a retry, a compaction) says more than ours.
    if (!now.isRunning || now.tools === 0 || e.props.message !== null) return next(e)
    const at = await $.clock.now()
    const parts = [`工具 ${now.tools} 次`]
    if (now.current !== null) parts.push(`当前 ${now.current}${aside(now, at)}`)
    parts.push(duration(at - now.startedAt))
    return next({ ...e, props: { ...e.props, message: parts.join(' · ') } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What other mods and the engine draw here stays: this band stacks on it rather than replacing it.
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const list = await read($, items)
    const last = await read($, verdict)
    const info = await read($, meta)
    const reply = await read($, answer)
    const asking = await read($, isAsking)
    const hidden = await read($, isHidden)
    const deciding = await read($, isDeciding)
    const resumable = await read($, canResume)
    const now = await read($, progress)
    const working = e.props.isWorking
    const isLong = working && now.isRunning && (await $.clock.now()) - now.startedAt >= LONG_TURN_MS
    const showStatus = !hidden && !working && last !== null
    if (list.length === 0 && !showStatus && !isLong && reply === null && !asking) return rest

    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const askButton = asking ? (
      <Text dimColor>正在问…</Text>
    ) : (
      <Button key="ask" label="现在什么状态？" onPress={() => ask($)} />
    )
    const isWrapped = last !== null && last.kind === 'answer' && !last.isQuestion && list.length === 0

    const mine = (
      <Box flexDirection="column">
        {showStatus && last !== null && (
          <Box flexDirection="column">
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Text color={tone(last, list.length)} weight="semibold">
                {headline(last, list.length)}
              </Text>
              {last.unverified !== null && <Text color="warning">{`有未验证项：${last.unverified}`}</Text>}
              {last.stop !== null && <Text color="warning">{stopHint(last.stop)}</Text>}
              <Text dimColor>{facts(last, info)}</Text>
            </Box>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {resumable && <Button key="resume" label={RESUME} variant="primary" onPress={() => resume($)} />}
              {askButton}
              {isWrapped && <Button key="neat-freak" label="收尾 /neat-freak" onPress={() => run($, 'neat-freak')} />}
              {isWrapped && <Button key="retro" label="复盘 /retro" onPress={() => run($, 'retro')} />}
              <Button key="hide" label="隐藏" dimColor onPress={() => update($, isHidden, () => true)} />
            </Box>
          </Box>
        )}
        {isLong && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {askButton}
            <Text dimColor>旁路提问，不打断这一轮</Text>
          </Box>
        )}
        {!showStatus && !isLong && asking && <Text dimColor>正在问…</Text>}
        {reply !== null && (
          <Box flexDirection="column">
            <Text color={reply.isError ? 'error' : 'claude'}>现在的状态（旁路回答，没进对话）</Text>
            <Text>{reply.text}</Text>
            <Button key="answer-close" label="收起" dimColor onPress={() => update($, answer, () => null)} />
          </Box>
        )}
        {list.map(item =>
          item.kind === 'run' ? (
            <Box key={`item-${item.id}`} flexDirection="column">
              <Text color="warning">
                {`#${item.id} 等你运行${item.shell === undefined ? '' : `（${item.shell}）`}：${item.title}`}
              </Text>
              <Code source={item.command ?? ''} language={item.shell === 'bash' ? 'bash' : 'powershell'} />
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                <Button key={`copy-${item.id}`} label="复制" onPress={press => copy($, item.command ?? '', press.surface)} />
                <Button key={`ran-${item.id}`} label="我已运行" onPress={() => send($, item, 'ran')} />
                <Button key={`delegate-${item.id}`} label="授权你执行" onPress={() => send($, item, 'delegate')} />
                <Button key={`ignore-${item.id}`} label="忽略" dimColor onPress={() => take($, item.id)} />
              </Box>
            </Box>
          ) : (
            <Box key={`item-${item.id}`} flexDirection="column">
              <Text color="warning">{`#${item.id} 等你授权：${item.title}`}</Text>
              <Text>{item.target ?? ''}</Text>
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                <Button key={`grant-${item.id}`} label="授权" variant="primary" onPress={() => send($, item, 'grant')} />
                <Button key={`skip-${item.id}`} label="先不做" dimColor onPress={() => take($, item.id)} />
              </Box>
            </Box>
          ),
        )}
        {showStatus && deciding && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text color="suggestion">上一轮停在一个问题上</Text>
            <Button key="recommend" label="按推荐执行" variant="primary" onPress={() => decide($)} />
            <Button key="not-now" label="先不做" dimColor onPress={() => update($, isDeciding, () => false)} />
          </Box>
        )}
      </Box>
    )
    return stackBands(rest, BAND, mine, 'above', await (bandOrder ??= readBandOrder($).catch(() => [])))
  })
}

// The band order file, as the claude-code-mods checklist saves it; [] when there is none.
async function readBandOrder($: Dollar): Promise<string[]> {
  const file = bandsFile(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME'))
  return file && (await $.fs.exists(file)) ? parseOrder(await $.fs.read(file)) : []
}

// The spinner row and the long-turn row redraw each second while a turn runs, but only where a surface draws:
// a plain -p run has none, and there each redraw request is just another line of its output.
async function isDrawnTurn($: Dollar): Promise<boolean> {
  return (await $.session.surfaces()).length > 0 && (await read($, progress)).isRunning
}

function everySecond($: Dollar): Timer {
  return $.clock.every(1000, () => $.ui.invalidate('ui.render'))
}

function fields(e: object): Fields {
  return e as Fields
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function oneLine(value: string, max: number): string {
  const line = value
    .split('\n')
    .map(part => part.trim())
    .find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

// "Bash：Show working tree status", "Read：register.tsx", "codegraph_explore：AuthService".
function describe(tool: string, input: Fields): string {
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') : tool
  const file = text(input.file_path) ?? text(input.notebook_path)
  const detail =
    text(input.description) ??
    (file === undefined ? undefined : basename(file)) ??
    text(input.command) ??
    text(input.pattern) ??
    text(input.query) ??
    text(input.skill) ??
    text(input.url)
  return detail === undefined ? name : `${name}：${oneLine(detail, 40)}`
}

// The classifier's category when the auto-mode classifier denied the call.
function denial(ran: ToolCallResult): string | undefined {
  const said = ran.deny ?? (ran.isError === true ? ran.text : undefined)
  if (said === undefined || !DENIED.test(said)) return undefined
  return /Reason: \[([^\]]+)\]/.exec(said)?.[1] ?? '未注明'
}

function deniedItem(tool: string, input: Fields, label: string, reason: string): Omit<Item, 'id'> {
  const title = `分类器拦下（${reason}）：${label}`
  const command = text(input.command)
  if (command !== undefined && (tool === 'Bash' || tool === 'PowerShell')) {
    return { kind: 'run', title, command, shell: tool === 'Bash' ? 'bash' : 'PowerShell 7', source: 'classifier' }
  }
  const file = text(input.file_path) ?? text(input.notebook_path)
  const args = Object.fromEntries(Object.entries(input).filter(([key]) => !RESERVED.has(key)))
  return { kind: 'authorize', title, target: `${tool} ${file ?? oneLine(JSON.stringify(args), 200)}`, source: 'classifier' }
}

function isSame(one: Omit<Item, 'id'>, other: Omit<Item, 'id'>): boolean {
  return one.kind === other.kind && one.command === other.command && one.target === other.target
}

// A denied call becomes an item; the same call answered cleanly later (authorized in chat) settles that item.
async function follow($: Dollar, tool: string, input: Fields, label: string, ran: ToolCallResult): Promise<void> {
  const reason = denial(ran)
  if (reason !== undefined) {
    await addItem($, deniedItem(tool, input, label, reason))
    return
  }
  if (ran.deny !== undefined || ran.isError === true) return
  if (!(await read($, items)).some(one => one.source === 'classifier')) return
  const twin = deniedItem(tool, input, label, '')
  await update($, items, list => list.filter(one => !(one.source === 'classifier' && isSame(one, twin))))
}

async function addItem($: Dollar, item: Omit<Item, 'id'>): Promise<number> {
  const same = (await read($, items)).find(one => isSame(one, item))
  if (same !== undefined) return same.id
  const id = (await update($, nextId, n => n + 1)) - 1
  await update($, items, list => [...list, { ...item, id }])
  return id
}

// Removes the item; false when another press already took it.
async function take($: Dollar, id: number): Promise<boolean> {
  let isTaken = false
  await update($, items, list => {
    isTaken = list.some(one => one.id === id)
    return list.filter(one => one.id !== id)
  })
  return isTaken
}

function message(item: Item, how: Reply): string {
  const fence = item.shell === 'bash' ? 'bash' : 'powershell'
  const block = item.command === undefined ? '' : `\n\`\`\`${fence}\n${item.command}\n\`\`\``
  if (how === 'ran') return `第 ${item.id} 项我已经自己运行了，请核对结果：${block}`
  if (how === 'delegate') return `我授权你执行第 ${item.id} 项，只执行这一条：${block}`
  return `我授权第 ${item.id} 项：${item.target ?? item.title}。只做这一项。`
}

// Submits the text as the person's own words; the reason when it did not enter.
async function submit($: Dollar, said: string): Promise<string | undefined> {
  try {
    return (await $.prompt.submit({ text: said, asUser: true })).drop
  } catch (error) {
    return errorText(error)
  }
}

async function send($: Dollar, item: Item, how: Reply): Promise<void> {
  if (!(await take($, item.id))) return
  const failed = await submit($, message(item, how))
  if (failed === undefined) return
  await update($, items, list => [...list, item].sort((a, b) => a.id - b.id))
  $.ui.toast(`第 ${item.id} 项没发出去：${failed}`)
}

async function decide($: Dollar): Promise<void> {
  let wasDeciding = false
  await update($, isDeciding, value => {
    wasDeciding = value
    return false
  })
  if (!wasDeciding) return
  const failed = await submit($, '按照你的推荐执行。')
  if (failed === undefined) return
  await update($, isDeciding, () => true)
  $.ui.toast(`没发出去：${failed}`)
}

// The same once-only send as decide: the engine's scan needs each atom named where update takes it.
async function resume($: Dollar): Promise<void> {
  let couldResume = false
  await update($, canResume, value => {
    couldResume = value
    return false
  })
  if (!couldResume) return
  const failed = await submit($, RESUME)
  if (failed === undefined) return
  await update($, canResume, () => true)
  $.ui.toast(`没发出去：${failed}`)
}

async function ask($: Dollar): Promise<void> {
  let wasAsking = true
  await update($, isAsking, value => {
    wasAsking = value
    return true
  })
  if (wasAsking) return
  try {
    const reply = await $.model.fork({ prompt: FORK_PROMPT })
    const said = reply.isAnswered
      ? { text: reply.text.trim(), isError: false }
      : { text: `没问到：${forkFailure(reply)}`, isError: true }
    await update($, answer, () => said)
  } catch (error) {
    await update($, answer, () => ({ text: `没问到：${errorText(error)}`, isError: true }))
  } finally {
    await update($, isAsking, () => false)
  }
}

function forkFailure(reply: Exclude<ModelForkResult, { isAnswered: true }>): string {
  if (reply.reason === 'api-error') return `API 出错（HTTP ${reply.status ?? '无响应'}，${reply.error}）`
  if (reply.reason === 'nothing-to-fork') return '这个会话还没有可以接着问的回答'
  if (reply.reason === 'empty-reply') return '回答是空的'
  return '被中断了'
}

async function copy($: Dollar, value: string, surface: RenderSurface): Promise<void> {
  const copied = await $.ui.copy({ text: value, surface })
  if (copied.isCopied) return $.ui.toast('已复制')
  // This build gives a remote surface (the desktop app) no clipboard path: write the host's clipboard instead.
  const wrote = await $.process
    .run(['pwsh', '-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value $env:HANDOFF_STATUS_TEXT'], {
      env: { HANDOFF_STATUS_TEXT: value },
      timeoutMs: 15_000,
    })
    .then(
      ran => ran.exitCode === 0,
      () => false,
    )
  $.ui.toast(wrote ? '已复制' : `复制失败（${copied.reason}），请手动选中上面的命令`)
}

async function run($: Dollar, command: string): Promise<void> {
  await $.command.run({ command }).catch(error => $.ui.toast(`/${command} 没能运行：${errorText(error)}`))
}

function judge(e: TurnCompleteInput, tools: number, failure: Failure | undefined): Verdict {
  const base = {
    durationMs: e.durationMs,
    tools,
    model: e.usage?.model ?? null,
    unverified: null,
    isQuestion: false,
    stop: null,
  }
  if (e.reason === 'aborted') return { ...base, kind: 'aborted', note: null }
  if (e.reason === 'error') {
    // With no StopFailure before it the kind stays unknown: 继续 is offered, and the note shows what the error said.
    const stop = stopOf(failure?.error ?? 'unknown', failure?.said ?? e.answer)
    return { ...base, kind: 'error', note: oneLine(e.answer, 60) || null, stop }
  }
  if (e.reason === 'refusal') return { ...base, kind: 'refusal', note: e.refusal.explanation ?? e.refusal.category }
  return { ...base, kind: 'answer', note: null, unverified: unverified(e.answer), isQuestion: endsWithQuestion(e.answer) }
}

// The line naming what is unverified; under a heading such as "## 未验证", the line after it.
function unverified(answer: string): string | null {
  const lines = answer
    .split('\n')
    .map(line => line.replace(/^[\s#>*_`\-–•·]+|[\s*_`]+$/g, ''))
    .filter(Boolean)
  for (const [at, line] of lines.entries()) {
    if (!UNVERIFIED.test(line) || NONE_UNVERIFIED.test(line)) continue
    const heading = line.replace(/[:：]$/, '')
    const said = heading.length <= 6 ? (lines[at + 1] ?? heading) : line
    if (NOTHING.test(said)) continue
    return oneLine(said, 60)
  }
  return null
}

function endsWithQuestion(answer: string): boolean {
  const last =
    answer
      .split('\n')
      .map(line => line.replace(/[\s*_`]+$/, ''))
      .filter(Boolean)
      .at(-1) ?? ''
  return /[？?]$/.test(last)
}

// A rate limit whose text says the plan's limit was hit is a usage limit, with when it resets; any other error is
// the engine's kind as it named it.
function stopOf(error: string, said: string): Stop {
  if ((error === 'rate_limit' || error === 'unknown') && USAGE_LIMIT.test(said)) {
    return { error: 'usage_limit', resets: RESETS.exec(said)?.[1]?.trim() ?? null }
  }
  return { error, resets: null }
}

// What stopped the turn, in a few words; for a kind 继续 cannot get past, what to do first.
function stopHint(stop: Stop): string {
  switch (stop.error) {
    case 'overloaded':
      return 'API 过载'
    case 'rate_limit':
      return 'API 限流'
    case 'server_error':
      return 'API 服务端出错'
    case 'max_output_tokens':
      return '输出到了长度上限'
    case 'usage_limit':
      return `用量到了上限：${stop.resets === null ? '额度重置' : `${stop.resets} 重置`}后再继续`
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'verification_required':
    case 'cloud_credential_error':
      return '认证失败：先处理登录或密钥，再发消息继续'
    case 'billing_error':
    case 'account_on_hold':
      return '账单或账户受限：处理好再发消息继续'
    case 'invalid_request':
      return '请求被拒：直接继续多半还会失败'
    case 'model_not_found':
      return '找不到模型：换个模型再继续'
    default:
      return '错误未分类'
  }
}

// "（并行 2 个，已 3 分 12 秒）": the calls running beside the current one, and how long it has run once that is long
// enough to wonder about.
function aside(now: Progress, at: number): string {
  const ran = at - now.currentAt
  const notes = [now.parallel > 1 ? `并行 ${now.parallel} 个` : '', ran >= LONG_TOOL_MS ? `已 ${duration(ran)}` : '']
  const said = notes.filter(Boolean).join('，')
  return said === '' ? '' : `（${said}）`
}

function outcome(last: Verdict): string {
  if (last.kind === 'aborted') return '已中断'
  if (last.kind === 'error') return '出错结束'
  if (last.kind === 'refusal') return '模型拒绝'
  const head = last.isQuestion ? '在等你回答' : '已完成'
  return last.unverified === null ? head : `${head} · 有未验证项`
}

function headline(last: Verdict, open: number): string {
  if (last.kind !== 'answer') return `${outcome(last)}${last.note === null ? '' : `：${last.note}`}`
  if (open > 0) return `等你处理 ${open} 项`
  return last.isQuestion ? '在等你回答' : '已完成'
}

function tone(last: Verdict, open: number): 'error' | 'warning' | 'suggestion' | 'success' {
  if (last.kind === 'error' || last.kind === 'refusal') return 'error'
  if (last.kind === 'aborted' || open > 0) return 'warning'
  return last.isQuestion ? 'suggestion' : 'success'
}

function facts(last: Verdict, info: Meta | null): string {
  const parts = [`用时 ${duration(last.durationMs)}`, `工具 ${last.tools} 次`]
  const model = last.model ?? info?.configured
  if (model !== undefined) parts.push(info?.gateway == null ? model : `${model} @ ${info.gateway}`)
  if (info !== null) parts.push(`会话 ${info.session}`, info.cwd)
  return parts.join(' · ')
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
  return `${Math.floor(minutes / 60)} 时 ${String(minutes % 60).padStart(2, '0')} 分`
}

// Only the host: a base URL may carry credentials in its user part or query.
function hostOf(url: string): string {
  return /^[a-z][\w+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)/i.exec(url)?.[1] ?? '无法解析'
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The model's own tools answer when their hook fails, rather than leave the engine's bare failure; nothing changed.
function failed(what: string, error: HookFailure): ToolCallResult {
  const why = error.message === undefined ? error.kind : `${error.kind}: ${oneLine(error.message, 200)}`
  return { result: `${what}: handoff-status failed (${why}).` }
}
