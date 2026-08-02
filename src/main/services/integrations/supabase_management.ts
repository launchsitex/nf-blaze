/**
 * גישת הסוכן ל-Supabase דרך ה-Management API — בדיוק כמו Dyad.
 *
 * הסוכן מריץ SQL ישירות מול המסד של הפרויקט המחובר (יצירת טבלאות + RLS,
 * שינוי נתונים, קריאת סכמה) בעזרת Personal Access Token, דרך הנקודה
 * `POST https://api.supabase.com/v1/projects/{ref}/database/query`.
 *
 * המפתח הפרטי של הרישוי לא קשור לכאן; זהו הטוקן של *המשתמש* לפרויקט *שלו*.
 */
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { McpExternalTool } from '../../../../agent/mcp/manager'
import { getSecret, supabaseMgmtSlot } from '../secrets'
import { getProject } from '../storage'
import { loadIntegrations } from './store'
import { getSupabaseAccountToken, hasSupabaseAccount } from './supabase_account'

const MANAGEMENT_BASE = 'https://api.supabase.com/v1'
const SQL_TIMEOUT_MS = 30_000

/** מזהה הפרויקט (ref) מתוך כתובת ה-Supabase */
export function projectRefFromUrl(url: string): string | null {
  const m = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i.exec((url || '').trim())
  return m ? m[1]! : null
}

/**
 * האם ה-SQL הרסני (מוחק נתונים/מבנה)? משמש לאזהרה למשתמש לפני ביצוע.
 * מזהה DROP / TRUNCATE / DELETE / ALTER ... DROP COLUMN.
 */
export function isDestructiveSql(sql: string): boolean {
  // מסירים מחרוזות והערות כדי לא לזהות מילות מפתח בתוך תוכן
  const stripped = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  return /\b(drop\s+(table|schema|database|column|function|view|type|policy|index|trigger)|truncate\b|delete\s+from|alter\s+table\s+[^\n;]*\bdrop\b)/i.test(
    stripped
  )
}

/** הרצת SQL דרך ה-Management API */
export async function runManagementSql(
  ref: string,
  token: string,
  sql: string
): Promise<{ ok: boolean; rows?: unknown[]; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SQL_TIMEOUT_MS)
  try {
    const resp = await fetch(`${MANAGEMENT_BASE}/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal
    })
    const text = await resp.text()
    if (!resp.ok) {
      let msg = text
      try {
        msg = (JSON.parse(text) as { message?: string }).message || text
      } catch {
        /* plain text */
      }
      return { ok: false, error: `Supabase (${resp.status}): ${msg.slice(0, 300)}` }
    }
    let rows: unknown[] = []
    try {
      const parsed = JSON.parse(text)
      rows = Array.isArray(parsed) ? parsed : []
    } catch {
      rows = []
    }
    return { ok: true, rows }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `לא הצלחתי להריץ SQL מול Supabase: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * שני מסלולי גישה למסד, לפי סדר עדיפות:
 * 1. Personal Access Token שהודבק לפרויקט הזה (המסלול הישן, עדיין נתמך).
 * 2. חשבון Supabase שחובר ב-OAuth ברמת האפליקציה — הטוקן מחודש לבד.
 */
export function hasSupabaseDbAccess(projectId: string): boolean {
  return Boolean(getSecret(supabaseMgmtSlot(projectId))) || hasSupabaseAccount()
}

export async function resolveSupabaseAccessToken(projectId: string): Promise<string | null> {
  const pat = getSecret(supabaseMgmtSlot(projectId))
  if (pat) return pat
  return getSupabaseAccountToken()
}

/** יומן SQL לביקורת — כל הרצה נרשמת בפרויקט */
function logSql(folderPath: string, sql: string, result: string): void {
  try {
    const p = join(folderPath, '.nf-blaze', 'sql-log.jsonl')
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify({ at: new Date().toISOString(), sql, result }) + '\n', 'utf-8')
  } catch {
    /* יומן הוא נחמד-שיהיה; כשלו לא מפיל את ההרצה */
  }
}

function formatRows(rows: unknown[]): string {
  if (!rows.length) return '✓ בוצע (0 שורות הוחזרו).'
  const preview = rows.slice(0, 50)
  const more = rows.length > 50 ? `\n… ועוד ${rows.length - 50} שורות` : ''
  return `✓ בוצע. ${rows.length} שורות:\n${JSON.stringify(preview, null, 1)}${more}`
}

/**
 * בונה את כלי `run_sql` לסוכן אם לפרויקט יש access token. מוחזר null אחרת,
 * ואז הסוכן חוזר להתנהגות «כתוב SQL למשתמש».
 */
export function buildSupabaseSqlTool(projectId: string): McpExternalTool | null {
  const meta = loadIntegrations(projectId).supabase
  if (!hasSupabaseDbAccess(projectId) || !meta.connected || !meta.projectUrl) return null
  const ref = projectRefFromUrl(meta.projectUrl)
  if (!ref) return null
  const folderPath = getProject(projectId)?.folderPath || ''

  return {
    definition: {
      name: 'run_sql',
      description:
        'מריץ SQL ישירות מול ה-Supabase המחובר לפרויקט (יצירת טבלאות + RLS, ' +
        'קריאה/כתיבה של נתונים, שינוי סכמה). השתמש בזה במקום לבקש מהמשתמש להריץ SQL ידנית. ' +
        'תמיד כלול RLS policies על טבלאות חדשות ב-public. ' +
        'לפעולות הרסניות (DROP / DELETE / TRUNCATE) — הזהר את המשתמש בצ׳אט וקבל אישור מפורש, ' +
        'ורק אז קרא שוב עם confirm=true.',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'משפט/י ה-SQL להרצה' },
          confirm: {
            type: 'boolean',
            description: 'נדרש true לפעולות הרסניות, רק אחרי אישור מפורש של המשתמש בצ׳אט'
          }
        },
        required: ['sql']
      }
    },
    execute: async (args: Record<string, unknown>) => {
      const sql = typeof args.sql === 'string' ? args.sql.trim() : ''
      const confirm = args.confirm === true
      if (!sql) return { content: 'חסר פרמטר sql.', isError: true }

      // גדר בטיחות: פעולה הרסנית ללא אישור → עוצרים ומבקשים מהסוכן להזהיר את המשתמש
      if (isDestructiveSql(sql) && !confirm) {
        return {
          content:
            '⚠️ פעולה הרסנית (מוחקת נתונים או מבנה). לא בוצעה.\n' +
            'הסבר למשתמש בצ׳אט מה עומד להימחק, בקש אישור מפורש, ורק אחרי שהוא מאשר — ' +
            'קרא שוב ל-run_sql עם אותו SQL ו-confirm=true.',
          isError: true
        }
      }

      // הטוקן נפתר בזמן ההרצה — חיבור OAuth מתחדש מעצמו כשהוא פג
      let token: string | null
      try {
        token = await resolveSupabaseAccessToken(projectId)
      } catch (err) {
        return { content: err instanceof Error ? err.message : String(err), isError: true }
      }
      if (!token) {
        return { content: 'אין גישה למסד — חבר חשבון Supabase בחיבורים.', isError: true }
      }

      const res = await runManagementSql(ref, token, sql)
      if (folderPath) logSql(folderPath, sql, res.ok ? 'ok' : res.error || 'error')
      if (!res.ok) return { content: res.error || 'שגיאה לא ידועה', isError: true }
      return { content: formatRows(res.rows || []), isError: false }
    }
  }
}
