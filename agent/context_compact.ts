/**
 * Context window management for the agent loop.
 * Compact around ~60% of the model window, only between completed rounds.
 * Long tool outputs spill to disk and leave a short retrievable id in-context.
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UnifiedMessage, MessageContent } from '../providers'
import { estimateTokens } from '@shared/context'
import { getModelContextWindow } from '@shared/types'

/** Compact when estimated context reaches this fraction of the model window */
export const CONTEXT_COMPACT_RATIO = 0.6

/** Tool result body longer than this (chars) is spilled to disk */
export const TOOL_RESULT_SPILL_CHARS = 3_500

/** כלי רשת מחזירים תוכן ארוך מטבעו — סף גבוה יותר כדי שהמודל יקרא את העמוד בפועל */
export const WEB_TOOL_SPILL_CHARS = 16_000

function spillThresholdFor(toolName: string): number {
  return toolName === 'web_search' || toolName === 'web_fetch'
    ? WEB_TOOL_SPILL_CHARS
    : TOOL_RESULT_SPILL_CHARS
}

const KEEP_RECENT_MESSAGES = 6

export type CompactInput = {
  messages: UnifiedMessage[]
  system: string
  modelId: string
  rootDir: string
  writtenPaths: string[]
  workMode: string
  /** Human-readable open items (tsc file, completion missing, …) */
  openTasks: string[]
  /** When true, skip compaction (mid open repair task) */
  taskOpen?: boolean
}

export type CompactResult = {
  messages: UnifiedMessage[]
  compacted: boolean
  beforeTokens: number
  afterTokens: number
  contextWindow: number
  percentBefore: number
  percentAfter: number
}

export type SpillResult = {
  content: string
  spilled: boolean
  refId?: string
}

function toolResultsDir(rootDir: string): string {
  return join(rootDir, '.nf-blaze', 'tool_results')
}

function serializeMessages(messages: UnifiedMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    parts.push(`ROLE:${m.role}`)
    for (const c of m.content) {
      if (c.type === 'text') parts.push(c.text)
      else if (c.type === 'tool_use') {
        parts.push(`TOOL_USE ${c.name} ${JSON.stringify(c.arguments).slice(0, 500)}`)
      } else if (c.type === 'tool_result') {
        parts.push(`TOOL_RESULT ${c.name || ''} ${c.content}`)
      }
    }
  }
  return parts.join('\n')
}

export function estimateContextTokens(system: string, messages: UnifiedMessage[]): number {
  return estimateTokens(system) + estimateTokens(serializeMessages(messages))
}

/**
 * Persist a long tool payload; return a short stub the model can cite.
 */
export function spillToolResultToDisk(
  rootDir: string,
  toolName: string,
  content: string
): SpillResult {
  if (!content || content.length <= spillThresholdFor(toolName)) {
    return { content, spilled: false }
  }
  const dir = toolResultsDir(rootDir)
  mkdirSync(dir, { recursive: true })
  const refId = createHash('sha1')
    .update(content)
    .update(String(Date.now()))
    .digest('hex')
    .slice(0, 12)
  const file = join(dir, `${refId}.txt`)
  writeFileSync(file, content, 'utf8')
  const preview = content.slice(0, 400).replace(/\s+/g, ' ').trim()
  const stub = [
    `[tool_result_ref:${refId}]`,
    `כלי: ${toolName}`,
    `אורך מקורי: ${content.length} תווים — התוכן המלא נשמר בדיסק.`,
    `שליפה: .nf-blaze/tool_results/${refId}.txt`,
    `תקציר: ${preview}${content.length > 400 ? '…' : ''}`
  ].join('\n')
  return { content: stub, spilled: true, refId }
}

function extractText(m: UnifiedMessage): string {
  return m.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim()
}

function summarizeHistory(opts: {
  older: UnifiedMessage[]
  writtenPaths: string[]
  workMode: string
  openTasks: string[]
}): string {
  const files = [...new Set(opts.writtenPaths.map((p) => p.replace(/\\/g, '/')))]
  const decisions: string[] = []
  const built: string[] = []

  for (const m of opts.older) {
    if (m.role === 'assistant') {
      const t = extractText(m)
      if (t) built.push(t.slice(0, 280))
      for (const c of m.content) {
        if (c.type === 'tool_use' && c.name === 'declare_scope') {
          const filesArg = c.arguments?.files
          if (Array.isArray(filesArg)) {
            decisions.push(`היקף: ${(filesArg as string[]).slice(0, 12).join(', ')}`)
          }
        }
        if (c.type === 'tool_use' && (c.name === 'write_file' || c.name === 'edit_file')) {
          const p = c.arguments?.path
          if (typeof p === 'string') files.push(p.replace(/\\/g, '/'))
        }
      }
    }
    if (m.role === 'user') {
      const t = extractText(m)
      if (t && /היקף|החלט|בחר|נשתמש|mode|ASK|PLAN|BUILD/i.test(t)) {
        decisions.push(t.slice(0, 160))
      }
    }
  }

  const uniqueFiles = [...new Set(files)].slice(0, 40)
  const lines = [
    '## סיכום הקשר (כיווץ אוטומטי)',
    `מצב עבודה: ${opts.workMode}`,
    '',
    '### מה נבנה / נאמר',
    built.length
      ? built
          .slice(-5)
          .map((b, i) => `${i + 1}. ${b}`)
          .join('\n')
      : '(אין תקציר טקסט — ראה קבצים שננגעו)',
    '',
    '### קבצים שננגעו',
    uniqueFiles.length ? uniqueFiles.map((f) => `- ${f}`).join('\n') : '- (אין עדיין)',
    '',
    '### החלטות',
    decisions.length
      ? [...new Set(decisions)].slice(0, 8).map((d) => `- ${d}`).join('\n')
      : '- (לא תועדו במפורש)',
    '',
    '### מה עוד פתוח',
    opts.openTasks.length
      ? opts.openTasks.map((t) => `- ${t}`).join('\n')
      : '- אין משימות פתוחות ידועות',
    '',
    'תוכן קבצים גולמי ופלטי כלים ארוכים הוסרו מההקשר.',
    'אם צריך פלט כלי מלא — השתמש במזהה tool_result_ref או קרא מהדיסק.'
  ]
  return lines.join('\n')
}

function stripHeavyToolPayloads(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages.map((m) => {
    if (m.role !== 'tool' && m.role !== 'assistant') return m
    const content: MessageContent[] = m.content.map((c) => {
      if (c.type === 'tool_result') {
        // Already stubbed refs stay; still trim huge leftovers
        if (c.content.includes('[tool_result_ref:')) return c
        if (c.content.length > TOOL_RESULT_SPILL_CHARS) {
          return {
            ...c,
            content:
              c.content.slice(0, 500) +
              `\n…[קוצץ בכיווץ · ${c.content.length} תווים מקוריים]`
          }
        }
      }
      if (c.type === 'tool_use' && c.name === 'write_file') {
        const args = { ...c.arguments }
        if (typeof args.content === 'string' && args.content.length > 800) {
          args.content =
            args.content.slice(0, 400) +
            `\n…[תוכן קובץ קוצץ בכיווץ · path=${args.path || '?'}]`
        }
        return { ...c, arguments: args }
      }
      return c
    })
    return { ...m, content }
  })
}

/**
 * If usage ≥ 60% of the model window and no open task — replace older turns
 * with a structured summary. Keeps the most recent messages intact.
 */
export function maybeCompactContext(input: CompactInput): CompactResult {
  const contextWindow = getModelContextWindow(input.modelId)
  const beforeTokens = estimateContextTokens(input.system, input.messages)
  const percentBefore =
    Math.round((beforeTokens / Math.max(1, contextWindow)) * 1000) / 10

  const threshold = Math.floor(contextWindow * CONTEXT_COMPACT_RATIO)
  if (input.taskOpen || beforeTokens < threshold || input.messages.length <= KEEP_RECENT_MESSAGES + 1) {
    return {
      messages: input.messages,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      contextWindow,
      percentBefore,
      percentAfter: percentBefore
    }
  }

  const kept = input.messages.slice(-KEEP_RECENT_MESSAGES)
  const older = input.messages.slice(0, -KEEP_RECENT_MESSAGES)
  const summaryText = summarizeHistory({
    older: stripHeavyToolPayloads(older),
    writtenPaths: input.writtenPaths,
    workMode: input.workMode,
    openTasks: input.openTasks
  })

  const summaryMessage: UnifiedMessage = {
    role: 'user',
    content: [{ type: 'text', text: summaryText }]
  }

  // Drop raw write contents from kept tool_use args as well (light pass)
  const next = stripHeavyToolPayloads([summaryMessage, ...kept])
  const afterTokens = estimateContextTokens(input.system, next)
  const percentAfter =
    Math.round((afterTokens / Math.max(1, contextWindow)) * 1000) / 10

  return {
    messages: next,
    compacted: true,
    beforeTokens,
    afterTokens,
    contextWindow,
    percentBefore,
    percentAfter
  }
}

export function readSpilledToolResult(rootDir: string, refId: string): string | null {
  const safe = refId.replace(/[^a-f0-9]/gi, '')
  if (!safe) return null
  const file = join(toolResultsDir(rootDir), `${safe}.txt`)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
