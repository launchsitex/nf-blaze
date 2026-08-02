/**
 * פריסת Edge Functions לפרויקט ה-Supabase של המשתמש.
 *
 * בניגוד לטבלאות ולמדיניות RLS — שנוצרות ב-SQL רגיל דרך `run_sql` —
 * ל-Edge Functions אין טבלה, והדרך היחידה ליצור אותן היא ה-Management API.
 * לכן זה כלי נפרד, והוא דורש את הרשאת «Edge Functions» באפליקציית ה-OAuth.
 *
 * הקוד נשמר גם בתיקיית הפרויקט (`supabase/functions/<slug>/index.ts`), כדי
 * שמה שרץ בענן יהיה גם בגיט ולא ייעלם עם המחשב.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { McpExternalTool } from '../../../../agent/mcp/manager'
import { getProject } from '../storage'
import { loadIntegrations } from './store'
import {
  hasSupabaseDbAccess,
  projectRefFromUrl,
  resolveSupabaseAccessToken
} from './supabase_management'

const MANAGEMENT_BASE = 'https://api.supabase.com/v1'
const DEPLOY_TIMEOUT_MS = 60_000

/** slug חוקי ל-Edge Function: אותיות קטנות, ספרות ומקפים */
export function sanitizeFunctionSlug(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

interface EdgeFunctionInfo {
  slug: string
  name: string
  status?: string
  version?: number
}

async function managementRequest<T>(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEPLOY_TIMEOUT_MS)
  try {
    const resp = await fetch(`${MANAGEMENT_BASE}${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal
    })
    const text = await resp.text()
    if (!resp.ok) {
      let message = text.slice(0, 300)
      try {
        message = (JSON.parse(text) as { message?: string }).message || message
      } catch {
        /* טקסט גולמי */
      }
      return { ok: false, status: resp.status, error: message }
    }
    return { ok: true, data: (text ? JSON.parse(text) : null) as T }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `לא הצלחתי להגיע ל-Supabase: ${err instanceof Error ? err.message : String(err)}`
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function listEdgeFunctions(
  ref: string,
  token: string
): Promise<EdgeFunctionInfo[]> {
  const res = await managementRequest<EdgeFunctionInfo[]>(`/projects/${ref}/functions`, token)
  return res.ok ? res.data || [] : []
}

/**
 * יוצר או מעדכן פונקציה. אין כאן «צור אם לא קיים» של השרת, אז בודקים קודם —
 * אחרת פריסה שנייה של אותה פונקציה נכשלת עם «כבר קיים».
 */
export async function deployEdgeFunction(input: {
  ref: string
  token: string
  slug: string
  code: string
  name?: string
  verifyJwt?: boolean
}): Promise<{ ok: boolean; created?: boolean; version?: number; error?: string }> {
  const { ref, token, slug, code } = input
  const name = input.name?.trim() || slug
  const verify_jwt = input.verifyJwt !== false

  const existing = await managementRequest<EdgeFunctionInfo>(
    `/projects/${ref}/functions/${encodeURIComponent(slug)}`,
    token
  )
  const isUpdate = existing.ok

  const res = isUpdate
    ? await managementRequest<EdgeFunctionInfo>(
        `/projects/${ref}/functions/${encodeURIComponent(slug)}`,
        token,
        { method: 'PATCH', body: { name, body: code, verify_jwt } }
      )
    : await managementRequest<EdgeFunctionInfo>(`/projects/${ref}/functions`, token, {
        method: 'POST',
        body: { slug, name, body: code, verify_jwt }
      })

  if (!res.ok) {
    // 403 כאן פירושו כמעט תמיד שהרשאת Edge Functions לא ניתנה לאפליקציה
    const hint =
      res.status === 403 || res.status === 401
        ? '\nנראה שחסרה הרשאת «Edge Functions» לחיבור ה-Supabase. נתק והתחבר מחדש אחרי שתעדכן אותה.'
        : ''
    return { ok: false, error: `${res.error}${hint}` }
  }
  return { ok: true, created: !isUpdate, version: res.data?.version }
}

/** שמירת הקוד גם בפרויקט — מה שרץ בענן צריך להיות גם בגיט */
function writeFunctionSource(folderPath: string, slug: string, code: string): string | null {
  try {
    const target = join(folderPath, 'supabase', 'functions', slug, 'index.ts')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, code, 'utf-8')
    return join('supabase', 'functions', slug, 'index.ts')
  } catch {
    // כישלון כתיבה לא מבטל פריסה מוצלחת
    return null
  }
}

/**
 * כלי `deploy_edge_function` לסוכן — זמין כשיש גישת Supabase לפרויקט.
 * מוחזר null אחרת, ואז הסוכן פשוט לא יודע שהאפשרות קיימת.
 */
export function buildEdgeFunctionTool(projectId: string): McpExternalTool | null {
  const meta = loadIntegrations(projectId).supabase
  if (!hasSupabaseDbAccess(projectId) || !meta.connected || !meta.projectUrl) return null
  const ref = projectRefFromUrl(meta.projectUrl)
  if (!ref) return null
  const folderPath = getProject(projectId)?.folderPath || ''

  return {
    definition: {
      name: 'deploy_edge_function',
      description:
        'פורס Edge Function (Deno/TypeScript) ל-Supabase של הפרויקט. השתמש בזה ללוגיקת שרת ' +
        'שאסור שתרוץ בדפדפן: קריאה ל-API חיצוני עם מפתח סודי, webhooks, עיבוד תשלומים, ' +
        'משימות שדורשות service_role. פריסה חוזרת של אותו slug מעדכנת את הקוד הקיים. ' +
        'הקוד נשמר גם ב-supabase/functions/<slug>/index.ts בפרויקט. ' +
        'שים לב: SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY זמינים אוטומטית בתוך הפונקציה; ' +
        'סודות אחרים צריך שהמשתמש יגדיר בדשבורד.',
      parameters: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description: 'שם הפונקציה בכתובת — אותיות קטנות ומקפים, למשל send-email'
          },
          code: {
            type: 'string',
            description:
              'קוד TypeScript מלא של הפונקציה, כולל Deno.serve(...). זהו התוכן של index.ts.'
          },
          verify_jwt: {
            type: 'boolean',
            description:
              'האם לדרוש משתמש מחובר (ברירת מחדל true). קבע false ל-webhook ציבורי מספק חיצוני.'
          }
        },
        required: ['slug', 'code']
      }
    },
    execute: async (args: Record<string, unknown>) => {
      const slug = sanitizeFunctionSlug(typeof args.slug === 'string' ? args.slug : '')
      const code = typeof args.code === 'string' ? args.code : ''
      if (!slug) return { content: 'שם פונקציה (slug) חסר או לא חוקי.', isError: true }
      if (!code.trim()) return { content: 'חסר קוד הפונקציה.', isError: true }

      let token: string | null
      try {
        token = await resolveSupabaseAccessToken(projectId)
      } catch (err) {
        return { content: err instanceof Error ? err.message : String(err), isError: true }
      }
      if (!token) {
        return { content: 'אין גישה ל-Supabase — חבר חשבון בחיבורים.', isError: true }
      }

      const res = await deployEdgeFunction({
        ref,
        token,
        slug,
        code,
        verifyJwt: args.verify_jwt !== false
      })
      if (!res.ok) return { content: res.error || 'הפריסה נכשלה.', isError: true }

      const savedAt = folderPath ? writeFunctionSource(folderPath, slug, code) : null
      const url = `https://${ref}.supabase.co/functions/v1/${slug}`
      return {
        content:
          `✓ ${res.created ? 'נוצרה' : 'עודכנה'} הפונקציה «${slug}»` +
          (res.version ? ` (גרסה ${res.version})` : '') +
          `\nכתובת: ${url}` +
          (savedAt ? `\nהקוד נשמר גם ב-${savedAt}` : ''),
        isError: false
      }
    }
  }
}
