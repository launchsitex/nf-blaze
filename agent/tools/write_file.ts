import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ToolHandler } from './types'
import { ToolError } from './types'
import { resolveInRoot, toPosixRel } from './paths'
import { assertWritableContent } from './validate_write'
import { invalidateComponentIndex } from './component_index'
import { assertInScope } from './session'

export const writeFileTool: ToolHandler = async (args, ctx) => {
  try {
    if (typeof args.path !== 'string') {
      throw new ToolError('path חייב להיות מחרוזת', 'invalid_args')
    }
    if (typeof args.content !== 'string') {
      throw new ToolError('content חייב להיות מחרוזת', 'invalid_args')
    }

    assertInScope(ctx.session, args.path)

    // Pre-write validation (packages, local imports, component props)
    assertWritableContent(ctx.rootDir, args.path, args.content, ctx.session)

    const full = resolveInRoot(ctx.rootDir, args.path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, args.content, 'utf8')
    invalidateComponentIndex(ctx.rootDir)

    return {
      ok: true,
      content: `Wrote ${toPosixRel(ctx.rootDir, full)} (${Buffer.byteLength(args.content, 'utf8')} bytes)`,
      data: {
        path: toPosixRel(ctx.rootDir, full),
        bytes: Buffer.byteLength(args.content, 'utf8')
      }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'write_failed'
    }
  }
}
