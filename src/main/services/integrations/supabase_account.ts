/**
 * חשבון Supabase מחובר ברמת האפליקציה (OAuth), לא לפי פרויקט.
 *
 * אחרי «התחבר ל-Supabase» המשתמש בוחר פרויקט מרשימה — והמערכת מושכת
 * בעצמה את כתובת הפרויקט ואת מפתחות ה-API דרך ה-Management API. אין
 * העתקה ידנית של URL, anon key או Personal Access Token.
 *
 * טוקן ה-OAuth של Supabase פג אחרי כיממה, ולכן הוא מחודש כאן אוטומטית
 * מול ה-broker (שהוא היחיד שמחזיק את ה-client_secret).
 */
import { getSecret, setSecret, clearSecret } from '../secrets'
import { refreshOAuthToken, type OAuthTokens } from './oauth'

const ACCOUNT_SLOT = 'supabase-oauth'
const MANAGEMENT_BASE = 'https://api.supabase.com/v1'
const API_TIMEOUT_MS = 20_000

export interface SupabaseAccountTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  /** שם הארגון להצגה בממשק */
  orgName?: string
}

export interface SupabaseProjectInfo {
  ref: string
  name: string
  organizationId?: string
  region?: string
  status?: string
}

export function loadSupabaseAccount(): SupabaseAccountTokens | null {
  const raw = getSecret(ACCOUNT_SLOT)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SupabaseAccountTokens
    return parsed.accessToken ? parsed : null
  } catch {
    return null
  }
}

function saveSupabaseAccount(tokens: SupabaseAccountTokens): void {
  setSecret(ACCOUNT_SLOT, JSON.stringify(tokens))
}

export function clearSupabaseAccount(): void {
  clearSecret(ACCOUNT_SLOT)
}

export function hasSupabaseAccount(): boolean {
  return Boolean(loadSupabaseAccount())
}

/**
 * טוקן תקף לשימוש מיידי. אם פג — מחודש מול ה-broker ונשמר.
 * מחזיר null אם אין חשבון מחובר בכלל.
 */
export async function getSupabaseAccountToken(): Promise<string | null> {
  const account = loadSupabaseAccount()
  if (!account) return null
  if (!account.expiresAt || account.expiresAt > Date.now()) return account.accessToken
  if (!account.refreshToken) {
    throw new Error('החיבור ל-Supabase פג ואין אפשרות לחדש אותו. התחבר מחדש.')
  }

  let refreshed: OAuthTokens
  try {
    refreshed = await refreshOAuthToken('supabase', account.refreshToken)
  } catch (err) {
    throw new Error(
      `חידוש החיבור ל-Supabase נכשל: ${err instanceof Error ? err.message : String(err)}\n` +
        'התחבר מחדש ל-Supabase בחיבורים.',
      { cause: err }
    )
  }
  saveSupabaseAccount({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || account.refreshToken,
    expiresAt: refreshed.expiresAt,
    orgName: account.orgName
  })
  return refreshed.accessToken
}

async function managementFetch<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(`${MANAGEMENT_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal
    })
  } catch (err) {
    throw new Error(
      `לא הצלחתי להגיע ל-Supabase: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await resp.text()
  if (!resp.ok) {
    let detail = text.slice(0, 300)
    try {
      detail = (JSON.parse(text) as { message?: string }).message || detail
    } catch {
      /* טקסט גולמי */
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`Supabase דחה את החיבור (${resp.status}): ${detail}\nהתחבר מחדש ל-Supabase.`)
    }
    throw new Error(`Supabase החזיר ${resp.status}: ${detail}`)
  }
  return JSON.parse(text) as T
}

/** שומר את הטוקנים אחרי אישור המשתמש, ומאמת אותם מול ה-API */
export async function saveSupabaseOAuth(tokens: OAuthTokens): Promise<{ orgName?: string }> {
  const orgs = await managementFetch<Array<{ id: string; name: string }>>(
    '/organizations',
    tokens.accessToken
  ).catch(() => [] as Array<{ id: string; name: string }>)

  const orgName = orgs[0]?.name
  saveSupabaseAccount({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    orgName
  })
  return { orgName }
}

async function requireToken(): Promise<string> {
  const token = await getSupabaseAccountToken()
  if (!token) throw new Error('חשבון Supabase לא מחובר. לחץ «התחבר ל-Supabase».')
  return token
}

/** הפרויקטים של המשתמש — לבחירה בממשק */
export async function listSupabaseProjects(): Promise<SupabaseProjectInfo[]> {
  const token = await requireToken()
  const raw = await managementFetch<
    Array<{
      id: string
      name: string
      organization_id?: string
      region?: string
      status?: string
    }>
  >('/projects', token)

  return raw
    .map((p) => ({
      ref: p.id,
      name: p.name,
      organizationId: p.organization_id,
      region: p.region,
      status: p.status
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * מפתחות ה-API של הפרויקט — כך שהמשתמש לא מעתיק כלום ביד.
 * `anon` נחוץ לקוד הקליינט; `service_role` נשמר רק ל-.env.local.
 */
export async function getSupabaseProjectKeys(
  ref: string
): Promise<{ anonKey: string; serviceRoleKey?: string }> {
  const token = await requireToken()
  const keys = await managementFetch<Array<{ name?: string; api_key?: string }>>(
    `/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`,
    token
  )

  const find = (name: string): string | undefined =>
    keys.find((k) => k.name === name)?.api_key?.trim() || undefined

  const anonKey = find('anon') || find('publishable') || find('publishable key')
  if (!anonKey) {
    throw new Error(
      'לא הצלחתי לקרוא את מפתח ה-anon של הפרויקט מ-Supabase. ' +
        'ודא שאישרת ל-NF-Blaze הרשאת קריאה למפתחות (Secrets), או חבר ידנית.'
    )
  }
  return { anonKey, serviceRoleKey: find('service_role') || find('secret') }
}
