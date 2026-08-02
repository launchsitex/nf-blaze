/**
 * Provider-agnostic agent loop.
 * Talks only to `/providers` `call()` — never to a vendor SDK directly.
 */
import {
  stream,
  type CallResult,
  type MessageContent,
  type ToolCall,
  type UnifiedMessage,
  type Usage
} from '../providers'
import {
  executeTool,
  formatToolError,
  getToolDefinition,
  listToolDefinitions,
  createToolSession,
  ToolError,
  type ToolContext,
  type ScopeDeclaration
} from './tools'
import { coerceArgumentsToSchema } from '../providers'
import { systemPromptForProject } from './index'
import {
  resolveWorkMode,
  filterToolsForMode,
  isReadOnlyMode,
  isWriteToolName,
  modeSystemAppendix,
  type WorkMode,
  type WorkModeSelection
} from './intent'
import {
  COMPLETION_CONDITIONS,
  MAX_TSC_FAILED_ATTEMPTS,
  PROJECT_CHECK_TIMEOUT_MS,
  formatCompletionNudge,
  formatTscFileFixMessage,
  formatTscRegressMessage,
  formatTscUnresolvedForUser,
  groupTscErrorsByFile,
  pickNextTscFile,
  readProjectFile,
  requireUserProjectRoot,
  restoreFileSnapshots,
  runCompletionCheck,
  runTscCheck,
  snapshotProjectFile,
  type TscError
} from './completion_check'
import {
  correctAfterStream,
  correctToolArgsBeforeWrite,
  recordPreviewFirstTry
} from './correct'
import {
  formatSummaryForMain,
  runBrowserQaSubagent,
  shouldRunBrowserQa,
  type BrowserQaEvent
} from './browser_qa'
import {
  maybeCompactContext,
  spillToolResultToDisk
} from './context_compact'
import {
  formatRegressions,
  runHealthCheck,
  shouldRunHealthCheck,
  type Regression
} from './health'
import type { McpExternalTool } from './mcp/manager'

export const MAX_AGENT_ITERATIONS = 40

/**
 * תקרה קשיחה כוללת. תקרת ה-40 היא תקציב סבב «רך» — כשמגיעים אליה באמצע משימה
 * הלולאה ממשיכה אוטומטית (עם כיווץ הקשר ותזכורת מיקוד) במקום לעצור ולבקש
 * מהמשתמש לכתוב «המשך». עצירה אמיתית רק כאן.
 */
export const MAX_TOTAL_ITERATIONS = 160

export type AgentLoopStopReason =
  | 'completed'
  | 'max_iterations'
  | 'aborted'
  | 'error'
  | 'tsc_unresolved'

export interface AgentLoopParams {
  /** Model id chosen by the user (provider inferred by adapters) */
  model: string
  /** Latest user request */
  userMessage: string
  /**
   * Absolute path to the *user's* project folder (tools + tsc/build cwd).
   * Required — never defaults to process.cwd() or the NF-Blaze app root.
   */
  rootDir: string
  apiKey?: string
  /** Override system prompt (default: prompts/system.md) */
  systemPrompt?: string
  /** Prior unified history (without the new user message) */
  history?: UnifiedMessage[]
  /**
   * Work mode: `auto` detects via a fast model; ASK/PLAN/BUILD override.
   * Missing → ASK (no silent default to auto/BUILD).
   */
  workMode?: WorkModeSelection
  /** Soft round budget (default 40) — the loop auto-continues past it up to MAX_TOTAL_ITERATIONS */
  maxIterations?: number
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  onEvent?: (event: AgentLoopEvent) => void
  /**
   * Optional: reuse host live-preview URL (Electron).
   * Browser QA falls back to spawning Vite for rootDir when absent.
   */
  getPreviewUrl?: () => Promise<string | null>
  /** External tools (MCP servers) — available in every work mode */
  extraTools?: McpExternalTool[]
}

export interface AgentLoopResult {
  text: string
  messages: UnifiedMessage[]
  iterations: number
  stopReason: AgentLoopStopReason
  usage: Usage
  error?: string
  /** Scope declarations made during this request (for UI) */
  scopeHistory: ScopeDeclaration[]
  /** Remaining structured tsc errors when repair gave up */
  remainingTscErrors?: TscError[]
  /** Non-fatal check warnings (e.g. tsc/build timeout) */
  checkWarnings?: string[]
  /** Resolved work mode for this run */
  workMode?: WorkMode
  workModeSource?: 'manual' | 'auto'
  /** True when a write tool was attempted while in ASK/PLAN */
  modeBlockedWrites?: boolean
  /** «בסיס ירוק» — מה שעבד לפני הסבב ונשבר בו (דיווח בלבד) */
  regressions?: Regression[]
}

export type AgentLoopEvent =
  | {
      type: 'intent'
      mode: WorkMode
      source: 'manual' | 'auto'
    }
  | { type: 'iteration'; index: number }
  | { type: 'auto_continue'; round: number; iteration: number }
  | {
      type: 'tool_progress'
      name: string
      argChars: number
      pathHint?: string
      iteration: number
    }
  | { type: 'model'; result: CallResult; iteration: number }
  | { type: 'model_delta'; delta: string; iteration: number }
  | { type: 'tool_start'; toolCall: ToolCall; iteration: number }
  | {
      type: 'tool_end'
      toolCall: ToolCall
      content: string
      isError: boolean
      iteration: number
    }
  | {
      type: 'scope'
      declaration: ScopeDeclaration
      allScoped: string[]
      iteration: number
    }
  | {
      type: 'completion_blocked'
      missing: string
      detail?: string
      nudge: string
      iteration: number
    }
  | {
      type: 'tsc_fix'
      file: string
      errors: TscError[]
      attempt: number
      iteration: number
    }
  | {
      type: 'tsc_reverted'
      file: string
      previousCount: number
      newCount: number
      failedAttempts: number
      iteration: number
    }
  | {
      type: 'tsc_unresolved'
      errors: TscError[]
      summary: string
      iteration: number
    }
  | { type: 'check_warning'; message: string; iteration: number }
  | {
      type: 'context_compact'
      beforePercent: number
      afterPercent: number
      beforeTokens: number
      afterTokens: number
      contextWindow: number
      iteration: number
    }
  | {
      type: 'browser_qa'
      phase: BrowserQaEvent['phase']
      attempt: number
      message: string
      url?: string
      action?: string
      summary?: string
      works?: string[]
      broken?: string[]
      iteration: number
    }
  | {
      type: 'health'
      phase: 'ok' | 'regressed' | 'skipped'
      message: string
      regressions?: Regression[]
      iteration: number
    }
  | { type: 'done'; result: AgentLoopResult }

interface TscRepairState {
  /** Errors from last tsc run */
  errors: TscError[]
  /** File currently being fixed (one file per round) */
  currentFile: string
  /** Error count before the current fix attempt */
  baselineCount: number
  /** Snapshots taken before the current fix attempt */
  snapshots: Map<string, string>
  /** Number of failed fix attempts (regress or no progress after write) */
  failedAttempts: number
  /** Waiting for the agent to apply a fix via tools */
  awaitingFix: boolean
}

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

function addUsage(a: Usage, b: Usage): Usage {
  const cacheReadTokens = (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0)
  const cacheWriteTokens = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0)
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {})
  }
}

function textUserMessage(text: string): UnifiedMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantFromModel(result: CallResult): UnifiedMessage {
  const content: MessageContent[] = []
  if (result.text?.trim()) {
    content.push({ type: 'text', text: result.text })
  }
  for (const tc of result.toolCalls) {
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments ?? {},
      // Gemini 3 מחייב את חתימת החשיבה כשה-functionCall מוחזר בהיסטוריה
      ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {})
    })
  }
  if (!content.length) {
    content.push({ type: 'text', text: '' })
  }
  return { role: 'assistant', content }
}

function toolResultsMessage(
  results: Array<{ toolCall: ToolCall; content: string; isError: boolean }>
): UnifiedMessage {
  return {
    role: 'tool',
    content: results.map((r) => ({
      type: 'tool_result' as const,
      toolCallId: r.toolCall.id,
      name: r.toolCall.name,
      content: r.content,
      isError: r.isError
    }))
  }
}

async function runOneTool(
  toolCall: ToolCall,
  ctx: ToolContext,
  mode: WorkMode,
  extra?: Map<string, McpExternalTool>
): Promise<{ content: string; isError: boolean; modeBlocked?: boolean }> {
  // כלי MCP חיצוני — רץ ישירות, בלי חסימת מצב (המשתמש בחר לחבר את השרת)
  const external = extra?.get(toolCall.name)
  if (external) {
    try {
      return await external.execute(toolCall.arguments ?? {})
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        isError: true
      }
    }
  }
  if (isReadOnlyMode(mode) && isWriteToolName(toolCall.name)) {
    return {
      content: `[mode_forbidden] כלי ${toolCall.name} לא זמין במצב ${mode}. רק read_file / list_dir / grep.`,
      isError: true,
      modeBlocked: true
    }
  }
  try {
    let args = toolCall.arguments ?? {}
    // כשל אופייני של GPT: הכלי הנכון עם שם/טיפוס פרמטר שגוי. מתקנים
    // רק מה שחד-משמעי, לפני שהכלי נכשל ומבזבז סבב.
    const definition = getToolDefinition(toolCall.name)
    if (definition) {
      args = coerceArgumentsToSchema(args, definition.parameters)
      toolCall.arguments = args
    }
    // Phase A (+ light JSX): correct model output before disk / UI ever see it
    if (toolCall.name === 'write_file' || toolCall.name === 'edit_file') {
      const corrected = correctToolArgsBeforeWrite(ctx.rootDir, {
        ...toolCall,
        arguments: args
      })
      args = corrected.arguments
      // Keep in-memory toolCall aligned so snapshots / tracking use corrected content
      toolCall.arguments = args
    }
    const result = await executeTool(toolCall.name, args, ctx)
    if (result.ok) {
      return { content: result.content, isError: false }
    }
    return {
      content: formatToolError(result.error, result.code),
      isError: true
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { content: formatToolError(err.message, err.code), isError: true }
    }
    return {
      content: err instanceof Error ? err.message : String(err),
      isError: true
    }
  }
}

function lastAssistantText(messages: UnifiedMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const text = m.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim()
    if (text) return text
  }
  return ''
}

function trackWrittenPath(
  toolCall: ToolCall,
  isError: boolean,
  writtenPaths: Set<string>
): void {
  if (isError) return
  if (toolCall.name !== 'edit_file' && toolCall.name !== 'write_file') return
  const path = toolCall.arguments?.path
  if (typeof path === 'string' && path.trim()) {
    writtenPaths.add(path.replace(/\\/g, '/').replace(/^\.\//, ''))
  }
}

function buildTscFixPrompt(rootDir: string, state: TscRepairState): string {
  const byFile = groupTscErrorsByFile(state.errors)
  const fileErrors = byFile.get(state.currentFile) ?? []
  const content = readProjectFile(rootDir, state.currentFile) ?? ''
  return formatTscFileFixMessage({
    file: state.currentFile,
    errors: fileErrors,
    content
  })
}

/**
 * Run the tool-calling agent loop against the unified provider `call()` adapter.
 *
 * 1. `call({ model, system, messages, tools })`
 * 2. If `toolCalls` — execute tools, append results, continue
 * 3. If no tool calls — run completion gate; tsc failures enter structured one-file repair
 * 4. After each fix batch — re-run tsc; revert if error count rose; stop after 3 failed attempts
 * 5. Soft round budget of 40 iterations — auto-continues with a focus nudge; hard cap 160
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  /** תקציב סבב רך — בקצהו ממשיכים אוטומטית, לא עוצרים */
  const roundBudget = Math.min(
    Math.max(1, params.maxIterations ?? MAX_AGENT_ITERATIONS),
    MAX_AGENT_ITERATIONS
  )
  const maxIterations = MAX_TOTAL_ITERATIONS
  /** User project only — never the NF-Blaze app cwd */
  const projectRoot = requireUserProjectRoot(params.rootDir)
  const checkTimeoutMs = PROJECT_CHECK_TIMEOUT_MS

  const resolved = await resolveWorkMode({
    // Missing → ASK (no silent default to auto/BUILD)
    selection: params.workMode,
    userMessage: params.userMessage,
    model: params.model,
    apiKey: params.apiKey,
    signal: params.signal
  })
  const workMode = resolved.mode
  const workModeSource = resolved.source

  const system = (
    systemPromptForProject(projectRoot, params.systemPrompt).trim() +
    modeSystemAppendix(workMode)
  ).trim()
  const extraToolsMap = new Map<string, McpExternalTool>(
    (params.extraTools ?? []).map((t) => [t.definition.name, t])
  )
  const tools = [
    ...filterToolsForMode(listToolDefinitions(), workMode),
    // כלי MCP זמינים בכל מצב — המשתמש חיבר אותם במפורש
    ...Array.from(extraToolsMap.values(), (t) => t.definition)
  ]
  const toolCtx: ToolContext = {
    rootDir: projectRoot,
    session: createToolSession()
  }
  const writtenPaths = new Set<string>()
  let tscRepair: TscRepairState | null = null
  // Wrapping the read in a function breaks TS's cross-await control-flow narrowing,
  // which otherwise collapses `tscRepair` to `never` inside this loop (it's reassigned
  // from several closures below, so narrowing can't safely survive an `await`).
  const getTscRepair = (): TscRepairState | null => tscRepair
  /** True if this request entered structured tsc repair (not first-try clean) */
  let enteredTscRepair = false
  /** Browser QA attempts this request (max 2) */
  let browserQaAttempts = 0
  let compactCount = 0
  const checkWarnings: string[] = []
  let modeBlockedWrites = false

  const messages: UnifiedMessage[] = [
    ...(params.history ?? []),
    textUserMessage(params.userMessage.trim())
  ]

  let usage = emptyUsage()
  let iterations = 0
  let lastToolProgressAt = 0
  const emit = (event: AgentLoopEvent): void => {
    params.onEvent?.(event)
  }

  emit({ type: 'intent', mode: workMode, source: workModeSource })

  const noteWarnings = (warnings: string[] | undefined, iteration: number): void => {
    if (!warnings?.length) return
    for (const message of warnings) {
      checkWarnings.push(message)
      emit({ type: 'check_warning', message, iteration })
    }
  }

  const openTasksForCompact = (): string[] => {
    const tasks: string[] = []
    if (tscRepair?.awaitingFix) {
      tasks.push(`תיקון tsc ב-${tscRepair.currentFile}`)
    }
    if (browserQaAttempts === 1) {
      tasks.push('ממתין לתיקון אחרי בדיקת דפדפן')
    }
    return tasks
  }

  /** Between completed rounds only — never mid tool batch / open tsc repair */
  const tryCompactBetweenRounds = (iteration: number): void => {
    const taskOpen = Boolean(tscRepair?.awaitingFix)
    const result = maybeCompactContext({
      messages,
      system,
      modelId: params.model,
      rootDir: projectRoot,
      writtenPaths: Array.from(writtenPaths),
      workMode,
      openTasks: openTasksForCompact(),
      taskOpen
    })
    if (!result.compacted) return
    messages.length = 0
    messages.push(...result.messages)
    compactCount += 1
    emit({
      type: 'context_compact',
      beforePercent: result.percentBefore,
      afterPercent: result.percentAfter,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      contextWindow: result.contextWindow,
      iteration
    })
  }

  const finish = (
    partial: Omit<
      AgentLoopResult,
      | 'messages'
      | 'usage'
      | 'scopeHistory'
      | 'checkWarnings'
      | 'workMode'
      | 'workModeSource'
      | 'modeBlockedWrites'
    > & {
      usage?: Usage
      remainingTscErrors?: TscError[]
    }
  ): AgentLoopResult => {
    // KPI: % of BUILD requests with working preview on first try
    if (writtenPaths.size > 0) {
      const success = partial.stopReason === 'completed'
      recordPreviewFirstTry(projectRoot, {
        success,
        firstTry: success && !enteredTscRepair,
        stopReason: partial.stopReason,
        writtenFiles: writtenPaths.size
      })
    }

    const result: AgentLoopResult = {
      text: partial.text,
      messages,
      iterations: partial.iterations,
      stopReason: partial.stopReason,
      usage: partial.usage ?? usage,
      error: partial.error,
      scopeHistory: [...(toolCtx.session?.scopeHistory ?? [])],
      remainingTscErrors: partial.remainingTscErrors,
      checkWarnings: checkWarnings.length ? [...checkWarnings] : undefined,
      workMode,
      workModeSource,
      modeBlockedWrites: modeBlockedWrites || undefined,
      regressions: partial.regressions?.length ? partial.regressions : undefined
    }
    emit({ type: 'done', result })
    return result
  }

  /**
   * «בסיס ירוק» — משווה את מצב האפליקציה למצב האחרון הידוע כתקין.
   * שלב א': מדווח בלבד. לעולם לא מכשיל את הבקשה ולא משנה קבצים.
   */
  const runHealthStep = async (
    iteration: number
  ): Promise<Regression[] | undefined> => {
    if (
      !shouldRunHealthCheck({
        workMode,
        writtenPaths: Array.from(writtenPaths)
      })
    ) {
      return undefined
    }

    let outcome: Awaited<ReturnType<typeof runHealthCheck>>
    try {
      outcome = await runHealthCheck({
        rootDir: projectRoot,
        writtenPaths: Array.from(writtenPaths),
        getPreviewUrl: params.getPreviewUrl,
        signal: params.signal
      })
    } catch {
      return undefined
    }

    if (outcome.skipped) {
      // כשל תשתיתי — בשקט, בלי להפחיד את המשתמש
      emit({
        type: 'health',
        phase: 'skipped',
        message: outcome.reason,
        iteration
      })
      return undefined
    }

    if (!outcome.regressions.length) {
      emit({
        type: 'health',
        phase: 'ok',
        message: outcome.firstRun
          ? `נרשם בסיס ירוק (${outcome.report.routes.length} מסכים)`
          : `הכול תקין (${outcome.report.routes.length} מסכים נבדקו)`,
        iteration
      })
      return undefined
    }

    emit({
      type: 'health',
      phase: 'regressed',
      message: formatRegressions(outcome.regressions),
      regressions: outcome.regressions,
      iteration
    })
    return outcome.regressions
  }

  const giveUpTsc = (errors: TscError[], iteration: number): AgentLoopResult => {
    const summary = formatTscUnresolvedForUser(errors)
    emit({ type: 'tsc_unresolved', errors, summary, iteration })
    return finish({
      text: summary,
      iterations: iteration,
      stopReason: 'tsc_unresolved',
      error: summary,
      remainingTscErrors: errors
    })
  }

  const startOrContinueTscRepair = (
    errors: TscError[],
    iteration: number,
    failedAttempts: number
  ): boolean => {
    if (!errors.length) {
      // tsc failed but no parseable errors — generic nudge, no raw log
      const nudge = formatCompletionNudge(COMPLETION_CONDITIONS.tsc)
      emit({
        type: 'completion_blocked',
        missing: COMPLETION_CONDITIONS.tsc,
        nudge,
        iteration
      })
      messages.push(textUserMessage(nudge))
      tscRepair = null
      return true
    }

    if (failedAttempts >= MAX_TSC_FAILED_ATTEMPTS) {
      return false
    }

    const file = pickNextTscFile(errors)
    if (!file) return false

    enteredTscRepair = true
    const snapshots = new Map<string, string>()
    snapshotProjectFile(projectRoot, file, snapshots)
    tscRepair = {
      errors,
      currentFile: file,
      baselineCount: errors.length,
      snapshots,
      failedAttempts,
      awaitingFix: true
    }

    const prompt = buildTscFixPrompt(projectRoot, tscRepair)
    emit({
      type: 'tsc_fix',
      file,
      errors: groupTscErrorsByFile(errors).get(file) ?? [],
      attempt: failedAttempts + 1,
      iteration
    })
    messages.push(textUserMessage(prompt))
    return true
  }

  try {
    for (let i = 1; i <= maxIterations; i++) {
      if (params.signal?.aborted) {
        return finish({
          text: lastAssistantText(messages),
          iterations,
          stopReason: 'aborted',
          error: 'aborted'
        })
      }

      iterations = i
      emit({ type: 'iteration', index: i })

      // קצה תקציב סבב באמצע משימה — ממשיכים אוטומטית (לא עוצרים ומבקשים «המשך»)
      if (i > 1 && (i - 1) % roundBudget === 0) {
        const round = Math.floor((i - 1) / roundBudget) + 1
        emit({ type: 'auto_continue', round, iteration: i })
        messages.push(
          textUserMessage(
            'המשך אוטומטי: הבקשה עדיין לא הושלמה במלואה. המשך לעבוד ברצף עד סיום מלא של מה שהמשתמש ביקש — עקוב אחרי התוכנית (update_plan), סמן שלבים שהושלמו, ואל תעצור באמצע. אם אתה נתקע על אותה בעיה שוב ושוב — נסה גישה אחרת.'
          )
        )
      }

      // Compact between completed rounds (incl. before first call if history is heavy)
      tryCompactBetweenRounds(i)

      // סטרימינג אמיתי — טקסט זורם למשתמש תוך כדי חשיבה, לא בבת אחת בסוף
      const modelResult = await stream(
        {
          model: params.model,
          system,
          messages,
          tools,
          apiKey: params.apiKey,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          signal: params.signal
        },
        (ev) => {
          if (ev.type === 'text' && ev.delta) {
            emit({ type: 'model_delta', delta: ev.delta, iteration: i })
          } else if (ev.type === 'tool_progress') {
            // נראות חיה בזמן כתיבת קבצים ארוכים — throttle כדי לא להציף את ה-UI
            const now = Date.now()
            if (now - lastToolProgressAt > 250) {
              lastToolProgressAt = now
              emit({
                type: 'tool_progress',
                name: ev.name,
                argChars: ev.argChars,
                pathHint: ev.pathHint,
                iteration: i
              })
            }
          }
        }
      )

      usage = addUsage(usage, modelResult.usage)
      emit({ type: 'model', result: modelResult, iteration: i })

      messages.push(assistantFromModel(modelResult))

      if (!modelResult.toolCalls.length) {
        // ASK / PLAN — no write tools; finish without completion/tsc gates
        if (isReadOnlyMode(workMode)) {
          return finish({
            text: modelResult.text?.trim() || lastAssistantText(messages),
            iterations,
            stopReason: 'completed'
          })
        }

        // Still in a tsc fix round with no tools = agent claimed done without fixing
        const repairSnapshot = getTscRepair()
        if (repairSnapshot?.awaitingFix) {
          const repair = repairSnapshot
          const again = await runTscCheck({
            rootDir: projectRoot,
            timeoutMs: checkTimeoutMs,
            signal: params.signal
          })
          if (again.warning) noteWarnings([again.warning], i)
          if (again.ok) {
            tscRepair = null
            // fall through to full completion check
          } else {
            repair.failedAttempts += 1
            repair.errors = again.errors
            if (repair.failedAttempts >= MAX_TSC_FAILED_ATTEMPTS) {
              return giveUpTsc(again.errors, i)
            }
            if (!startOrContinueTscRepair(again.errors, i, repair.failedAttempts)) {
              return giveUpTsc(again.errors, i)
            }
            continue
          }
        }

        // Phase B — after streaming/tools settle, before user-facing completion
        if (writtenPaths.size > 0) {
          correctAfterStream(projectRoot, Array.from(writtenPaths))
        }

        const gate = await runCompletionCheck({
          rootDir: projectRoot,
          writtenPaths: Array.from(writtenPaths),
          timeoutMs: checkTimeoutMs,
          signal: params.signal
        })

        if (gate.ok) {
          noteWarnings(gate.warnings, i)
        }

        if (!gate.ok) {
          if (
            (gate.missing === COMPLETION_CONDITIONS.tsc ||
              gate.missing === COMPLETION_CONDITIONS.build) &&
            gate.tscErrors
          ) {
            const attempts = getTscRepair()?.failedAttempts ?? 0
            if (attempts >= MAX_TSC_FAILED_ATTEMPTS) {
              return giveUpTsc(gate.tscErrors, i)
            }
            if (!startOrContinueTscRepair(gate.tscErrors, i, attempts)) {
              return giveUpTsc(gate.tscErrors, i)
            }
            continue
          }

          const nudge = formatCompletionNudge(gate.missing)
          emit({
            type: 'completion_blocked',
            missing: gate.missing,
            detail: gate.detail,
            nudge,
            iteration: i
          })
          messages.push(textUserMessage(nudge))
          continue
        }

        // Never report success while tsc still fails
        const finalTsc = await runTscCheck({
          rootDir: projectRoot,
          timeoutMs: checkTimeoutMs,
          signal: params.signal
        })
        if (finalTsc.warning) noteWarnings([finalTsc.warning], i)
        if (!finalTsc.ok && writtenPaths.size > 0) {
          const attempts = getTscRepair()?.failedAttempts ?? 0
          if (attempts >= MAX_TSC_FAILED_ATTEMPTS) {
            return giveUpTsc(finalTsc.errors, i)
          }
          if (!startOrContinueTscRepair(finalTsc.errors, i, attempts)) {
            return giveUpTsc(finalTsc.errors, i)
          }
          continue
        }

        tscRepair = null

        // Browser QA sub-agent — after successful build, when enough changed
        if (
          shouldRunBrowserQa({
            workMode,
            writtenPaths: Array.from(writtenPaths),
            attemptsUsed: browserQaAttempts
          })
        ) {
          browserQaAttempts += 1
          const qa = await runBrowserQaSubagent({
            rootDir: projectRoot,
            userMessage: params.userMessage,
            model: params.model,
            apiKey: params.apiKey,
            attempt: browserQaAttempts,
            writtenPaths: Array.from(writtenPaths),
            getPreviewUrl: params.getPreviewUrl,
            signal: params.signal,
            onEvent: (ev) => {
              emit({
                type: 'browser_qa',
                phase: ev.phase,
                attempt: ev.attempt,
                message: ev.message,
                url: ev.url,
                action: ev.action,
                summary: ev.summary,
                works: ev.works,
                broken: ev.broken,
                iteration: i
              })
            }
          })
          usage = addUsage(usage, qa.usage)

          const infraFailure =
            /תצוגה|Vite|node_modules|Playwright|Chromium|לא נמצאה|בוטל/i.test(
              qa.summary
            )

          if (
            !qa.ok &&
            browserQaAttempts < 2 &&
            qa.broken.length > 0 &&
            !infraFailure
          ) {
            // Main agent fixes once; second QA runs after next successful completion
            const summary = formatSummaryForMain(qa)
            messages.push(textUserMessage(summary))
            continue
          }

          const textBase =
            modelResult.text?.trim() || lastAssistantText(messages)
          // כשל תשתיתי (אין Chromium וכו') — מדלגים בשקט, לא מפחידים את המשתמש
          const qaNote = qa.skipped || (!qa.ok && infraFailure)
            ? ''
            : `\n\n---\nבדיקת דפדפן (${qa.attempt}/2): ${qa.ok ? 'עבר' : 'נמצאו בעיות'}\n${qa.summary}`
          return finish({
            text: `${textBase}${qaNote}`.trim(),
            iterations,
            stopReason: 'completed',
            regressions: await runHealthStep(i)
          })
        }

        return finish({
          text: modelResult.text?.trim() || lastAssistantText(messages),
          iterations,
          stopReason: 'completed',
          regressions: await runHealthStep(i)
        })
      }

      const toolOutcomes: Array<{
        toolCall: ToolCall
        content: string
        isError: boolean
      }> = []
      let wroteDuringRound = false

      for (const toolCall of modelResult.toolCalls) {
        if (params.signal?.aborted) {
          return finish({
            text: lastAssistantText(messages),
            iterations,
            stopReason: 'aborted',
            error: 'aborted'
          })
        }

        const isWrite =
          toolCall.name === 'edit_file' || toolCall.name === 'write_file'
        const repairForSnapshot = getTscRepair()
        if (repairForSnapshot && isWrite && typeof toolCall.arguments?.path === 'string') {
          snapshotProjectFile(projectRoot, toolCall.arguments.path, repairForSnapshot.snapshots)
        }

        emit({ type: 'tool_start', toolCall, iteration: i })
        const outcome = await runOneTool(toolCall, toolCtx, workMode, extraToolsMap)
        if (outcome.modeBlocked) modeBlockedWrites = true
        trackWrittenPath(toolCall, outcome.isError, writtenPaths)
        if (isWrite && !outcome.isError) wroteDuringRound = true
        const spilled = spillToolResultToDisk(
          projectRoot,
          toolCall.name,
          outcome.content
        )
        toolOutcomes.push({
          toolCall,
          content: spilled.content,
          isError: outcome.isError
        })
        emit({
          type: 'tool_end',
          toolCall,
          content: spilled.content,
          isError: outcome.isError,
          iteration: i
        })
        if (
          toolCall.name === 'declare_scope' &&
          !outcome.isError &&
          toolCtx.session &&
          toolCtx.session.scopeHistory.length > 0
        ) {
          const declaration =
            toolCtx.session.scopeHistory[toolCtx.session.scopeHistory.length - 1]!
          emit({
            type: 'scope',
            declaration,
            allScoped: Array.from(toolCtx.session.scopedPaths).sort(),
            iteration: i
          })
        }
      }

      messages.push(toolResultsMessage(toolOutcomes))

      // Phase B after each write round — providers / deps / AST before next model turn or preview
      if (wroteDuringRound) {
        correctAfterStream(projectRoot, Array.from(writtenPaths))
      }

      // Round completed (tools done) — compact before the next model turn if needed
      tryCompactBetweenRounds(i)

      // After each fix batch: re-run tsc; revert if error count rose
      const repairRoundSnapshot = getTscRepair()
      if (repairRoundSnapshot?.awaitingFix && wroteDuringRound) {
        const repair = repairRoundSnapshot
        const after = await runTscCheck({
          rootDir: projectRoot,
          timeoutMs: checkTimeoutMs,
          signal: params.signal
        })
        if (after.warning) noteWarnings([after.warning], i)
        const prevCount = repair.baselineCount

        if (after.ok) {
          tscRepair = null
          continue
        }

        if (after.count > prevCount) {
          restoreFileSnapshots(projectRoot, repair.snapshots)
          repair.failedAttempts += 1
          emit({
            type: 'tsc_reverted',
            file: repair.currentFile,
            previousCount: prevCount,
            newCount: after.count,
            failedAttempts: repair.failedAttempts,
            iteration: i
          })

          // Re-run after restore to get current errors
          const restored = await runTscCheck({
            rootDir: projectRoot,
            timeoutMs: checkTimeoutMs,
            signal: params.signal
          })
          if (restored.warning) noteWarnings([restored.warning], i)
          const errors = restored.ok ? [] : restored.errors
          repair.errors = errors.length ? errors : after.errors
          repair.baselineCount = errors.length ? errors.length : prevCount
          repair.snapshots = new Map()
          snapshotProjectFile(projectRoot, repair.currentFile, repair.snapshots)

          if (repair.failedAttempts >= MAX_TSC_FAILED_ATTEMPTS) {
            return giveUpTsc(repair.errors, i)
          }

          const byFile = groupTscErrorsByFile(repair.errors)
          const fileErrors = byFile.get(repair.currentFile) ?? repair.errors
          const content = readProjectFile(projectRoot, repair.currentFile) ?? ''
          messages.push(
            textUserMessage(
              [
                formatTscRegressMessage(),
                '',
                formatTscFileFixMessage({
                  file: repair.currentFile,
                  errors: fileErrors.slice(0, 50),
                  content
                })
              ].join('\n')
            )
          )
          emit({
            type: 'tsc_fix',
            file: repair.currentFile,
            errors: fileErrors,
            attempt: repair.failedAttempts + 1,
            iteration: i
          })
          continue
        }

        // Improved or same count — move on: update state for next file round
        if (after.count < prevCount) {
          repair.errors = after.errors
          repair.baselineCount = after.count
          repair.snapshots = new Map()
          repair.awaitingFix = false

          const nextFile = pickNextTscFile(after.errors)
          if (nextFile) {
            repair.currentFile = nextFile
            snapshotProjectFile(projectRoot, nextFile, repair.snapshots)
            repair.awaitingFix = true
            const prompt = buildTscFixPrompt(projectRoot, repair)
            emit({
              type: 'tsc_fix',
              file: nextFile,
              errors: groupTscErrorsByFile(after.errors).get(nextFile) ?? [],
              attempt: repair.failedAttempts + 1,
              iteration: i
            })
            messages.push(textUserMessage(prompt))
          } else {
            tscRepair = null
          }
        } else {
          // Same error count after a write — count as failed attempt, try another approach
          repair.failedAttempts += 1
          repair.errors = after.errors
          repair.snapshots = new Map()
          snapshotProjectFile(projectRoot, repair.currentFile, repair.snapshots)

          if (repair.failedAttempts >= MAX_TSC_FAILED_ATTEMPTS) {
            return giveUpTsc(after.errors, i)
          }

          messages.push(
            textUserMessage(
              [
                'מספר השגיאות לא ירד. נסה גישה אחרת.',
                '',
                buildTscFixPrompt(projectRoot, repair)
              ].join('\n')
            )
          )
          emit({
            type: 'tsc_fix',
            file: repair.currentFile,
            errors:
              groupTscErrorsByFile(after.errors).get(repair.currentFile) ??
              after.errors,
            attempt: repair.failedAttempts + 1,
            iteration: i
          })
        }
      }
    }

    // Hit max iterations — never report success if tsc still broken
    if (writtenPaths.size > 0) {
      const last = await runTscCheck({
        rootDir: projectRoot,
        timeoutMs: checkTimeoutMs,
        signal: params.signal
      })
      if (last.warning) noteWarnings([last.warning], iterations)
      if (!last.ok) {
        return giveUpTsc(last.errors, iterations)
      }
    }

    return finish({
      text: lastAssistantText(messages),
      iterations,
      stopReason: 'max_iterations',
      error: `הגעת לתקרת ${maxIterations} איטרציות`
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return finish({
      text: lastAssistantText(messages),
      iterations,
      stopReason: 'error',
      error: message
    })
  }
}
