/** מיפוי סיומת קובץ → שפת Monaco (עורך + תצוגת diff) */
export function languageFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.mjs')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.scss')) return 'scss'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.svg')) return 'xml'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.sql')) return 'sql'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.sh')) return 'shell'
  return 'plaintext'
}
