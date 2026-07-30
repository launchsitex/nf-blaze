/**
 * save_memory — זיכרון פרויקט מתמשך (.nf-blaze/memory.md).
 * החלטות ארכיטקטורה, סכמות ומוסכמות שחייבות לשרוד בין סבבים וכיווצי הקשר.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ToolHandler } from './types'
import { ToolError } from './types'
import { joinUnderRoot } from './paths'

export const MEMORY_MAX_CHARS = 6000

export function memoryFilePath(rootDir: string): string {
  return joinUnderRoot(rootDir, '.nf-blaze', 'memory.md')
}

export function readProjectMemory(rootDir: string): string {
  const path = memoryFilePath(rootDir)
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8').slice(0, MEMORY_MAX_CHARS)
  } catch {
    return ''
  }
}

export const saveMemoryTool: ToolHandler = async (args, ctx) => {
  try {
    if (typeof args.content !== 'string' || !args.content.trim()) {
      throw new ToolError('content נדרש — הזיכרון המלא המעודכן (מחליף את הקודם)', 'invalid_args')
    }
    const content = args.content.trim()
    if (content.length > MEMORY_MAX_CHARS) {
      throw new ToolError(
        `הזיכרון ארוך מדי (${content.length} > ${MEMORY_MAX_CHARS} תווים) — תמצת: שמור רק החלטות שחשובות לסבבים הבאים`,
        'memory_too_long'
      )
    }
    const path = memoryFilePath(ctx.rootDir)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
    return {
      ok: true,
      content: `Memory saved (${content.length} chars)`,
      data: { chars: content.length }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'memory_failed'
    }
  }
}
