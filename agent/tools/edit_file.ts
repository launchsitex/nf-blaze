import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ToolHandler } from './types'
import { ToolError } from './types'
import { resolveInRoot, toPosixRel } from './paths'
import { assertWritableContent } from './validate_write'
import { invalidateComponentIndex } from './component_index'
import { assertInScope, assertReadBeforeEdit } from './session'

/**
 * Replace exact unique substring.
 * Throws ToolError if old_string is missing or appears more than once.
 */
export function applyUniqueEdit(content: string, oldString: string, newString: string): string {
  if (typeof oldString !== 'string') {
    throw new ToolError('old_string חייב להיות מחרוזת', 'invalid_args')
  }
  if (typeof newString !== 'string') {
    throw new ToolError('new_string חייב להיות מחרוזת', 'invalid_args')
  }
  if (!oldString.length) {
    throw new ToolError('old_string לא יכול להיות ריק', 'invalid_args')
  }

  const count = content.split(oldString).length - 1
  if (count === 0) {
    throw new ToolError('old_string לא נמצא בקובץ', 'old_string_not_found')
  }
  if (count > 1) {
    throw new ToolError(
      `old_string מופיע ${count} פעמים — חייב להיות ייחודי (פעם אחת בלבד)`,
      'old_string_not_unique'
    )
  }
  return content.replace(oldString, newString)
}

export const editFileTool: ToolHandler = async (args, ctx) => {
  try {
    if (typeof args.path !== 'string') {
      throw new ToolError('path חייב להיות מחרוזת', 'invalid_args')
    }
    if (typeof args.old_string !== 'string') {
      throw new ToolError('old_string חייב להיות מחרוזת', 'invalid_args')
    }
    if (typeof args.new_string !== 'string') {
      throw new ToolError('new_string חייב להיות מחרוזת', 'invalid_args')
    }

    assertInScope(ctx.session, args.path)
    assertReadBeforeEdit(ctx.session, args.path)

    const full = resolveInRoot(ctx.rootDir, args.path)
    if (!existsSync(full)) {
      return { ok: false, error: `קובץ לא נמצא: ${args.path}`, code: 'not_found' }
    }

    const before = readFileSync(full, 'utf8')
    const after = applyUniqueEdit(before, args.old_string, args.new_string)

    // Pre-write validation (packages, local imports, component props)
    assertWritableContent(ctx.rootDir, args.path, after, ctx.session)

    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, after, 'utf8')
    invalidateComponentIndex(ctx.rootDir)

    return {
      ok: true,
      content: `Updated ${toPosixRel(ctx.rootDir, full)}`,
      data: {
        path: toPosixRel(ctx.rootDir, full),
        bytesBefore: Buffer.byteLength(before, 'utf8'),
        bytesAfter: Buffer.byteLength(after, 'utf8')
      }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      throw err
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'edit_failed'
    }
  }
}
