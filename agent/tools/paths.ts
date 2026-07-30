import { isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import { ToolError } from './types'

const TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/

/** Normalize a relative path and reject traversal / absolute escapes */
export function normalizeRelPath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ToolError('path נדרש', 'invalid_path')
  }
  let raw = input.replace(/\\/g, '/').trim()
  if (raw.startsWith('./')) raw = raw.slice(2)
  raw = raw.replace(/^\/+/, '')
  if (!raw || TRAVERSAL.test(raw) || raw.includes('\0')) {
    throw new ToolError(`נתיב לא תקין: ${input}`, 'invalid_path')
  }
  if (isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw new ToolError(`נתיב מוחלט אסור: ${input}`, 'invalid_path')
  }
  return raw
}

/** Resolve a relative path safely inside rootDir */
export function resolveInRoot(rootDir: string, relativePath: string): string {
  const rel = normalizeRelPath(relativePath)
  const root = resolve(rootDir)
  const full = resolve(root, rel)
  const relBack = relative(root, full)
  if (relBack.startsWith('..') || isAbsolute(relBack)) {
    throw new ToolError(`נתיב מחוץ לשורש הפרויקט: ${relativePath}`, 'path_escape')
  }
  return full
}

export function toPosixRel(rootDir: string, absolutePath: string): string {
  const root = resolve(rootDir)
  const full = resolve(absolutePath)
  return relative(root, full).split(sep).join('/')
}

export function joinUnderRoot(rootDir: string, ...parts: string[]): string {
  return normalize(join(resolve(rootDir), ...parts))
}

/**
 * קבצי סוד — אסור שיגיעו למודל (read/grep) או להיכתב על ידו.
 * `.env.example` מותר — אין בו ערכים אמיתיים.
 */
const SECRET_BASENAME_RE =
  /^(\.env(\..+)?|credentials\.json|secrets?\.[a-z0-9]+|\.npmrc|\.netrc|id_rsa[^/]*)$|\.(pem|key|pfx|p12)$/i

export function isSecretPath(relOrAbs: string): boolean {
  const posix = relOrAbs.replace(/\\/g, '/')
  const base = posix.split('/').pop() || ''
  if (/^\.env\.example$/i.test(base)) return false
  return SECRET_BASENAME_RE.test(base)
}
