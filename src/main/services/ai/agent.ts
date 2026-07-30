import { v4 as uuidv4 } from 'uuid'
import { existsSync } from 'fs'
import { join } from 'path'
import type {
  AiProvider,
  ChatMessage,
  ProjectMeta,
  SendChatResult,
  AgentFileAction,
  AgentStreamEvent,
  WorkMode,
  WorkModeSelection
} from '../../../shared/types'
import {
  getModelContextWindow,
  coerceWorkModeSelection,
  isReadOnlyWorkMode
} from '../../../shared/types'
import { buildAgentSystemPrompt } from '../../../shared/prompts'
import {
  buildContextUsage,
  estimateTokens,
  type ContextUsage
} from '../../../shared/context'
import { getApiKey } from '../secrets'
import { loadChat, saveChat, getProject, saveProject, loadSettingsRaw } from '../storage'
import {
  buildFileTree,
  summarizeTree,
  writeProjectFile,
  deleteProjectFile,
  ensureDir,
  readProjectFile,
  resolveSafePath
} from '../filesystem'
import { createSnapshot } from '../snapshots'
import { runAllowlistedShell } from '../shell'
import { callLlm, parseAgentResponse, stripActionBlocksForDisplay, sanitizeHistoryContentForReadOnly, type LlmMessage } from './llm'
import { loadIntegrations } from '../integrations/store'
import { getSupabaseContextForAgent } from '../integrations/supabase'
import { sendChatMessageNew } from './agent_bridge'
import {
  abortChat,
  registerChatAbort,
  clearChatAbort,
  type StreamEmitter
} from './agent_controllers'
import {
  formatProjectRulesBlock,
  isTemplateConfigPath,
  userRequestedConfigChange
} from '../templates'
import { formatSelectedElementsContext } from '../preview-select'
import type { PreviewElementSelection } from '../../../shared/types'
import {
  resolveWorkMode,
  pickFastIntentModelForProvider
} from '../../../../agent/intent'

export type { StreamEmitter }
export { abortChat }

const MAX_HISTORY = 28
const MAX_FILE_CONTEXT = 12
const MAX_FILE_BYTES = 40000
/** Leave headroom for the model reply */
const CONTEXT_REPLY_RESERVE = 0.18

const KEY_FILES = [
  'PROJECT_RULES.md',
  'package.json',
  'index.html',
  'src/main.tsx',
  'src/main.jsx',
  'src/App.tsx',
  'src/App.jsx',
  'src/index.css',
  'app/page.tsx',
  'app/layout.tsx',
  'README.md'
]

/** Never send secrets into the LLM context */
const SECRET_FILE_RE =
  /(^|\/)\.env(\.|$)|(^|\/)\.env\.|credentials\.(json|txt)$|secrets?\.(json|ya?ml)$|id_rsa|\.pem$/i

function isSecretPath(rel: string): boolean {
  return SECRET_FILE_RE.test(normalizeRel(rel))
}

const PROTECTED_DELETE_PREFIXES = ['.nf-blaze/', '.git/', 'node_modules/']
const CRITICAL_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.env',
  '.env.local',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'electron.vite.config.ts'
])

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

function userRequestedDelete(message: string): boolean {
  return /מחק|הסר|מחיקה|delete|remove|unlink/i.test(message)
}

function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (err instanceof Error) {
    return err.name === 'AbortError' || /abort/i.test(err.message)
  }
  return false
}

export async function sendChatMessage(
  params: {
    projectId: string
    message: string
    provider: AiProvider
    model: string
    /** File currently open in the editor — Cursor-like context */
    activeFile?: string | null
    workMode?: WorkModeSelection
    selectedElements?: PreviewElementSelection[] | null
  },
  emit?: StreamEmitter
): Promise<SendChatResult> {
  const settings = loadSettingsRaw()
  if (settings.agentEngine === 'new') {
    return sendChatMessageNew(params, emit)
  }

  const notify: StreamEmitter = emit || (() => undefined)

  // Cancel any previous run for this project
  const controller = new AbortController()
  registerChatAbort(params.projectId, controller)

  const project = getProject(params.projectId)
  if (!project) {
    clearChatAbort(params.projectId)
    throw new Error('הפרויקט לא נמצא')
  }

  // המנוע הישן תומך רק ב-OpenAI/Anthropic/Gemini — ספקים חדשים דורשים את המנוע החדש
  if (
    params.provider !== 'openai' &&
    params.provider !== 'anthropic' &&
    params.provider !== 'gemini'
  ) {
    clearChatAbort(params.projectId)
    throw new Error(
      `הספק ${params.provider} נתמך רק במנוע הסוכן החדש. עבור בהגדרות ל«מנוע חדש».`
    )
  }
  const legacyProvider = params.provider

  const apiKey = getApiKey(params.provider)
  if (!apiKey) {
    clearChatAbort(params.projectId)
    throw new Error(
      `לא הוגדר מפתח API עבור ${params.provider}. היכנס להגדרות והוסף מפתח.`
    )
  }

  // Layer 1: missing mode → ASK; auto → real fast-model intent (manual always wins)
  const selection = coerceWorkModeSelection(params.workMode)
  const fastIntentModel = pickFastIntentModelForProvider(legacyProvider)
  const resolved = await resolveWorkMode({
    selection,
    userMessage: params.message,
    model: fastIntentModel,
    apiKey,
    signal: controller.signal,
    complete: async ({ system, user, model, signal }) =>
      callLlm({
        provider: params.provider,
        model,
        apiKey,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        maxTokens: 64,
        signal
      })
  })
  const workMode: WorkMode = resolved.mode
  const workModeSource = resolved.source
  notify({ type: 'intent', mode: workMode, source: workModeSource })

  notify({
    type: 'status',
    step: 'prepare',
    message:
      workModeSource === 'auto'
        ? `מצב שזוהה: ${workMode} · קורא את מבנה הפרויקט…`
        : 'קורא את מבנה הפרויקט…'
  })

  const session = loadChat(params.projectId)
  const elementCtx = formatSelectedElementsContext(params.selectedElements)
  const activeFromElement = params.selectedElements?.find((e) => e.file)?.file || null
  const effectiveActive = params.activeFile || activeFromElement
  const userContent = elementCtx
    ? `${params.message.trim()}\n\n${elementCtx}`
    : params.message.trim()
  const userMsg: ChatMessage = {
    id: uuidv4(),
    role: 'user',
    content: userContent,
    createdAt: new Date().toISOString(),
    workMode,
    workModeSource
  }
  session.messages.push(userMsg)

  const tree = buildFileTree(project.folderPath)
  const treeSummary = summarizeTree(tree)

  notify({ type: 'status', step: 'context', message: 'אוסף הקשר קבצים כמו Cursor…' })

  let extraContext = ''
  const toLoad = new Set<string>()

  // Key project files (existence check only)
  for (const kf of KEY_FILES) {
    try {
      if (existsSync(resolveSafePath(project.folderPath, kf))) toLoad.add(kf)
    } catch {
      /* outside / missing */
    }
  }

  // Active file in editor (or file from preview element pick)
  if (effectiveActive) toLoad.add(effectiveActive.replace(/\\/g, '/'))

  // Mentioned paths
  for (const rel of extractMentionedPaths(params.message, tree)) {
    toLoad.add(rel)
  }

  // Recent files from last assistant message
  const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant')
  for (const f of lastAssistant?.filesChanged?.slice(0, 4) || []) {
    toLoad.add(f)
  }

  let loaded = 0
  for (const rel of Array.from(toLoad)) {
    if (loaded >= MAX_FILE_CONTEXT) break
    if (isSecretPath(rel)) continue
    try {
      const content = readProjectFile(project.folderPath, rel)
      if (content.length > MAX_FILE_BYTES) {
        extraContext += `\n\n--- קובץ: ${rel} (חתוך) ---\n${content.slice(0, MAX_FILE_BYTES)}\n…\n`
      } else {
        extraContext += `\n\n--- קובץ: ${rel} ---\n${content}\n`
      }
      loaded++
    } catch {
      /* skip */
    }
  }

  let activeFileContext = ''
  if (elementCtx) {
    activeFileContext = `\n${elementCtx}\n`
  }
  if (effectiveActive && !isSecretPath(effectiveActive)) {
    activeFileContext += `\n## קובץ פתוח בעורך\nהמשתמש צופה/עורך כרגע: \`${effectiveActive}\`\nעדיפות גבוהה לערוך אותו עם edit אם הבקשה קשורה אליו.\n`
  } else if (effectiveActive && isSecretPath(effectiveActive)) {
    activeFileContext +=
      '\n## קובץ פתוח בעורך\nהקובץ הפתוח מכיל סודות — התוכן לא נשלח למודל. אל תבקש/תדפיס מפתחות.\n'
  }

  const integrationsPrompt = buildIntegrationsPrompt(params.projectId)
  const projectRules = formatProjectRulesBlock(project.folderPath)
  const system = buildAgentSystemPrompt(
    project.name,
    treeSummary,
    integrationsPrompt,
    activeFileContext,
    projectRules,
    workMode
  )

  const contextWindow = getModelContextWindow(params.model)
  const budget = Math.floor(contextWindow * (1 - CONTEXT_REPLY_RESERVE))
  const fixedTokens =
    estimateTokens(system) + estimateTokens(extraContext) + estimateTokens(activeFileContext)
  let historyLimit = MAX_HISTORY
  const chatMsgs = session.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  while (historyLimit > 6) {
    const slice = chatMsgs.slice(-historyLimit)
    const convTokens = slice.reduce((s, m) => s + estimateTokens(m.content), 0)
    if (fixedTokens + convTokens <= budget) break
    historyLimit = Math.max(6, historyLimit - 4)
  }

  const history: LlmMessage[] = [
    { role: 'system', content: system },
    ...chatMsgs.slice(-historyLimit).map((m) => {
      let content = m.content
      // ASK/PLAN: strip prior write-action blocks so the model does not imitate them
      if (isReadOnlyWorkMode(workMode) && m.role === 'assistant') {
        content = sanitizeHistoryContentForReadOnly(content)
      }
      return {
        role: m.role as 'user' | 'assistant',
        content
      }
    })
  ]

  if (extraContext) {
    history.push({
      role: 'user',
      content: `הקשר קבצים נוספים:${extraContext}`
    })
  }

  notify({
    type: 'status',
    step: 'think',
    message: `חושב עם ${params.model}…`
  })

  let raw = ''
  let lastDisplayed = ''
  let enteredActions = false

  try {
    let buffer = ''
    raw = await callLlm({
      provider: params.provider,
      model: params.model,
      apiKey,
      messages: history,
      signal: controller.signal,
      onToken: (chunk) => {
        buffer += chunk
        if (
          !enteredActions &&
          workMode === 'BUILD' &&
          /```nfblaze/i.test(buffer)
        ) {
          enteredActions = true
          notify({ type: 'status', step: 'actions', message: 'מכין פעולות על קבצים…' })
        }
        if (!enteredActions && /```clarify|"type"\s*:\s*"clarify"/i.test(buffer)) {
          notify({ type: 'status', step: 'clarify', message: 'מכין שאלות הבהרה…' })
        }
        const display = stripActionBlocksForDisplay(buffer)
        if (display.length > lastDisplayed.length) {
          const delta = display.slice(lastDisplayed.length)
          lastDisplayed = display
          if (delta) notify({ type: 'token', text: delta })
        }
      }
    })
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      const partial = stripActionBlocksForDisplay(raw || lastDisplayed).trim()
      const assistantAbort: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: partial
          ? `${partial}\n\n_(הופסק על ידי המשתמש)_`
          : 'היצירה הופסקה.',
        createdAt: new Date().toISOString(),
        aborted: true
      }
      session.messages.push(assistantAbort)
      saveChat(session)
      const result: SendChatResult = {
        assistantMessage: assistantAbort,
        actionsApplied: [],
        aborted: true
      }
      notify({ type: 'aborted' })
      notify({ type: 'done', result })
      clearChatAbort(params.projectId)
      return result
    }

    const errMsg = err instanceof Error ? err.message : String(err)
    notify({ type: 'error', message: errMsg })
    const assistantError: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: `שגיאה בקריאה למודל: ${errMsg}`,
      createdAt: new Date().toISOString(),
      error: true
    }
    session.messages.push(assistantError)
    saveChat(session)
    const result: SendChatResult = {
      assistantMessage: assistantError,
      actionsApplied: [],
      error: errMsg
    }
    notify({ type: 'done', result })
    clearChatAbort(params.projectId)
    return result
  }

  if (controller.signal.aborted) {
    const partial = stripActionBlocksForDisplay(raw || lastDisplayed).trim()
    const assistantAbort: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: partial
        ? `${partial}\n\n_(הופסק — שינויי קבצים לא הוחלו)_`
        : 'היצירה הופסקה לפני יישום קבצים.',
      createdAt: new Date().toISOString(),
      aborted: true
    }
    session.messages.push(assistantAbort)
    saveChat(session)
    const result: SendChatResult = {
      assistantMessage: assistantAbort,
      actionsApplied: [],
      aborted: true
    }
    notify({ type: 'aborted' })
    notify({ type: 'done', result })
    clearChatAbort(params.projectId)
    return result
  }

  const finalDisplay = stripActionBlocksForDisplay(raw)
  if (finalDisplay.length > lastDisplayed.length) {
    notify({ type: 'token', text: finalDisplay.slice(lastDisplayed.length) })
  }

  const parsed = parseAgentResponse(raw)
  if (controller.signal.aborted) {
    clearChatAbort(params.projectId)
    notify({ type: 'aborted' })
    const result: SendChatResult = {
      assistantMessage: {
        id: uuidv4(),
        role: 'assistant',
        content: 'הופסק לפני יישום קבצים.',
        createdAt: new Date().toISOString(),
        aborted: true,
        workMode,
        workModeSource
      },
      actionsApplied: [],
      aborted: true,
      workMode,
      workModeSource
    }
    session.messages.push(result.assistantMessage)
    saveChat(session)
    notify({ type: 'done', result })
    return result
  }

  // Clarify is not a write action — allow through even in ASK/PLAN.
  // If clarify + write together → ignore writes completely.
  const hasClarify = Boolean(parsed.clarify?.questions?.length)
  const proposedWrites = hasClarify
    ? []
    : parsed.actions.filter(
        (a) =>
          a.type === 'write' || a.type === 'edit' || a.type === 'delete' || a.type === 'mkdir'
      )
  const modeBlockedWrites =
    !hasClarify && isReadOnlyWorkMode(workMode) && proposedWrites.length > 0

  let applied: AgentFileAction[] = []
  let snapId: string | undefined
  let previewFile: string | undefined

  if (hasClarify) {
    notify({
      type: 'status',
      step: 'clarify',
      message: 'שאלות הבהרה — ממתין לתשובתך'
    })
  } else if (modeBlockedWrites) {
    notify({
      type: 'status',
      step: 'guard',
      message:
        workMode === 'PLAN'
          ? 'מצב תכנון — שינויי קבצים לא יושמו'
          : 'מצב שאלה — שינויי קבצים לא יושמו'
    })
  } else if (parsed.actions.length) {
    notify({ type: 'status', step: 'apply', message: 'מיישם שינויים בקבצים…' })
    const snap = createSnapshot(params.projectId, parsed.actions)
    snapId = snap?.id
    applied = applyActions(project, parsed.actions, notify, params.message, workMode)
    const htmlFromActions =
      applied.find((a) => a.type === 'write' && /\.html?$/i.test(a.path))?.path ||
      parsed.previewFile ||
      undefined
    previewFile = parsed.previewFile || htmlFromActions
  } else {
    previewFile = parsed.previewFile
  }

  // Auto npm install if package.json was written and node_modules missing
  const wrotePackage = applied.some(
    (a) => a.type === 'write' && (a.path === 'package.json' || a.path.endsWith('/package.json'))
  )
  if (wrotePackage && !existsSync(join(project.folderPath, 'node_modules'))) {
    notify({ type: 'status', step: 'npm', message: 'מריץ npm install…' })
    try {
      await runAllowlistedShell(
        { projectId: params.projectId, command: 'npm', args: ['install'] },
        (line, stream) => notify({ type: 'shell', line, stream }),
        controller.signal
      )
    } catch (err) {
      notify({
        type: 'status',
        step: 'npm',
        message: `npm install נכשל: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  const narrative = (
    stripActionBlocksForDisplay(finalDisplay).trim() ||
    (hasClarify ? '' : modeBlockedWrites ? '' : parsed.message) ||
    (applied.length ? 'הקבצים עודכנו בהצלחה.' : hasClarify ? '' : 'הושלם.')
  ).trim()
  const assistantMsg: ChatMessage = {
    id: uuidv4(),
    role: 'assistant',
    content: narrative || (hasClarify ? 'כמה שאלות קצרות לפני התוכנית:' : modeBlockedWrites ? '—' : 'הושלם.'),
    createdAt: new Date().toISOString(),
    filesChanged: applied.length ? applied.map((a) => a.path) : undefined,
    workMode,
    workModeSource,
    modeBlockedWrites: modeBlockedWrites || undefined,
    clarify: parsed.clarify
  }
  session.messages.push(assistantMsg)
  saveChat(session)

  const updated: ProjectMeta = {
    ...project,
    provider: params.provider,
    model: params.model,
    updatedAt: new Date().toISOString(),
    lastPreviewFile: previewFile || project.lastPreviewFile
  }
  saveProject(updated)

  const result: SendChatResult = {
    assistantMessage: assistantMsg,
    actionsApplied: applied,
    previewFile,
    snapshotId: snapId,
    workMode,
    workModeSource,
    modeBlockedWrites: modeBlockedWrites || undefined
  }

  notify({
    type: 'status',
    step: 'done',
    message: hasClarify
      ? 'ממתין לתשובות הבהרה'
      : modeBlockedWrites
        ? 'הושלם — שינויים לא יושמו (מצב קריאה)'
        : applied.length
          ? `הושלם — עודכנו ${applied.length} קבצים`
          : 'הושלם'
  })
  notify({ type: 'done', result })
  clearChatAbort(params.projectId)
  return result
}

function applyActions(
  project: ProjectMeta,
  actions: AgentFileAction[],
  emit: StreamEmitter,
  userMessage = '',
  workMode: WorkMode = 'BUILD'
): AgentFileAction[] {
  // Hard enforcement: ASK/PLAN never write to disk
  if (isReadOnlyWorkMode(workMode)) {
    if (actions.length) {
      emit({
        type: 'status',
        step: 'guard',
        message: `דילגתי על ${actions.length} פעולות — מצב ${workMode}`
      })
    }
    return []
  }

  const applied: AgentFileAction[] = []
  const allowDelete = userRequestedDelete(userMessage)

  for (const action of actions) {
    try {
      const rel = normalizeRel(action.path || '')
      if (!rel) continue

      if (
        (action.type === 'write' || action.type === 'edit' || action.type === 'delete') &&
        isTemplateConfigPath(rel) &&
        !userRequestedConfigChange(userMessage, rel)
      ) {
        emit({
          type: 'status',
          step: 'guard',
          message: `דילגתי על שינוי קובץ קונפיג מוגן (${rel}) — נדרשת בקשה מפורשת מהמשתמש`
        })
        continue
      }

      if (action.type === 'mkdir') {
        emit({ type: 'file', action: 'mkdir', path: rel })
        ensureDir(project.folderPath, rel)
        applied.push({ ...action, path: rel })
      } else if (action.type === 'write' && action.content !== undefined) {
        const content = action.content
        let existing = ''
        let exists = false
        try {
          resolveSafePath(project.folderPath, rel)
          exists = existsSync(resolveSafePath(project.folderPath, rel))
          if (exists) existing = readProjectFile(project.folderPath, rel)
        } catch {
          /* new path */
        }

        // Never wipe an existing file with empty / near-empty content
        if (exists && existing.trim().length > 40 && content.trim().length < 12) {
          emit({
            type: 'status',
            step: 'guard',
            message: `דילגתי על כתיבה ריקה ל-${rel} (הגנה מפני מחיקת תוכן)`
          })
          continue
        }

        // Block catastrophic shrink of critical / large files
        if (
          exists &&
          existing.length > 200 &&
          content.length < existing.length * 0.2 &&
          (CRITICAL_FILES.has(rel) || existing.length > 1500)
        ) {
          emit({
            type: 'status',
            step: 'guard',
            message: `דילגתי על שכתוב הרסני של ${rel} — השתמש ב-edit לשינוי ממוקד`
          })
          continue
        }

        emit({ type: 'file', action: 'write', path: rel })
        writeProjectFile(project.folderPath, rel, content)
        applied.push({ ...action, path: rel })
      } else if (
        action.type === 'edit' &&
        action.old_string !== undefined &&
        action.new_string !== undefined
      ) {
        emit({ type: 'file', action: 'edit', path: rel })
        const current = readProjectFile(project.folderPath, rel)
        const count = current.split(action.old_string).length - 1
        if (count === 0) {
          console.error('edit: old_string not found in', rel)
          emit({
            type: 'status',
            step: 'guard',
            message: `edit נכשל ב-${rel}: הטקסט הישן לא נמצא`
          })
          continue
        }
        if (count > 1) {
          console.error('edit: old_string not unique in', rel, 'count=', count)
          emit({
            type: 'status',
            step: 'guard',
            message: `edit נכשל ב-${rel}: הטקסט הישן לא ייחודי`
          })
          continue
        }
        const next = current.replace(action.old_string, action.new_string)
        writeProjectFile(project.folderPath, rel, next)
        applied.push({ ...action, path: rel })
      } else if (action.type === 'delete') {
        if (PROTECTED_DELETE_PREFIXES.some((p) => rel === p.slice(0, -1) || rel.startsWith(p))) {
          emit({
            type: 'status',
            step: 'guard',
            message: `דילגתי על מחיקת נתיב מוגן: ${rel}`
          })
          continue
        }
        if (CRITICAL_FILES.has(rel) && !allowDelete) {
          emit({
            type: 'status',
            step: 'guard',
            message: `דילגתי על מחיקת ${rel} — המשתמש לא ביקש מחיקה במפורש`
          })
          continue
        }
        if (!allowDelete && !rel.includes('obsolete') && !/\.(bak|tmp|old)$/i.test(rel)) {
          // Soft-block: only delete clearly disposable paths unless user asked
          emit({
            type: 'status',
            step: 'guard',
            message: `דילגתי על מחיקת ${rel} ללא בקשת מחיקה מפורשת`
          })
          continue
        }
        emit({ type: 'file', action: 'delete', path: rel })
        deleteProjectFile(project.folderPath, rel)
        applied.push({ ...action, path: rel })
      }
    } catch (err) {
      console.error('Failed action', action.path, err)
    }
  }
  return applied
}

/** Estimate current context usage for the meter UI (mirrors agent prompt assembly) */
export function estimateProjectContext(params: {
  projectId: string
  model: string
  activeFile?: string | null
  draftMessage?: string
}): ContextUsage {
  const project = getProject(params.projectId)
  if (!project) {
    return buildContextUsage({
      modelId: params.model,
      contextWindow: getModelContextWindow(params.model),
      systemPrompt: '',
      fileContext: '',
      integrations: '',
      conversation: '',
      activeFile: ''
    })
  }

  const session = loadChat(params.projectId)
  const tree = buildFileTree(project.folderPath)
  const treeSummary = summarizeTree(tree)
  const integrationsPrompt = buildIntegrationsPrompt(params.projectId)

  let activeFileContext = ''
  let activeFileBody = ''
  if (params.activeFile && !isSecretPath(params.activeFile)) {
    activeFileContext = `\n## קובץ פתוח בעורך\nהמשתמש צופה/עורך כרגע: \`${params.activeFile}\`\n`
    try {
      activeFileBody = readProjectFile(project.folderPath, params.activeFile)
      if (activeFileBody.length > MAX_FILE_BYTES) {
        activeFileBody = activeFileBody.slice(0, MAX_FILE_BYTES)
      }
    } catch {
      /* ignore */
    }
  }

  const projectRules = formatProjectRulesBlock(project.folderPath)
  const system = buildAgentSystemPrompt(
    project.name,
    treeSummary,
    integrationsPrompt,
    activeFileContext,
    projectRules
  )

  // Approximate file context the agent would load (key files; active counted separately).
  // המנוע החדש לא מזריק קבצי מפתח — הוא קורא לפי דרישה, אז ההערכה קטנה בהתאם.
  const isNewEngine = loadSettingsRaw().agentEngine === 'new'
  let fileContext = treeSummary
  if (!isNewEngine) {
    const toLoad = new Set<string>()
    for (const kf of KEY_FILES) {
      try {
        if (existsSync(resolveSafePath(project.folderPath, kf))) toLoad.add(kf)
      } catch {
        /* skip */
      }
    }
    const activeNorm = params.activeFile ? normalizeRel(params.activeFile) : ''
    let loaded = 0
    for (const rel of Array.from(toLoad)) {
      if (loaded >= MAX_FILE_CONTEXT) break
      if (activeNorm && rel === activeNorm) continue
      try {
        let content = readProjectFile(project.folderPath, rel)
        if (content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES)
        fileContext += `\n--- ${rel} ---\n${content}\n`
        loaded++
      } catch {
        /* skip */
      }
    }
  }

  const conversation =
    session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY)
      .map((m) => m.content)
      .join('\n') + (params.draftMessage ? `\n${params.draftMessage}` : '')

  return buildContextUsage({
    modelId: params.model,
    contextWindow: getModelContextWindow(params.model),
    systemPrompt: system,
    fileContext,
    integrations: integrationsPrompt,
    conversation,
    activeFile: activeFileBody
  })
}

function extractMentionedPaths(
  message: string,
  tree: ReturnType<typeof buildFileTree>
): string[] {
  const all: string[] = []
  function collect(nodes: typeof tree): void {
    for (const n of nodes) {
      if (!n.isDirectory) all.push(n.relativePath)
      if (n.children) collect(n.children)
    }
  }
  collect(tree)
  return all.filter((p) => message.includes(p) || message.includes(p.split('/').pop() || ''))
}

function buildIntegrationsPrompt(projectId: string): string {
  const integ = loadIntegrations(projectId)
  const parts: string[] = []
  if (integ.github.connected && integ.github.repoFullName) {
    parts.push(`## GitHub מחובר
- ריפו: ${integ.github.repoFullName}
- ענף: ${integ.github.defaultBranch || 'main'}
- אל תכלול סודות ב-commit; וודא .gitignore תקין.`)
  }
  const sb = getSupabaseContextForAgent(projectId)
  if (sb) parts.push(sb)
  return parts.length ? '\n' + parts.join('\n') : ''
}
