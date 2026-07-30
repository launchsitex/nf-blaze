import { readFileSync, existsSync } from 'fs'
import type { ToolHandler } from './types'
import { ToolError } from './types'
import { isSecretPath, resolveInRoot, toPosixRel } from './paths'
import { markFileRead } from './session'

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string') throw new ToolError(`${key} חייב להיות מחרוזת`, 'invalid_args')
  return v
}

export const readFileTool: ToolHandler = async (args, ctx) => {
  try {
    const rel = requireString(args, 'path')
    if (isSecretPath(rel)) {
      return {
        ok: false,
        error: `קובץ רגיש (${rel}) — אין גישה לקבצי סוד. אם צריך תבנית, השתמש ב-.env.example`,
        code: 'secret_file'
      }
    }
    const full = resolveInRoot(ctx.rootDir, rel)
    if (!existsSync(full)) {
      return { ok: false, error: `קובץ לא נמצא: ${rel}`, code: 'not_found' }
    }

    const raw = readFileSync(full, 'utf8')
    const lines = raw.split(/\r?\n/)
    const offset =
      typeof args.offset === 'number' && Number.isFinite(args.offset)
        ? Math.max(0, Math.floor(args.offset))
        : 0
    const limit =
      typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.floor(args.limit))
        : undefined

    const slice = limit !== undefined ? lines.slice(offset, offset + limit) : lines.slice(offset)
    const numbered = slice.map((line, i) => `${offset + i + 1}|${line}`).join('\n')

    const relPath = toPosixRel(ctx.rootDir, full)
    if (ctx.session) {
      markFileRead(ctx.session, relPath)
    }

    return {
      ok: true,
      content: numbered || '(empty file)',
      data: {
        path: relPath,
        totalLines: lines.length,
        offset,
        returnedLines: slice.length
      }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'read_failed'
    }
  }
}
