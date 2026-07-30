import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { ToolHandler } from './types'
import { ToolError } from './types'
import { resolveInRoot, toPosixRel } from './paths'

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string') throw new ToolError(`${key} חייב להיות מחרוזת`, 'invalid_args')
  return v
}

export const listDirTool: ToolHandler = async (args, ctx) => {
  try {
    const relRaw = requireString(args, 'path')
    const rel = relRaw === '.' || relRaw === './' ? '.' : relRaw
    const full = rel === '.' ? resolveInRoot(ctx.rootDir, '.') : resolveInRoot(ctx.rootDir, rel)

    // resolveInRoot('.') — need to handle '.' specially in resolveInRoot
    // Currently normalizeRelPath('.') might fail empty after strip? '.' stays as '.'
    // Let me check paths - normalizeRelPath('.') → '.' after trim, TRAVERSAL ok
    // resolve(root, '.') → root - good

    if (!existsSync(full)) {
      return { ok: false, error: `תיקייה לא נמצאה: ${rel}`, code: 'not_found' }
    }
    if (!statSync(full).isDirectory()) {
      return { ok: false, error: `הנתיב אינו תיקייה: ${rel}`, code: 'not_directory' }
    }

    const recursive = Boolean(args.recursive)
    const maxEntries =
      typeof args.maxEntries === 'number' && Number.isFinite(args.maxEntries)
        ? Math.min(5000, Math.max(1, Math.floor(args.maxEntries)))
        : 500

    const entries: Array<{ path: string; type: 'file' | 'dir' }> = []

    function walk(dir: string): void {
      if (entries.length >= maxEntries) return
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      names.sort((a, b) => a.localeCompare(b))
      for (const name of names) {
        if (entries.length >= maxEntries) break
        if (name === '.git' || name === 'node_modules' || name === '.nf-blaze') continue
        const child = join(dir, name)
        let st
        try {
          st = statSync(child)
        } catch {
          continue
        }
        const posix = toPosixRel(ctx.rootDir, child)
        if (st.isDirectory()) {
          entries.push({ path: posix + '/', type: 'dir' })
          if (recursive) walk(child)
        } else if (st.isFile()) {
          entries.push({ path: posix, type: 'file' })
        }
      }
    }

    walk(full)

    const lines = entries.map((e) => `${e.type === 'dir' ? 'DIR ' : 'FILE'} ${e.path}`)
    return {
      ok: true,
      content: lines.length ? lines.join('\n') : '(empty directory)',
      data: { path: rel, count: entries.length, truncated: entries.length >= maxEntries }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'list_failed'
    }
  }
}
