import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { SupabaseConnectInput } from '../../../shared/types'
import {
  setSecret,
  getSecret,
  clearSecret,
  supabaseAnonSlot,
  supabaseServiceSlot,
  supabaseMgmtSlot
} from '../secrets'
import { getProject } from '../storage'
import { updateIntegrations, loadIntegrations } from './store'
import {
  hasSupabaseDbAccess,
  projectRefFromUrl,
  resolveSupabaseAccessToken,
  runManagementSql
} from './supabase_management'
import { getSupabaseProjectKeys } from './supabase_account'

const SUPABASE_URL_RE = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i

export function normalizeSupabaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!SUPABASE_URL_RE.test(trimmed)) {
    throw new Error('כתובת Supabase לא חוקית. צפוי: https://xxxxx.supabase.co')
  }
  return trimmed
}

/**
 * ניקוי מפתח שהודבק.
 * העתקה מהדשבורד גוררת לא פעם רווחים, שורה חדשה או תווים בלתי-נראים
 * באמצע — ואז המפתח נכשל בלי שום סימן חיצוני. מפתחות Supabase לעולם
 * לא מכילים רווח, אז אפשר להסיר הכול בבטחה.
 */
/**
 * רווחים · תווי רוחב-אפס וסימני כיווניות (U+200B–U+200F) · BOM (U+FEFF).
 * נבנה מ-RegExp כדי שהקובץ לא יכיל תווים בלתי-נראים בעצמו.
 */
const INVISIBLE_IN_KEY = new RegExp('[\\s\\u200B-\\u200F\\uFEFF]', 'g')

export function sanitizeSupabaseKey(raw: string): string {
  return (raw || '').replace(INVISIBLE_IN_KEY, '')
}

/** מפתחות דור ישן הם JWT; החדשים (`sb_publishable_`) אינם */
export function isJwtKey(key: string): boolean {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key)
}

/** תפקיד המפתח מתוך ה-JWT — לזיהוי מפתח שהודבק בשדה הלא נכון */
export function jwtKeyRole(key: string): string | null {
  if (!isJwtKey(key)) return null
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1]!, 'base64').toString('utf8')) as {
      role?: string
    }
    return payload.role ?? null
  } catch {
    return null
  }
}

/**
 * כותרות לפי סוג המפתח.
 *
 * מפתח publishable אינו JWT, ו-Supabase מתעד במפורש שאסור לשלוח אותו
 * ב-`Authorization: Bearer`. שולחים אותו ב-`apikey` בלבד; Bearer נשמר
 * למפתחות JWT מהדור הישן, שם הוא הפורמט התקין.
 */
export function supabaseAuthHeaders(key: string): Record<string, string> {
  return isJwtKey(key) ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }
}

/**
 * נקודת הבדיקה.
 *
 * **לא** `/rest/v1/` — הוא מחזיר את סכמת ה-OpenAPI ומוגבל ל-service_role
 * בלבד, כך שמפתח anon תקין לחלוטין נדחה שם עם
 * «Only the `service_role` API key can be used for this endpoint».
 * `/auth/v1/health` מאמת את המפתח ומקבל anon ו-publishable כאחד.
 */
const HEALTH_PATH = '/auth/v1/health'

/**
 * המפתח נדחה כי הוא פסול, או רק כי הנקודה מוגבלת?
 * הודעה על הגבלת service_role מוכיחה שהמפתח **כן** התקבל.
 */
function isEndpointRestriction(body: string): boolean {
  return /only the .?service_role.? api key/i.test(body)
}

/** הופך את התשובה של Supabase להודעה שאפשר לפעול לפיה */
function explainSupabaseFailure(status: number, body: string, key: string): string {
  let message: string
  let hint = ''
  try {
    const parsed = JSON.parse(body) as { message?: string; hint?: string }
    message = parsed.message || ''
    hint = parsed.hint || ''
  } catch {
    message = body.slice(0, 200)
  }

  const role = jwtKeyRole(key)
  if (role === 'service_role') {
    return 'הדבקת מפתח service_role בשדה של anon. את service_role שים בשדה השלישי בלבד — הוא לעולם לא הולך לקליינט.'
  }

  const detail = [message, hint].filter(Boolean).join(' · ')
  if (status === 401 || status === 403) {
    return [
      `Supabase דחה את המפתח (${status}).`,
      detail ? `התשובה: ${detail}` : '',
      'בדוק שהעתקת את המפתח מ-Project Settings ← API Keys של **אותו** פרויקט שכתובתו למעלה.'
    ]
      .filter(Boolean)
      .join('\n')
  }
  return `Supabase החזיר ${status}${detail ? ` — ${detail}` : ''}`
}

export async function testSupabaseConnection(
  projectUrl: string,
  anonKey: string
): Promise<{ ok: boolean; message: string }> {
  const url = normalizeSupabaseUrl(projectUrl)
  const key = sanitizeSupabaseKey(anonKey)
  if (!key || key.length < 20) {
    throw new Error('מפתח anon/publishable קצר מדי או חסר')
  }
  if (jwtKeyRole(key) === 'service_role') {
    throw new Error(
      'זהו מפתח service_role, לא anon. שים אותו בשדה השלישי (service_role) — בשדה הזה נדרש anon / publishable.'
    )
  }

  let res: Response
  try {
    res = await fetch(`${url}${HEALTH_PATH}`, {
      method: 'GET',
      headers: supabaseAuthHeaders(key)
    })
  } catch (err) {
    return {
      ok: false,
      message: `לא הצלחתי להגיע ל-${url} — בדוק את הכתובת ואת החיבור לאינטרנט. (${
        err instanceof Error ? err.message : String(err)
      })`
    }
  }

  if (res.ok || res.status === 404) {
    return { ok: true, message: 'החיבור ל-Supabase הצליח' }
  }

  const body = await res.text().catch(() => '')

  // הנקודה סירבה בגלל הרשאות, לא בגלל המפתח — כלומר המפתח תקין
  if (isEndpointRestriction(body)) {
    return { ok: true, message: 'החיבור ל-Supabase הצליח' }
  }

  return { ok: false, message: explainSupabaseFailure(res.status, body, key) }
}

export async function connectSupabase(input: SupabaseConnectInput): Promise<{
  ok: boolean
  message: string
}> {
  const project = getProject(input.projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')

  const url = normalizeSupabaseUrl(input.projectUrl)
  const anon = sanitizeSupabaseKey(input.anonKey)
  if (!anon) throw new Error('נדרש מפתח anon / publishable')

  const test = await testSupabaseConnection(url, anon)
  if (!test.ok) {
    throw new Error(test.message)
  }

  // נשמר אחרי הניקוי — אחרת רווח נסתר ידליף לקבצי .env ויישבר בזמן ריצה
  setSecret(supabaseAnonSlot(input.projectId), anon)
  const service = sanitizeSupabaseKey(input.serviceRoleKey || '')
  if (service) {
    setSecret(supabaseServiceSlot(input.projectId), service)
  }

  // Access token לגישת הסוכן (Management API). אם סופק — מאמתים מולו לפני שמירה,
  // כדי לא לאחסן טוקן שגוי שיכשל בשקט בכל הרצת SQL.
  const token = sanitizeSupabaseKey(input.accessToken || '')
  let hasAgentDbAccess = false
  if (token) {
    const ref = projectRefFromUrl(url)
    if (!ref) throw new Error('לא הצלחתי לחלץ את מזהה הפרויקט מהכתובת.')
    // טעות נפוצה: הדבקת מפתח API של הפרויקט במקום Personal Access Token
    if (!token.startsWith('sbp_')) {
      const looksLikeProjectKey =
        token.startsWith('sb_publishable_') ||
        token.startsWith('sb_secret_') ||
        jwtKeyRole(token) === 'service_role' ||
        jwtKeyRole(token) === 'anon'
      throw new Error(
        looksLikeProjectKey
          ? 'זהו מפתח API של הפרויקט, לא Personal Access Token. לגישת הסוכן צריך טוקן ברמת החשבון שמתחיל ב-sbp_ — מ-Supabase → Account (אווטאר) → Access Tokens (https://supabase.com/dashboard/account/tokens).'
          : 'Personal Access Token אמור להתחיל ב-sbp_. צור אותו ב-Supabase → Account → Access Tokens (https://supabase.com/dashboard/account/tokens).'
      )
    }
    const probe = await runManagementSql(ref, token, 'select 1 as ok')
    if (!probe.ok) {
      throw new Error(
        `ה-Personal Access Token נדחה: ${probe.error}\nוודא שהעתקת אותו מ-Supabase → Account → Access Tokens (מתחיל ב-sbp_), ולא מפתח API של הפרויקט.`
      )
    }
    setSecret(supabaseMgmtSlot(input.projectId), token)
    hasAgentDbAccess = true
  }

  updateIntegrations(input.projectId, {
    supabase: {
      connected: true,
      projectUrl: url,
      hasAnonKey: true,
      hasServiceKey: Boolean(service),
      hasAgentDbAccess,
      lastTestOk: true,
      lastTestAt: new Date().toISOString()
    }
  })

  if (input.writeEnvFiles !== false) {
    writeSupabaseEnvFiles(project.folderPath, url, anon, service || undefined)
  }
  if (input.scaffoldClient !== false) {
    scaffoldSupabaseClient(project.folderPath)
  }

  return { ok: true, message: 'Supabase חובר לפרויקט; נוצרו קבצי .env' }
}

/** מזהה פרויקט Supabase — אותיות קטנות בלבד, כמו בכתובת xxxx.supabase.co */
const PROJECT_REF_RE = /^[a-z0-9-]{16,40}$/

/**
 * חיבור פרויקט אחרי «התחבר ל-Supabase»: המשתמש רק בוחר פרויקט מרשימה,
 * והמפתחות נמשכים מה-Management API. אין הדבקה של URL או מפתחות.
 */
export async function connectSupabaseProjectFromAccount(input: {
  projectId: string
  ref: string
  writeEnvFiles?: boolean
  scaffoldClient?: boolean
}): Promise<{ ok: boolean; message: string }> {
  const project = getProject(input.projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')

  const ref = (input.ref || '').trim().toLowerCase()
  if (!PROJECT_REF_RE.test(ref)) throw new Error('מזהה פרויקט Supabase לא תקין')

  const url = `https://${ref}.supabase.co`
  const { anonKey, serviceRoleKey } = await getSupabaseProjectKeys(ref)

  setSecret(supabaseAnonSlot(input.projectId), anonKey)
  if (serviceRoleKey) setSecret(supabaseServiceSlot(input.projectId), serviceRoleKey)

  // גישת ה-SQL נבדקת ולא מונחת. אם הרשאת Database לא ניתנה לאפליקציה,
  // עדיף שהמשתמש יראה «לא פעילה» עכשיו מאשר שהסוכן ייכשל באמצע עבודה.
  const dbToken = await resolveSupabaseAccessToken(input.projectId)
  const probe = dbToken ? await runManagementSql(ref, dbToken, 'select 1 as ok') : { ok: false }

  updateIntegrations(input.projectId, {
    supabase: {
      connected: true,
      projectUrl: url,
      hasAnonKey: true,
      hasServiceKey: Boolean(serviceRoleKey),
      hasAgentDbAccess: probe.ok,
      lastTestOk: true,
      lastTestAt: new Date().toISOString()
    }
  })

  if (input.writeEnvFiles !== false) {
    writeSupabaseEnvFiles(project.folderPath, url, anonKey, serviceRoleKey)
  }
  if (input.scaffoldClient !== false) {
    scaffoldSupabaseClient(project.folderPath)
  }

  return {
    ok: true,
    message: probe.ok
      ? `Supabase חובר לפרויקט (${ref}); נוצרו קבצי .env, והסוכן יכול להריץ SQL`
      : `Supabase חובר לפרויקט (${ref}); נוצרו קבצי .env. הסוכן לא יוכל להריץ SQL — ` +
        'חסרה הרשאת Database לאפליקציה. נתק והתחבר מחדש אחרי שתעדכן אותה.'
  }
}

export function disconnectSupabase(projectId: string): void {
  clearSecret(supabaseAnonSlot(projectId))
  clearSecret(supabaseServiceSlot(projectId))
  clearSecret(supabaseMgmtSlot(projectId))
  updateIntegrations(projectId, {
    supabase: {
      connected: false,
      projectUrl: undefined,
      hasAnonKey: false,
      hasServiceKey: false,
      hasAgentDbAccess: false,
      lastTestOk: undefined,
      lastTestAt: undefined
    }
  })
}

export function writeSupabaseEnvFiles(
  folderPath: string,
  projectUrl: string,
  anonKey: string,
  serviceKey?: string
): void {
  const envPath = join(folderPath, '.env')
  const envLocalPath = join(folderPath, '.env.local')

  const publicBlock = [
    '# NF-Blaze — Supabase (בטוח לקליינט עם RLS)',
    `VITE_SUPABASE_URL=${projectUrl}`,
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    `NEXT_PUBLIC_SUPABASE_URL=${projectUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_URL=${projectUrl}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    ''
  ].join('\n')

  upsertEnvFile(envPath, publicBlock, [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
  ])

  if (serviceKey) {
    const secretBlock = [
      '# NF-Blaze — service role (רק לשרת! אל תעלה ל-Git)',
      `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
      ''
    ].join('\n')
    upsertEnvFile(envLocalPath, secretBlock, ['SUPABASE_SERVICE_ROLE_KEY'])
  }

  ensureGitignore(folderPath)
}

function upsertEnvFile(filePath: string, block: string, keys: string[]): void {
  let existing = ''
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf-8')
    // Remove previous NF-Blaze managed keys
    const lines = existing.split(/\r?\n/).filter((line) => {
      const key = line.split('=')[0]?.trim()
      return !keys.includes(key)
    })
    existing = lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
  }
  const next = existing ? `${existing}\n\n${block}` : block
  writeFileSync(filePath, next.endsWith('\n') ? next : next + '\n', 'utf-8')
}

function ensureGitignore(folderPath: string): void {
  const gi = join(folderPath, '.gitignore')
  const required = ['.env', '.env.local', '.env.*.local', 'node_modules', '.nf-blaze/snapshots']
  let content = existsSync(gi) ? readFileSync(gi, 'utf-8') : ''
  for (const line of required) {
    if (!content.split(/\r?\n/).some((l) => l.trim() === line)) {
      content = content.trimEnd() + (content ? '\n' : '') + line + '\n'
    }
  }
  writeFileSync(gi, content, 'utf-8')
}

export function scaffoldSupabaseClient(folderPath: string): void {
  const target = join(folderPath, 'src', 'lib', 'supabase.js')
  if (existsSync(target)) return
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(
    target,
    `import { createClient } from '@supabase/supabase-js'

const url = import.meta.env?.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('[NF-Blaze] חסרים VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url || '', key || '')
`,
    'utf-8'
  )
}

export function getSupabaseContextForAgent(projectId: string): string {
  const meta = loadIntegrations(projectId).supabase
  if (!meta.connected || !meta.projectUrl) return ''
  const hasService = Boolean(getSecret(supabaseServiceSlot(projectId)))
  const hasDbAccess = hasSupabaseDbAccess(projectId)

  // גישה ישירה ל-DB דרך הכלי run_sql, או fallback ל«כתוב SQL למשתמש»
  const schemaSection = hasDbAccess
    ? `- יצירת טבלאות ושינוי סכמה: **יש לך גישה ישירה** — השתמש בכלי \`run_sql\` כדי להריץ
  SQL ישירות מול המסד (CREATE TABLE, ALTER, אינדקסים, policies, וגם קריאה/כתיבה של נתונים).
  - **תמיד** כלול RLS policies כשאתה יוצר טבלה ב-public.
  - לקריאת הסכמה הקיימת: \`run_sql\` עם שאילתה על \`information_schema\`.
  - **פעולות הרסניות** (DROP / DELETE / TRUNCATE): הזהר את המשתמש בצ׳אט מה עומד להימחק,
    קבל אישור מפורש, ורק אז קרא ל-run_sql עם confirm=true.
- לוגיקת שרת: השתמש בכלי \`deploy_edge_function\` לכל דבר שאסור שירוץ בדפדפן — קריאה
  ל-API חיצוני עם מפתח סודי, webhooks, תשלומים, או פעולה שדורשת service_role.
  לעולם אל תשים מפתח סודי בקוד הקליינט; העבר את הפעולה לפונקציה.`
    : `- יצירת טבלאות: אין לך גישה ישירה ל-DB — כתוב למשתמש את ה-SQL המלא (CREATE TABLE + RLS policies)
  בבלוק sql והנחה אותו להריץ ב-SQL Editor של Supabase.`

  return `
## Supabase מחובר לפרויקט
- URL: ${meta.projectUrl}
- יש anon/publishable key בקובץ .env (VITE_SUPABASE_ANON_KEY)
- service_role: ${hasService ? 'קיים ב-.env.local בלבד — לעולם אל תשים אותו בקוד קליינט' : 'לא הוגדר'}
- גישת סוכן ל-DB (run_sql): ${hasDbAccess ? 'פעילה' : 'לא הוגדרה'}

### איך לעבוד עם Supabase כאן
- לקוח: \`src/lib/supabase.ts\` אם קיים (בדוק \`isSupabaseConfigured\` לפני שימוש). אם אין —
  הוסף \`"@supabase/supabase-js": "^2.50.0"\` ל-dependencies ב-package.json, הרץ \`npm install\`, וצור את הקובץ.
- נתונים: \`supabase.from('table').select/insert/update/delete\` — טבלאות/עמודות ב-snake_case.
- אימות משתמשים: \`supabase.auth.signUp / signInWithPassword / signOut / onAuthStateChange\` —
  אל תבנה מערכת סיסמאות משלך.
- Realtime: \`supabase.channel(...).on('postgres_changes', ...)\` לעדכונים חיים.
- אחסון קבצים: \`supabase.storage.from('bucket')\` להעלאות.
- **RLS חובה על כל טבלה ב-public.** כשאתה מציע סכמה — כלול גם policies.
${schemaSection}
`
}

export { SUPABASE_URL_RE, HEALTH_PATH, isEndpointRestriction }
