import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { SupabaseConnectInput } from '../../../shared/types'
import {
  setSecret,
  getSecret,
  clearSecret,
  supabaseAnonSlot,
  supabaseServiceSlot
} from '../secrets'
import { getProject } from '../storage'
import { updateIntegrations, loadIntegrations } from './store'

const SUPABASE_URL_RE = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i

export function normalizeSupabaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!SUPABASE_URL_RE.test(trimmed)) {
    throw new Error('כתובת Supabase לא חוקית. צפוי: https://xxxxx.supabase.co')
  }
  return trimmed
}

export async function testSupabaseConnection(
  projectUrl: string,
  anonKey: string
): Promise<{ ok: boolean; message: string }> {
  const url = normalizeSupabaseUrl(projectUrl)
  const key = anonKey.trim()
  if (!key || key.length < 20) {
    throw new Error('מפתח anon/publishable קצר מדי או חסר')
  }

  const res = await fetch(`${url}/rest/v1/`, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  })

  // 200 OK or 404 on root is fine; 401/403 means bad key
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'מפתח לא תקין או אין הרשאה (401/403)' }
  }
  if (res.status >= 500) {
    return { ok: false, message: `שגיאת שרת Supabase (${res.status})` }
  }
  return { ok: true, message: 'החיבור ל-Supabase הצליח' }
}

export async function connectSupabase(input: SupabaseConnectInput): Promise<{
  ok: boolean
  message: string
}> {
  const project = getProject(input.projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')

  const url = normalizeSupabaseUrl(input.projectUrl)
  const anon = input.anonKey.trim()
  if (!anon) throw new Error('נדרש מפתח anon / publishable')

  const test = await testSupabaseConnection(url, anon)
  if (!test.ok) {
    throw new Error(test.message)
  }

  setSecret(supabaseAnonSlot(input.projectId), anon)
  if (input.serviceRoleKey?.trim()) {
    setSecret(supabaseServiceSlot(input.projectId), input.serviceRoleKey.trim())
  }

  updateIntegrations(input.projectId, {
    supabase: {
      connected: true,
      projectUrl: url,
      hasAnonKey: true,
      hasServiceKey: Boolean(input.serviceRoleKey?.trim()),
      lastTestOk: true,
      lastTestAt: new Date().toISOString()
    }
  })

  if (input.writeEnvFiles !== false) {
    writeSupabaseEnvFiles(project.folderPath, url, anon, input.serviceRoleKey?.trim())
  }
  if (input.scaffoldClient !== false) {
    scaffoldSupabaseClient(project.folderPath)
  }

  return { ok: true, message: 'Supabase חובר לפרויקט; נוצרו קבצי .env' }
}

export function disconnectSupabase(projectId: string): void {
  clearSecret(supabaseAnonSlot(projectId))
  clearSecret(supabaseServiceSlot(projectId))
  updateIntegrations(projectId, {
    supabase: {
      connected: false,
      projectUrl: undefined,
      hasAnonKey: false,
      hasServiceKey: false,
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
    existing = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
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
  return `
## Supabase מחובר לפרויקט
- URL: ${meta.projectUrl}
- יש anon/publishable key בקובץ .env (VITE_SUPABASE_ANON_KEY)
- service_role: ${hasService ? 'קיים ב-.env.local בלבד — לעולם אל תשים אותו בקוד קליינט' : 'לא הוגדר'}

### איך לעבוד עם Supabase כאן
- לקוח: \`src/lib/supabase.ts\` אם קיים (בדוק \`isSupabaseConfigured\` לפני שימוש). אם אין —
  הוסף \`"@supabase/supabase-js": "^2.50.0"\` ל-dependencies ב-package.json, הרץ \`npm install\`, וצור את הקובץ.
- נתונים: \`supabase.from('table').select/insert/update/delete\` — טבלאות/עמודות ב-snake_case.
- אימות משתמשים: \`supabase.auth.signUp / signInWithPassword / signOut / onAuthStateChange\` —
  אל תבנה מערכת סיסמאות משלך.
- Realtime: \`supabase.channel(...).on('postgres_changes', ...)\` לעדכונים חיים.
- אחסון קבצים: \`supabase.storage.from('bucket')\` להעלאות.
- **RLS חובה על כל טבלה ב-public.** כשאתה מציע סכמה — כלול גם policies.
- יצירת טבלאות: אין לך גישה ישירה ל-DB — כתוב למשתמש את ה-SQL המלא (CREATE TABLE + RLS policies)
  בבלוק sql והנחה אותו להריץ ב-SQL Editor של Supabase.
`
}

export { SUPABASE_URL_RE }
