import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { extname, join } from 'path'
import type { ToolHandler } from './types'
import { ToolError } from './types'
import { isSecretPath, resolveInRoot, toPosixRel } from './paths'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.nf-blaze', 'dist', 'release', 'out'])
const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.exe',
  '.dll',
  '.woff',
  '.woff2',
  '.ttf',
  '.mp4',
  '.mp3'
])

function matchGlob(filePath: string, glob?: string): boolean {
  if (!glob) return true
  const g = glob.trim()
  if (g.startsWith('*.')) {
    return filePath.toLowerCase().endsWith(g.slice(1).toLowerCase())
  }
  return filePath.includes(g.replace(/^\*\//, ''))
}

export const grepTool: ToolHandler = async (args, ctx) => {
  try {
    if (typeof args.pattern !== 'string' || !args.pattern.length) {
      throw new ToolError('pattern נדרש', 'invalid_args')
    }
    const pattern = args.pattern
    const rel =
      typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.'
    const literal = Boolean(args.literal)
    const caseInsensitive = Boolean(args.caseInsensitive)
    const maxMatches =
      typeof args.maxMatches === 'number' && Number.isFinite(args.maxMatches)
        ? Math.min(2000, Math.max(1, Math.floor(args.maxMatches)))
        : 100
    const glob = typeof args.glob === 'string' ? args.glob : undefined

    let regex: RegExp
    try {
      const source = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern
      regex = new RegExp(source, caseInsensitive ? 'i' : undefined)
    } catch {
      throw new ToolError(`ביטוי רגולרי לא תקין: ${pattern}`, 'invalid_regex')
    }

    const start = rel === '.' ? resolveInRoot(ctx.rootDir, '.') : resolveInRoot(ctx.rootDir, rel)
    if (!existsSync(start)) {
      return { ok: false, error: `נתיב לא נמצא: ${rel}`, code: 'not_found' }
    }

    const matches: Array<{ path: string; line: number; text: string }> = []

    function searchFile(file: string): void {
      if (matches.length >= maxMatches) return
      if (BINARY_EXT.has(extname(file).toLowerCase())) return
      if (isSecretPath(file)) return
      const posix = toPosixRel(ctx.rootDir, file)
      if (!matchGlob(posix, glob)) return
      let content: string
      try {
        content = readFileSync(file, 'utf8')
      } catch {
        return
      }
      if (content.includes('\0')) return
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxMatches) break
        if (regex.test(lines[i])) {
          matches.push({ path: posix, line: i + 1, text: lines[i].slice(0, 400) })
        }
        // reset lastIndex for global-less; /g not used so ok
      }
    }

    function walk(dir: string): void {
      if (matches.length >= maxMatches) return
      const st = statSync(dir)
      if (st.isFile()) {
        searchFile(dir)
        return
      }
      if (!st.isDirectory()) return
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        if (matches.length >= maxMatches) break
        if (SKIP_DIRS.has(name)) continue
        walk(join(dir, name))
      }
    }

    walk(start)

    const content = matches.length
      ? matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n')
      : 'No matches'
    return {
      ok: true,
      content,
      data: { count: matches.length, truncated: matches.length >= maxMatches }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'grep_failed'
    }
  }
}
