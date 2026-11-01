// One step that waits on the person: a command to run themselves, or an action to authorize.
export type Item = {
  id: number
  kind: 'run' | 'authorize'
  title: string
  command?: string
  shell?: string
  target?: string
  source: 'classifier' | 'model'
}

// What the running main-loop turn is doing; the spinner row reads it.
export type Progress = {
  isRunning: boolean
  startedAt: number
  tools: number
  current: string | null
  // When the call named by `current` started.
  currentAt: number
  parallel: number
}

// Why an API error ended a turn: the engine's error kind (StopFailure's `error`), or `usage_limit` for a rate limit
// whose text says the plan's limit was hit, with when that resets.
export type Stop = { error: string; resets: string | null }

// How the last main-loop turn ended.
export type Verdict = {
  kind: 'answer' | 'aborted' | 'error' | 'refusal'
  note: string | null
  unverified: string | null
  isQuestion: boolean
  durationMs: number
  tools: number
  model: string | null
  stop: Stop | null
}

export type Meta = {
  session: string
  cwd: string
  gateway: string | null
  configured: string
}

export type Answer = { text: string; isError: boolean }

declare module 'claude-code' {
  interface PluginState {
    'handoff-status': {
      items: Item[]
      nextId: number
      progress: Progress
      verdict: Verdict | null
      meta: Meta | null
      answer: Answer | null
      isAsking: boolean
      isHidden: boolean
      isDeciding: boolean
      canResume: boolean
    }
  }
  // The tools this mod registers at session.start; the MCP entry the engine lays leaves them out.
  interface McpToolInputs {
    'mcp__handoff-status__hand_off': { kind: 'run' | 'authorize'; title: string; command?: string; shell?: string; target?: string }
    'mcp__handoff-status__close_handoff': { ids: number[] }
  }
}
