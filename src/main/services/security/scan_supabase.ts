/**
 * Probe Supabase tables with the anon key — block if readable without user auth.
 */
import { getSecret, supabaseAnonSlot } from '../secrets'
import { loadIntegrations } from '../integrations/store'
import type { SecurityFinding } from './types'

type OpenApiLike = {
  paths?: Record<string, unknown>
  definitions?: Record<string, unknown>
  components?: { schemas?: Record<string, unknown> }
}

function tableFixSql(table: string): string {
  const t = table.replace(/[^a-zA-Z0-9_]/g, '')
  return [
    `-- תיקון לטבלה public.${t} — חסימת גישת אורחים (anon)`,
    `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`,
    ``,
    `-- הסר מדיניות פתוחה מדי אם קיימת, ואז צור מדיניות לפי המשתמש המחובר:`,
    `-- DROP POLICY IF EXISTS "allow_all" ON public.${t};`,
    ``,
    `CREATE POLICY "${t}_select_own"`,
    `  ON public.${t}`,
    `  FOR SELECT`,
    `  TO authenticated`,
    `  USING (auth.uid() = user_id);`,
    ``,
    `-- אם אין עמודת user_id — התאם את התנאי למודל שלך.`,
    `-- חשוב: אל תיצור POLICY עם USING (true) ל-anon.`,
    `REVOKE ALL ON public.${t} FROM anon;`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${t} TO authenticated;`
  ].join('\n')
}

async function listPublicTables(
  projectUrl: string,
  anonKey: string
): Promise<string[]> {
  const base = projectUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/rest/v1/`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/openapi+json'
    }
  })
  if (!res.ok) {
    // Fallback: try without Accept
    const res2 = await fetch(`${base}/rest/v1/`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      }
    })
    if (!res2.ok) return []
    const text = await res2.text()
    try {
      const json = JSON.parse(text) as OpenApiLike
      return tablesFromOpenApi(json)
    } catch {
      return []
    }
  }
  try {
    const json = (await res.json()) as OpenApiLike
    return tablesFromOpenApi(json)
  } catch {
    return []
  }
}

function tablesFromOpenApi(doc: OpenApiLike): string[] {
  const names = new Set<string>()
  if (doc.paths) {
    for (const p of Object.keys(doc.paths)) {
      const m = p.match(/^\/([A-Za-z_][\w]*)$/)
      if (m) names.add(m[1]!)
    }
  }
  const schemas = doc.definitions || doc.components?.schemas || {}
  for (const k of Object.keys(schemas)) {
    if (/^[A-Za-z_][\w]*$/.test(k) && !k.includes(' ')) names.add(k)
  }
  // Filter internal
  return Array.from(names).filter(
    (n) => !n.startsWith('rpc/') && n !== 'graphql' && n !== 'graphql_public'
  )
}

/**
 * Returns true if anon can SELECT from the table (RLS missing or open).
 */
async function anonCanSelect(
  projectUrl: string,
  anonKey: string,
  table: string
): Promise<{ open: boolean; status: number; detail: string }> {
  const base = projectUrl.replace(/\/+$/, '')
  const url = `${base}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`
  const res = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: 'count=exact'
    }
  })
  const text = (await res.text()).slice(0, 200)
  if (res.status === 401 || res.status === 403) {
    return { open: false, status: res.status, detail: 'אין הרשאה' }
  }
  if (res.status === 404) {
    return { open: false, status: 404, detail: 'לא נמצא' }
  }
  // PostgREST permission denied often 200 with empty + or error JSON
  if (res.status >= 400) {
    if (/permission|rls|policy|not accept/i.test(text)) {
      return { open: false, status: res.status, detail: text }
    }
    return { open: false, status: res.status, detail: text }
  }
  // 200 / 206 — SELECT allowed for anon
  return { open: true, status: res.status, detail: 'SELECT הצליח עם מפתח anon' }
}

export async function scanSupabaseAnonAccess(
  projectId: string
): Promise<SecurityFinding[]> {
  const integ = loadIntegrations(projectId).supabase
  if (!integ.connected || !integ.projectUrl || !integ.hasAnonKey) {
    return []
  }
  const anon = getSecret(supabaseAnonSlot(projectId))
  if (!anon) return []

  const findings: SecurityFinding[] = []
  let tables: string[]
  try {
    tables = await listPublicTables(integ.projectUrl, anon)
  } catch {
    return [
      {
        id: 'supabase-list-failed',
        kind: 'table_open_to_anon',
        severity: 'warn',
        title: 'לא ניתן לסרוק טבלאות Supabase',
        found: 'החיבור ל-Supabase הצליח בעבר, אך לא הצלחנו לקבל רשימת טבלאות לבדיקה.',
        why: 'בלי הסריקה אי אפשר לוודא שאין טבלאות פתוחות לאורחים.',
        fixHint: 'ודא שה-API פעיל ושיש לפחות טבלה אחת ב-public.'
      }
    ]
  }

  // Cap to avoid long deploys
  const limited = tables.slice(0, 40)
  for (const table of limited) {
    try {
      const probe = await anonCanSelect(integ.projectUrl, anon, table)
      if (!probe.open) continue

      findings.push({
        id: `table-open:${table}`,
        kind: 'table_open_to_anon',
        severity: 'block',
        title: `טבלה פתוחה בלי אימות: ${table}`,
        found: `הטבלה public.${table} נקראת בהצלחה עם מפתח ה-anon בלבד (בלי משתמש מחובר). ${probe.detail}.`,
        why: 'כל מבקר באתר יכול לקרוא את הנתונים דרך ה-API הציבורי — דליפת מידע אישי או עסקי.',
        fixHint: tableFixSql(table)
      })

      // Strong warning about permissive RLS (same root cause)
      findings.push({
        id: `rls-open:${table}`,
        kind: 'rls_allows_all',
        severity: 'warn',
        title: `RLS פתוח / חסר על ${table}`,
        found: `גישת anon ל-${table} מצליחה — בדרך כלל כי אין RLS, או שיש מדיניות שמאפשרת הכול (USING true).`,
        why: 'מדיניות שמתירה הכול מבטלת את ההגנה. אורחים רואים את אותם נתונים כמו אדמין.',
        fixHint: tableFixSql(table)
      })
    } catch {
      /* skip table */
    }
  }

  return findings
}
