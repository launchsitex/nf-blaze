/**
 * פורמט רישיון NF-Blaze — משותף לאפליקציה ול-CLI ההנפקה.
 * מפתח = NFB1.<base64url(payload)>.<base64url(ed25519 signature)>
 * החתימה נוצרת עם המפתח הפרטי (אצל המפתח בלבד) ומאומתת עם הציבורי שמוטמע כאן.
 */

export const LICENSE_PREFIX = 'NFB1'

/** ימי ניסיון מרגע ההתקנה, לפני שנדרש מפתח */
export const TRIAL_DAYS = 14

/** המפתח הציבורי לאימות — אין בו סוד, הוא רק מאמת חתימות */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALRDEBWUjToLBw7A+JMx4G5EMhbgGUZh3v5orGVfhKPw=
-----END PUBLIC KEY-----`

export interface LicensePayload {
  /** מזהה ייחודי לרישיון (למעקב) */
  id: string
  /** שם הלקוח */
  n: string
  /** אימייל (אופציונלי) */
  e?: string
  /** תאריך תפוגה YYYY-MM-DD; ריק = ללא הגבלת זמן */
  exp?: string
  /** רמת רישיון */
  t?: 'full' | 'trial'
  /** תאריך הנפקה */
  iat: string
}

export type LicenseState =
  | 'licensed'
  | 'trial'
  | 'trial_expired'
  | 'expired'
  | 'invalid'
  | 'none'

export interface LicenseStatus {
  state: LicenseState
  /** האם מותר להשתמש במערכת */
  ok: boolean
  name?: string
  expiresAt?: string
  /** ימים שנותרו (רישיון או ניסיון) */
  daysLeft?: number
  messageHe: string
}

export function base64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

/** בונה את המחרוזת שנחתמת — חייב להיות זהה בהנפקה ובאימות */
export function signingInput(payloadB64: string): Buffer {
  return Buffer.from(`${LICENSE_PREFIX}.${payloadB64}`, 'utf-8')
}

export function formatLicenseKey(payloadB64: string, sigB64: string): string {
  return `${LICENSE_PREFIX}.${payloadB64}.${sigB64}`
}

/** פירוק מפתח למרכיביו; null אם המבנה שגוי */
export function parseLicenseKey(
  key: string
): { payloadB64: string; sigB64: string; payload: LicensePayload } | null {
  const clean = key.trim().replace(/\s+/g, '')
  const parts = clean.split('.')
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return null
  try {
    const payload = JSON.parse(base64urlDecode(parts[1]!).toString('utf-8')) as LicensePayload
    if (!payload?.id || !payload?.n) return null
    return { payloadB64: parts[1]!, sigB64: parts[2]!, payload }
  } catch {
    return null
  }
}

/** ימים שנותרו עד תאריך (שלילי = עבר) */
export function daysUntil(dateIso: string, now = new Date()): number {
  const end = new Date(`${dateIso}T23:59:59`)
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000)
}
