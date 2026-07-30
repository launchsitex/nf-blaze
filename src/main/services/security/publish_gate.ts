/**
 * Pre-publish security gate for Vercel.
 * Blocking findings → deploy must not proceed (unless explicit override).
 */
import {
  buildSummaryHebrew,
  formatFindingsForAgent,
  SECURITY_OVERRIDE_PHRASE,
  type PublishSecurityReport,
  type SecurityFinding
} from './types'
import {
  scanClientSecrets,
  scanEnvInBuild,
  scanPermissiveRlsInSql
} from './scan_secrets'
import { scanSupabaseAnonAccess } from './scan_supabase'

export {
  SECURITY_OVERRIDE_PHRASE,
  formatFindingsForAgent,
  type PublishSecurityReport,
  type SecurityFinding
}

export type SecurityOverrideAck = {
  /** Must be true */
  confirmed: boolean
  /** Must equal SECURITY_OVERRIDE_PHRASE */
  phrase: string
}

function isValidOverride(ack?: SecurityOverrideAck | null): boolean {
  if (!ack?.confirmed) return false
  return (ack.phrase || '').trim() === SECURITY_OVERRIDE_PHRASE
}

export async function runPublishSecurityGate(opts: {
  projectId: string
  folderPath: string
  override?: SecurityOverrideAck | null
}): Promise<PublishSecurityReport> {
  const findings: SecurityFinding[] = []

  findings.push(...scanEnvInBuild(opts.folderPath))
  findings.push(...scanClientSecrets(opts.folderPath))
  findings.push(...scanPermissiveRlsInSql(opts.folderPath))

  try {
    findings.push(...(await scanSupabaseAnonAccess(opts.projectId)))
  } catch (err) {
    findings.push({
      id: 'supabase-scan-error',
      kind: 'table_open_to_anon',
      severity: 'warn',
      title: 'סריקת Supabase נכשלה חלקית',
      found: err instanceof Error ? err.message : String(err),
      why: 'לא וידאנו במלואה שאין טבלאות פתוחות.'
    })
  }

  // Dedupe by id
  const byId = new Map<string, SecurityFinding>()
  for (const f of findings) {
    if (!byId.has(f.id)) byId.set(f.id, f)
  }
  const unique = Array.from(byId.values())
  const blocks = unique.filter((f) => f.severity === 'block')
  const blocked = blocks.length > 0 && !isValidOverride(opts.override)

  return {
    ok: !blocked,
    blocked,
    findings: unique,
    summaryHebrew: buildSummaryHebrew(unique)
  }
}
