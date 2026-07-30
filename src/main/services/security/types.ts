/**
 * Publish security gate — findings types.
 * Blocking findings stop Vercel deploy until fixed or explicitly overridden.
 */

export type SecuritySeverity = 'block' | 'warn'

export type SecurityFindingKind =
  | 'service_role_in_client'
  | 'secret_in_client_bundle'
  | 'env_in_build'
  | 'table_open_to_anon'
  | 'rls_allows_all'
  | 'hardcoded_secret'

export interface SecurityFinding {
  id: string
  kind: SecurityFindingKind
  severity: SecuritySeverity
  /** Short Hebrew title */
  title: string
  /** What was found — plain Hebrew */
  found: string
  /** Why it's dangerous — plain Hebrew */
  why: string
  /** Optional exact SQL / steps to fix */
  fixHint?: string
  /** File path when relevant */
  path?: string
}

export interface PublishSecurityReport {
  ok: boolean
  blocked: boolean
  findings: SecurityFinding[]
  /** Hebrew multi-line summary for UI / agent */
  summaryHebrew: string
}

/** Phrase the user must type to acknowledge override */
export const SECURITY_OVERRIDE_PHRASE = 'אני מבין את הסיכון ורוצה לפרסם בכל זאת'

export function formatFindingsForAgent(report: PublishSecurityReport): string {
  const lines = [
    'הפרסום ל-Vercel נחסם בגלל בעיית אבטחה. תקן את הממצאים הבאים ואז אודיע שאפשר לפרסם שוב.',
    'אל תתעלם מבעיות מסוג חסימה — הן מסוכנות.',
    ''
  ]
  for (const f of report.findings) {
    lines.push(`### ${f.severity === 'block' ? 'חסימה' : 'אזהרה'}: ${f.title}`)
    lines.push(`נמצא: ${f.found}`)
    lines.push(`למה מסוכן: ${f.why}`)
    if (f.path) lines.push(`קובץ: ${f.path}`)
    if (f.fixHint) lines.push(`תיקון:\n${f.fixHint}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function buildSummaryHebrew(findings: SecurityFinding[]): string {
  if (!findings.length) return 'לא נמצאו בעיות אבטחה בפרסום.'
  const blocks = findings.filter((f) => f.severity === 'block')
  const warns = findings.filter((f) => f.severity === 'warn')
  const lines: string[] = []
  if (blocks.length) {
    lines.push(`נמצאו ${blocks.length} בעיות שחוסמות פרסום:`)
    for (const f of blocks) {
      lines.push(`• ${f.title} — ${f.found}`)
    }
  }
  if (warns.length) {
    lines.push(`אזהרות חזקות (${warns.length}):`)
    for (const f of warns) {
      lines.push(`• ${f.title} — ${f.found}`)
    }
  }
  return lines.join('\n')
}
