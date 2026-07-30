/** Path helpers for session workdir — block traversal outside the work root */

const TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/

export function normalizeRelPath(input: string): string {
  const raw = input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!raw || TRAVERSAL.test(raw) || raw.includes('\0')) {
    throw new Error(`נתיב קובץ לא תקין ב-sandbox: ${input}`)
  }
  if (raw.startsWith('~')) {
    throw new Error(`נתיב קובץ אסור ב-sandbox: ${input}`)
  }
  return raw
}

export function toAbsoluteInWorkdir(workdir: string, relativePath: string): string {
  const rel = normalizeRelPath(relativePath)
  const root = workdir.replace(/\/+$/, '')
  return `${root}/${rel}`
}
