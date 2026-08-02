/**
 * Bridge: new agent loop (agent/loop + providers) → Electron chat UI.
 * Does not modify agent/ or providers/ — only calls into them.
 */
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type {
  AgentFileAction,
  AiProvider,
  ChatMessage,
  SendChatResult
} from '../../../shared/types'
import { providerRequiresKey } from '../../../shared/types'
import { getApiKey, getGithubToken } from '../secrets'
import { loadChat, saveChat, getProject, saveProject } from '../storage'
import { buildFileTree, summarizeTree } from '../filesystem'
import { createSnapshot, extendSnapshot, getSnapshotChangeStats } from '../snapshots'
import { openProjectIndex, refreshProjectIndexAtRoot } from '../project_index'
import { runAgentLoop, type AgentLoopEvent } from '../../../../agent/loop'
import { collectMcpTools, type McpExternalTool } from '../../../../agent/mcp/manager'
import { EMBEDDED_SYSTEM_PROMPT } from './system_prompt.generated'
import type { WorkModeSelection } from '../../../../agent/intent'
import type { UnifiedMessage } from '../../../../providers'
import { isSecretPath } from '../../../../agent/tools/paths'
import { buildRepoMap } from '../../../../agent/repo_map'
import { readTrust, shouldAutoApprove } from '../trust'
import { readPlan } from '../../../../agent/tools/update_plan'
import { readProjectMemory } from '../../../../agent/tools/save_memory'
import { registerChatAbort, clearChatAbort, type StreamEmitter } from './agent_controllers'
import { formatProjectRulesBlock } from '../templates'
import { formatSelectedElementsContext } from '../preview-select'
import { onProjectCheckEvent } from '../../../../agent/completion_check'
import { ensureLivePreview } from '../preview-live'
import { loadIntegrations } from '../integrations/store'
import { getSupabaseContextForAgent } from '../integrations/supabase'
import { buildSupabaseSqlTool } from '../integrations/supabase_management'
import { buildEdgeFunctionTool } from '../integrations/supabase_functions'
import { buildGithubPublishTool } from '../integrations/github'
import {
  mergeStreamedWithFinal,
  parseClarifyBlock,
  sanitizeHistoryContentForReadOnly,
  stripActionBlocksForDisplay
} from './llm'

/** תקרת היסטוריה — כמו במנוע הישן; כיווץ ההקשר בלולאה משלים מעבר לזה */
const MAX_HISTORY = 28
/** ברירת מחדל של האדפטרים היא 8192 — נמוך מדי לכתיבת קומפוננטות גדולות */
const AGENT_MAX_TOKENS = 16384
const ACTIVE_FILE_MAX_CHARS = 40_000

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * פרומפט המערכת. בהתקנה הוא מוטמע ב-bundle (לא נשלח כקובץ טקסט גלוי);
 * בפיתוח מעדיפים את הקובץ שעל הדיסק כדי שעריכה תיכנס לתוקף מיד.
 */
function loadSystemPromptFile(): string | undefined {
  if (!app.isPackaged) {
    const candidates = [
      join(app.getAppPath(), 'prompts', 'system.md'),
      join(process.cwd(), 'prompts', 'system.md')
    ]
    for (const p of candidates) {
      if (existsSync(p)) {
        try {
          return readFileSync(p, 'utf8').trim()
        } catch {
          /* next */
        }
      }
    }
  }
  if (EMBEDDED_SYSTEM_PROMPT.trim()) return EMBEDDED_SYSTEM_PROMPT.trim()
  return undefined
}

/** בלוקי הקשר לפרומפט המערכת — מקבילים למה שהמנוע הישן הזריק */
function buildProjectContextBlock(rootDir: string, projectName: string): string {
  try {
    const tree = buildFileTree(rootDir)
    const summary = summarizeTree(tree).slice(0, 4000)
    // מפת מרכזיות — עץ הקבצים אומר *מה קיים*, המפה אומרת *מה חשוב*
    let map = ''
    try {
      map = buildRepoMap(rootDir)
    } catch {
      /* best-effort — עץ הקבצים לבדו עדיין שימושי */
    }
    return [
      `## הפרויקט: ${projectName}`,
      `מבנה הקבצים:\n${summary}`,
      map ? `\n${map}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  } catch {
    return `## הפרויקט: ${projectName}`
  }
}

function buildIntegrationsBlock(projectId: string): string {
  const parts: string[] = []
  try {
    const integ = loadIntegrations(projectId)
    const hasGithubAccount = Boolean(getGithubToken())
    if (integ.github.connected && integ.github.repoFullName) {
      parts.push(
        `## GitHub מחובר\n- ריפו: ${integ.github.repoFullName}\n- ענף: ${integ.github.defaultBranch || 'main'}\n- אל תכלול סודות ב-commit; וודא .gitignore תקין.\n- פרסום: קרא ל-\`publish_github\` כשהמשתמש מבקש לפרסם/להעלות — ייווצר **ענף חדש** (nf-blaze-...) בלי לגעת בראשי.`
      )
    } else if (hasGithubAccount) {
      parts.push(
        `## GitHub — חשבון מחובר (הפרויקט עדיין לא מקושר לריפו)\n- פרסום: קרא ל-\`publish_github\` כשהמשתמש מבקש לפרסם/להעלות — ייווצר **ריפו חדש** בחשבון המשתמש והקוד יועלה.`
      )
    }
    const sb = getSupabaseContextForAgent(projectId)
    if (sb) parts.push(sb)
  } catch {
    /* integrations optional */
  }
  return parts.join('\n\n')
}

function buildActiveFileBlock(rootDir: string, activeFile?: string | null): string {
  if (!activeFile || isSecretPath(activeFile)) return ''
  try {
    const full = join(rootDir, activeFile)
    if (!existsSync(full)) return ''
    const content = readFileSync(full, 'utf8')
    if (content.length > ACTIVE_FILE_MAX_CHARS) return `## קובץ פתוח בעורך\n${activeFile} (גדול מדי להצגה — קרא עם read_file)`
    return `## קובץ פתוח בעורך: ${activeFile}\nכשהבקשה מתייחסת "לקובץ הזה" / "למסך הזה" — כנראה הכוונה אליו. העדף לערוך אותו.\n\`\`\`\n${content}\n\`\`\``
  } catch {
    return ''
  }
}

function buildMemoryBlock(rootDir: string): string {
  const memory = readProjectMemory(rootDir)
  if (!memory.trim()) return ''
  return `## זיכרון פרויקט (החלטות קודמות — מחייב)\n${memory.trim()}\nעדכן אותו עם save_memory כשמתקבלות החלטות חדשות.`
}

function buildPlanBlock(rootDir: string): string {
  const plan = readPlan(rootDir)
  if (!plan || !plan.stages.length) return ''
  const lines = plan.stages.map(
    (s) =>
      `${s.status === 'done' ? '[x]' : s.status === 'in_progress' ? '[~]' : '[ ]'} ${s.id}. ${s.title}${s.notes ? ` — ${s.notes}` : ''}`
  )
  const acceptance = plan.acceptance?.length
    ? `\nקריטריוני קבלה (חובה לאמת מולם לפני שמכריזים על סיום):\n${plan.acceptance
        .map((a, i) => `${i + 1}. ${a}`)
        .join('\n')}`
    : ''
  return `## תוכנית בנייה פעילה\nמטרה: ${plan.goal}\n${lines.join('\n')}${acceptance}\nיש תוכנית פעילה — המשך מהשלב הראשון שאינו done ועדכן סטטוסים עם update_plan.`
}

function historyToUnified(messages: ChatMessage[]): UnifiedMessage[] {
  const out: UnifiedMessage[] = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    let text = (m.content || '').trim()
    if (!text) continue
    // Strip prior write-action / clarify fences so ASK/PLAN (and polluted history) stay clean
    if (m.role === 'assistant') {
      text = sanitizeHistoryContentForReadOnly(text)
      if (!text) continue
    }
    out.push({
      role: m.role,
      content: [{ type: 'text', text }]
    })
  }
  return out
}

function toolPath(args: Record<string, unknown> | undefined): string | undefined {
  if (!args || typeof args.path !== 'string') return undefined
  return normalizeRel(args.path)
}

function findPreviewFile(folderPath: string, written: string[]): string | undefined {
  const htmlWritten = written.find((p) => /\.html?$/i.test(p))
  if (htmlWritten) return htmlWritten
  try {
    const tree = buildFileTree(folderPath)
    const preferred = ['index.html', 'index.htm', 'home.html']
    const all: string[] = []
    const walk = (nodes: typeof tree): void => {
      for (const n of nodes) {
        if (!n.isDirectory && /\.html?$/i.test(n.name)) all.push(n.relativePath)
        if (n.children) walk(n.children)
      }
    }
    walk(tree)
    for (const p of preferred) {
      const hit = all.find((x) => x.replace(/\\/g, '/').toLowerCase() === p)
      if (hit) return hit
    }
    return all[0]
  } catch {
    return undefined
  }
}

/**
 * Run the new tool-use agent loop for one chat turn.
 * Emits the same AgentStreamEvent channel as the legacy path, plus scope/tool/tsc/completion events.
 */
export async function sendChatMessageNew(
  params: {
    projectId: string
    message: string
    provider: AiProvider
    model: string
    activeFile?: string | null
    workMode?: WorkModeSelection
    selectedElements?: import('../../../shared/types').PreviewElementSelection[] | null
  },
  emit?: StreamEmitter
): Promise<SendChatResult> {
  const notify: StreamEmitter = emit || (() => undefined)

  // registerChatAbort כבר מבטל ריצה קודמת — קריאה כפולה שלחה project_check מיותר
  const controller = new AbortController()
  registerChatAbort(params.projectId, controller)

  const project = getProject(params.projectId)
  if (!project) {
    clearChatAbort(params.projectId)
    throw new Error('הפרויקט לא נמצא')
  }

  // מקומיים (Ollama / LM Studio) לא דורשים מפתח — המתאם שולח placeholder
  const apiKey = getApiKey(params.provider) ?? undefined
  if (!apiKey && providerRequiresKey(params.provider)) {
    clearChatAbort(params.projectId)
    throw new Error(
      `לא הוגדר מפתח API עבור ${params.provider}. היכנס להגדרות והוסף מפתח.`
    )
  }

  // Absolute user project folder — never the NF-Blaze app root
  const rootDir = project.folderPath
  if (!rootDir || !existsSync(rootDir)) {
    clearChatAbort(params.projectId)
    throw new Error('תיקיית הפרויקט לא קיימת')
  }

  notify({ type: 'status', step: 'prepare', message: 'מנוע סוכן חדש · קורא את הפרויקט…' })

  // Ensure conventions index exists before the loop injects it into the system prompt
  try {
    openProjectIndex(params.projectId)
  } catch {
    /* loop will still call ensureProjectIndex */
  }

  const session = loadChat(params.projectId)
  const elementCtx = formatSelectedElementsContext(params.selectedElements)
  const userContent = elementCtx
    ? `${params.message.trim()}\n\n${elementCtx}`
    : params.message.trim()
  const userMsg: ChatMessage = {
    id: uuidv4(),
    role: 'user',
    content: userContent,
    createdAt: new Date().toISOString()
  }
  // workMode filled after loop resolves (missing selection → ASK inside resolveWorkMode)
  session.messages.push(userMsg)

  const prior = historyToUnified(session.messages.slice(0, -1).slice(-MAX_HISTORY))
  const baseSystem = loadSystemPromptFile() || ''
  const rules = formatProjectRulesBlock(rootDir)
  const systemOverride =
    [
      baseSystem,
      buildProjectContextBlock(rootDir, project.name),
      rules,
      buildIntegrationsBlock(params.projectId),
      buildMemoryBlock(rootDir),
      buildPlanBlock(rootDir),
      buildActiveFileBlock(rootDir, params.activeFile),
      elementCtx
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim() || undefined

  const writtenPaths: string[] = []
  const actionsApplied: AgentFileAction[] = []
  let snapshotId: string | undefined
  const snapshotted = new Set<string>()
  let lastLiveText = ''
  let aborted = false

  /**
   * Snapshot יחיד לכל הסבב, שמורחב בכל קובץ חדש (scope או כתיבה ישירה) —
   * כך «בטל» אחד משחזר את כל הסבב, כולל קבצים שנוספו בהרחבת scope.
   */
  const ensureFilesSnapshot = (files: string[]): void => {
    const fresh = files.map(normalizeRel).filter((p) => p && !snapshotted.has(p))
    if (!fresh.length) return
    const actions = fresh.map((p) => ({ type: 'write' as const, path: p }))
    if (!snapshotId) {
      const snap = createSnapshot(params.projectId, actions, userMsg.id)
      if (snap) {
        snapshotId = snap.id
        for (const p of fresh) snapshotted.add(p)
      }
      return
    }
    if (extendSnapshot(params.projectId, snapshotId, actions)) {
      for (const p of fresh) snapshotted.add(p)
    }
  }

  let unsubCheck: (() => void) | undefined
  try {
    unsubCheck = onProjectCheckEvent((ev) => {
      if (controller.signal.aborted) return
      notify({
        type: 'project_check',
        status: ev.status,
        kind: ev.kind,
        errorCount: ev.errorCount,
        message: ev.message
      })
    })

    // כלי MCP — קונפיג גלובלי + פרויקט (הפרויקט גובר). כשל שרת לא מפיל את הבקשה.
    let mcpTools: McpExternalTool[] = []
    try {
      const mcp = await collectMcpTools([
        join(app.getPath('userData'), 'nf-blaze-data', 'mcp.json'),
        join(rootDir, '.nf-blaze', 'mcp.json')
      ])
      mcpTools = mcp.tools
      for (const warning of mcp.warnings) {
        notify({ type: 'status', step: 'mcp', message: warning })
      }
      if (mcpTools.length) {
        notify({
          type: 'status',
          step: 'mcp',
          message: `MCP: ${mcpTools.length} כלים זמינים`
        })
      }
    } catch {
      /* MCP optional */
    }

    // כלי run_sql — גישה ישירה של הסוכן ל-Supabase של הפרויקט (אם חובר access token)
    const sqlTool = buildSupabaseSqlTool(params.projectId)
    if (sqlTool) {
      mcpTools.push(sqlTool)
      notify({ type: 'status', step: 'mcp', message: 'Supabase: הסוכן יכול להריץ SQL ישירות' })
    }

    // כלי deploy_edge_function — לוגיקת שרת שאסור שתרוץ בדפדפן
    const edgeTool = buildEdgeFunctionTool(params.projectId)
    if (edgeTool) mcpTools.push(edgeTool)

    // כלי publish_github — פרסום הפרויקט ל-GitHub (אם חשבון GitHub מחובר)
    const ghTool = buildGithubPublishTool(params.projectId)
    if (ghTool) mcpTools.push(ghTool)

    const loopResult = await runAgentLoop({
      model: params.model,
      userMessage: userContent,
      rootDir,
      apiKey,
      systemPrompt: systemOverride,
      history: prior,
      workMode: params.workMode, // missing → ASK inside resolveWorkMode (no silent auto)
      maxTokens: AGENT_MAX_TOKENS,
      signal: controller.signal,
      getPreviewUrl: async () => {
        try {
          const live = await ensureLivePreview(params.projectId)
          return live.url
        } catch {
          return null
        }
      },
      extraTools: mcpTools,
      onEvent: (event: AgentLoopEvent) => {
        if (controller.signal.aborted) return

        switch (event.type) {
          case 'intent':
            notify({ type: 'intent', mode: event.mode, source: event.source })
            notify({
              type: 'status',
              step: 'intent',
              message:
                event.source === 'manual'
                  ? `מצב: ${event.mode}`
                  : `זוהה מצב: ${event.mode}`
            })
            break

          case 'iteration':
            notify({
              type: 'status',
              step: 'iteration',
              message: `איטרציה ${event.index}…`
            })
            // הפרדה ויזואלית בין טקסט של איטרציות עוקבות
            if (event.index > 1 && lastLiveText && !lastLiveText.endsWith('\n\n')) {
              notify({ type: 'token', text: '\n\n' })
              lastLiveText += '\n\n'
            }
            break

          case 'model_delta': {
            // סטרימינג אמיתי — טוקנים זורמים תוך כדי יצירה
            if (event.delta) {
              notify({ type: 'token', text: event.delta })
              lastLiveText += event.delta
            }
            break
          }

          case 'model': {
            const text = (event.result.text || '').trim()
            // אם הטקסט כבר נשלח בדלתאות — אל תשלח שוב
            if (text && text !== lastLiveText.trim()) {
              if (text.startsWith(lastLiveText)) {
                const delta = text.slice(lastLiveText.length)
                if (delta) notify({ type: 'token', text: delta })
                lastLiveText = text
              } else if (!lastLiveText.trim().endsWith(text)) {
                notify({ type: 'token', text: `\n\n${text}` })
                lastLiveText += `\n\n${text}`
              }
            }
            if (event.result.toolCalls?.length) {
              notify({
                type: 'status',
                step: 'tools',
                message: `קורא לכלים (${event.result.toolCalls.length})…`
              })
            }
            break
          }

          case 'tool_start': {
            const name = event.toolCall.name
            const path = toolPath(event.toolCall.arguments)
            notify({
              type: 'tool',
              phase: 'start',
              name,
              path,
              detail: path ? `${name} → ${path}` : name
            })
            notify({
              type: 'status',
              step: 'tool',
              message: path ? `מריץ ${name}: ${path}` : `מריץ ${name}…`
            })
            if ((name === 'edit_file' || name === 'write_file') && path) {
              ensureFilesSnapshot([path])
            }
            break
          }

          case 'tool_end': {
            const name = event.toolCall.name
            const path = toolPath(event.toolCall.arguments)
            notify({
              type: 'tool',
              phase: 'end',
              name,
              path,
              isError: event.isError,
              detail: event.content.slice(0, 400)
            })
            if (!event.isError && path && (name === 'edit_file' || name === 'write_file')) {
              const actionType = name === 'edit_file' ? 'edit' : 'write'
              notify({ type: 'file', action: actionType, path })
              if (!writtenPaths.includes(path)) writtenPaths.push(path)
              actionsApplied.push({ type: actionType, path })
            }
            if (name === 'run_command' && event.content) {
              for (const line of event.content.split(/\r?\n/).slice(0, 40)) {
                if (line.trim()) notify({ type: 'shell', line, stream: 'stdout' })
              }
            }
            if (!event.isError && name === 'update_plan') {
              notify({ type: 'status', step: 'plan', message: `תוכנית עודכנה · ${event.content.slice(0, 120)}` })
            }
            if (!event.isError && name === 'save_memory') {
              notify({ type: 'status', step: 'memory', message: 'זיכרון הפרויקט עודכן' })
            }
            break
          }

          case 'scope':
            notify({
              type: 'scope',
              files: event.declaration.files,
              reason: event.declaration.reason,
              expansion: event.declaration.expansion,
              allScoped: event.allScoped
            })
            notify({
              type: 'status',
              step: 'scope',
              message: event.declaration.expansion
                ? `היקף הורחב: ${event.declaration.files.join(', ')}`
                : `היקף מוצהר: ${event.allScoped.join(', ')}`
            })
            // Snapshot declared files before edits (best undo coverage)
            ensureFilesSnapshot(event.allScoped)
            break

          case 'tsc_fix':
            notify({
              type: 'tsc_fix',
              file: event.file,
              errors: event.errors.map((e) => ({
                line: e.line,
                column: e.column,
                code: e.code,
                message: e.message
              })),
              attempt: event.attempt
            })
            notify({
              type: 'status',
              step: 'tsc',
              message: `תיקון tsc · ${event.file} (ניסיון ${event.attempt})`
            })
            break

          case 'tsc_reverted':
            notify({
              type: 'status',
              step: 'tsc',
              message: `שוחזר תיקון ב-${event.file} (שגיאות ${event.previousCount}→${event.newCount})`
            })
            break

          case 'tsc_unresolved':
            notify({ type: 'completion_check', ok: false, missing: 'tsc', nudge: event.summary })
            notify({ type: 'status', step: 'tsc', message: 'לא הצלחתי לתקן את כל שגיאות TypeScript' })
            break

          case 'completion_blocked':
            notify({
              type: 'completion_check',
              ok: false,
              missing: event.missing,
              nudge: event.nudge,
              detail: event.detail
            })
            notify({ type: 'status', step: 'completion', message: event.nudge })
            break

          case 'check_warning':
            notify({ type: 'status', step: 'check', message: event.message })
            break

          case 'tool_progress': {
            const kb = (event.argChars / 1000).toFixed(1)
            const label =
              event.name === 'write_file' || event.name === 'edit_file'
                ? event.pathHint
                  ? `כותב את ${event.pathHint}`
                  : 'כותב קובץ'
                : `מכין ${event.name}`
            notify({ type: 'status', step: 'tool', message: `${label}… (${kb}K תווים)` })
            break
          }

          case 'auto_continue':
            notify({
              type: 'status',
              step: 'auto_continue',
              message: `המשימה גדולה — ממשיך אוטומטית (סבב ${event.round})`
            })
            break

          case 'context_compact':
            notify({
              type: 'context_compact',
              beforePercent: event.beforePercent,
              afterPercent: event.afterPercent,
              beforeTokens: event.beforeTokens,
              afterTokens: event.afterTokens,
              contextWindow: event.contextWindow
            })
            notify({
              type: 'status',
              step: 'context',
              message: `כיווץ הקשר · ${event.beforePercent}% → ${event.afterPercent}%`
            })
            break

          case 'browser_qa':
            notify({
              type: 'browser_qa',
              phase: event.phase,
              attempt: event.attempt,
              message: event.message,
              url: event.url,
              action: event.action,
              summary: event.summary,
              works: event.works,
              broken: event.broken
            })
            notify({
              type: 'status',
              step: 'browser_qa',
              message: event.action
                ? `דפדפן · ${event.action}`
                : event.message
            })
            break

          case 'health':
            // skipped = כשל תשתיתי (אין Vite/Chromium) — לא מציגים למשתמש
            if (event.phase === 'skipped') break
            notify({
              type: 'health',
              phase: event.phase,
              message: event.message,
              regressions: event.regressions
            })
            notify({
              type: 'status',
              step: 'health',
              message:
                event.phase === 'regressed'
                  ? `⚠ נשבר משהו שעבד (${event.regressions?.length ?? 0})`
                  : `בסיס ירוק · ${event.message}`
            })
            break

          case 'done':
            if (event.result.stopReason === 'completed') {
              notify({ type: 'completion_check', ok: true })
            }
            break

          default:
            break
        }
      }
    })

    if (controller.signal.aborted || loopResult.stopReason === 'aborted') {
      aborted = true
    }

    let assistantText =
      mergeStreamedWithFinal(lastLiveText.trim(), loopResult.text?.trim() || '') ||
      (aborted
        ? 'הופסק.'
        : loopResult.error ||
          (loopResult.stopReason === 'tsc_unresolved'
            ? loopResult.error || 'נותרו שגיאות TypeScript.'
            : 'הסתיים.'))

    // תקרה קשיחה (160 איטרציות, אחרי המשכים אוטומטיים) — מקרה קצה נדיר, לא הצלחה
    if (loopResult.stopReason === 'max_iterations') {
      assistantText = `${assistantText}\n\n⚠ המשימה גדולה במיוחד — עבדתי ${loopResult.iterations} איטרציות (כולל המשכים אוטומטיים) ועצרתי בתקרת הבטיחות. כתוב "המשך" ואמשיך מאותה נקודה.`
    }

    // PLAN/ASK — שאלות הבהרה מובנות במקום JSON גולמי בצ׳אט
    let clarify: ReturnType<typeof parseClarifyBlock> | undefined
    if (loopResult.workMode === 'PLAN' || loopResult.workMode === 'ASK') {
      clarify = parseClarifyBlock(assistantText)
      if (clarify) {
        assistantText =
          stripActionBlocksForDisplay(assistantText) ||
          'יש לי כמה שאלות הבהרה לפני שנמשיך:'
      }
    }

    const autoApproved =
      writtenPaths.length > 0 &&
      snapshotId !== undefined &&
      shouldAutoApprove({
        level: readTrust(rootDir).level,
        filesChanged: writtenPaths.length,
        hasRegressions: Boolean(loopResult.regressions?.length)
      })

    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: assistantText,
      createdAt: new Date().toISOString(),
      filesChanged: writtenPaths.length ? writtenPaths : undefined,
      error: Boolean(loopResult.error && loopResult.stopReason === 'error'),
      aborted,
      clarify,
      workMode: loopResult.workMode,
      workModeSource: loopResult.workModeSource,
      modeBlockedWrites: loopResult.modeBlockedWrites,
      // מאפשר diff / שחזור / אישור-ביטול שינויים על הסבב הזה מהצ'אט
      snapshotId: writtenPaths.length ? snapshotId : undefined,
      // «בסיס ירוק» — מוצג ליד «בטל שינויים» כדי שההחלטה תהיה מיודעת
      regressions: loopResult.regressions?.length ? loopResult.regressions : undefined,
      // אמון מדורג: אחרי מספיק אישורים רצופים, שינוי קטן ונקי נסגר לבד.
      // רגרסיה או שינוי גדול תמיד חוזרים לשאלה.
      ...(autoApproved ? { changesApproved: true, autoApproved: true } : {}),
      changeStats:
        writtenPaths.length && snapshotId
          ? getSnapshotChangeStats(params.projectId, snapshotId)
          : undefined
    }
    userMsg.workMode = loopResult.workMode
    userMsg.workModeSource = loopResult.workModeSource
    session.messages.push(assistantMessage)
    saveChat(session)

    // Rescan conventions after a write round so the next request matches new code
    if (writtenPaths.length > 0) {
      const refreshed = refreshProjectIndexAtRoot(rootDir)
      if (refreshed?.ready) {
        notify({
          type: 'status',
          step: 'index',
          message: `אינדקס פרויקט עודכן (${refreshed.filesSampled} קבצים)`
        })
      }
    }

    const previewFile =
      findPreviewFile(rootDir, writtenPaths) || project.lastPreviewFile
    if (previewFile) {
      saveProject({ ...project, lastPreviewFile: previewFile, updatedAt: new Date().toISOString() })
    } else {
      saveProject({ ...project, updatedAt: new Date().toISOString() })
    }

    const result: SendChatResult = {
      assistantMessage,
      actionsApplied,
      previewFile,
      aborted,
      snapshotId,
      workMode: loopResult.workMode,
      workModeSource: loopResult.workModeSource,
      modeBlockedWrites: loopResult.modeBlockedWrites,
      error:
        loopResult.stopReason === 'error' || loopResult.stopReason === 'tsc_unresolved'
          ? loopResult.error
          : undefined
    }

    if (aborted) {
      notify({ type: 'aborted' })
    } else {
      notify({
        type: 'status',
        step: 'done',
        message: writtenPaths.length
          ? `הושלם — עודכנו ${writtenPaths.length} קבצים`
          : 'הושלם'
      })
      notify({ type: 'done', result })
    }

    return result
  } catch (err) {
    if (controller.signal.aborted) {
      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: 'הופסק.',
        createdAt: new Date().toISOString(),
        aborted: true
      }
      session.messages.push(assistantMessage)
      saveChat(session)
      const result: SendChatResult = {
        assistantMessage,
        actionsApplied,
        aborted: true,
        snapshotId
      }
      notify({ type: 'aborted' })
      return result
    }
    // שגיאת ספק — לא מאבדים את הסבב: שומרים לצ׳אט ומחזירים תוצאה כמו המנוע הישן
    const message = err instanceof Error ? err.message : String(err)
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: `שגיאה: ${message}`,
      createdAt: new Date().toISOString(),
      error: true
    }
    session.messages.push(assistantMessage)
    try {
      saveChat(session)
    } catch {
      /* project folder missing — nothing to persist to */
    }
    notify({ type: 'error', message })
    notify({ type: 'done', result: { assistantMessage, actionsApplied, error: message } })
    return {
      assistantMessage,
      actionsApplied,
      snapshotId,
      error: message
    }
  } finally {
    unsubCheck?.()
    clearChatAbort(params.projectId)
  }
}
