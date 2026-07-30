/**
 * אימות רישיון מקומי — חתימת Ed25519, בלי שרת ובלי אינטרנט.
 * המפתח נשמר מוצפן (safeStorage) יחד עם טביעת אצבע של המחשב.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'crypto'
import { hostname, userInfo } from 'os'
import { app } from 'electron'
import {
  LICENSE_PUBLIC_KEY_PEM,
  TRIAL_DAYS,
  daysUntil,
  parseLicenseKey,
  signingInput,
  base64urlDecode,
  type LicensePayload,
  type LicenseStatus
} from '../../shared/license'
import { getSecret, setSecret, clearSecret } from './secrets'
import { loadSettingsRaw, saveSettings } from './storage'

const LICENSE_SLOT = 'license-key'
const FINGERPRINT_SLOT = 'license-fingerprint'

/** טביעת אצבע של המחשב — מונעת שיתוף מפתח בין מכונות */
export function machineFingerprint(): string {
  let user = ''
  try {
    user = userInfo().username
  } catch {
    /* ignore */
  }
  return createHash('sha256')
    .update([hostname(), user, process.platform, process.arch].join('|'))
    .digest('hex')
    .slice(0, 32)
}

/** אימות קריפטוגרפי של מפתח — חתימה תקינה + לא פג */
export function verifyLicenseKey(
  key: string,
  now = new Date()
): { valid: boolean; expired: boolean; payload?: LicensePayload } {
  const parsed = parseLicenseKey(key)
  if (!parsed) return { valid: false, expired: false }
  try {
    const pub = createPublicKey(LICENSE_PUBLIC_KEY_PEM)
    const ok = cryptoVerify(
      null,
      signingInput(parsed.payloadB64),
      pub,
      base64urlDecode(parsed.sigB64)
    )
    if (!ok) return { valid: false, expired: false }
  } catch {
    return { valid: false, expired: false }
  }
  const expired = Boolean(parsed.payload.exp && daysUntil(parsed.payload.exp, now) < 0)
  return { valid: true, expired, payload: parsed.payload }
}

/** תאריך ההתקנה — בסיס לתקופת הניסיון */
function installedAt(): string {
  const settings = loadSettingsRaw()
  if (settings.installedAt) return settings.installedAt
  const now = new Date().toISOString()
  saveSettings({ installedAt: now })
  return now
}

function trialDaysLeft(now = new Date()): number {
  const start = new Date(installedAt())
  const used = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  return TRIAL_DAYS - used
}

export function getLicenseStatus(now = new Date()): LicenseStatus {
  const stored = getSecret(LICENSE_SLOT)

  if (stored) {
    const res = verifyLicenseKey(stored, now)
    if (!res.valid) {
      return {
        state: 'invalid',
        ok: false,
        messageHe: 'מפתח הרישיון אינו תקין. הזינו מפתח חדש.'
      }
    }
    // מפתח נעול למחשב אחר
    const boundTo = getSecret(FINGERPRINT_SLOT)
    if (boundTo && boundTo !== machineFingerprint()) {
      return {
        state: 'invalid',
        ok: false,
        messageHe: 'המפתח הופעל במחשב אחר. פנו לקבלת מפתח למחשב הזה.'
      }
    }
    if (res.expired) {
      return {
        state: 'expired',
        ok: false,
        name: res.payload?.n,
        expiresAt: res.payload?.exp,
        messageHe: `הרישיון פג ב-${res.payload?.exp}. פנו לחידוש.`
      }
    }
    const left = res.payload?.exp ? daysUntil(res.payload.exp, now) : undefined
    return {
      state: 'licensed',
      ok: true,
      name: res.payload?.n,
      expiresAt: res.payload?.exp,
      daysLeft: left,
      messageHe: res.payload?.exp
        ? `רישיון פעיל · ${res.payload.n} · בתוקף עוד ${left} ימים`
        : `רישיון פעיל · ${res.payload?.n}`
    }
  }

  const left = trialDaysLeft(now)
  if (left > 0) {
    return {
      state: 'trial',
      ok: true,
      daysLeft: left,
      messageHe: `תקופת ניסיון — נותרו ${left} ימים`
    }
  }
  return {
    state: 'trial_expired',
    ok: false,
    daysLeft: 0,
    messageHe: 'תקופת הניסיון הסתיימה. הזינו מפתח רישיון כדי להמשיך.'
  }
}

/** הפעלת מפתח — מאמת, שומר מוצפן, ונועל למחשב הנוכחי */
export function activateLicense(key: string): LicenseStatus {
  const res = verifyLicenseKey(key)
  if (!res.valid) {
    return { state: 'invalid', ok: false, messageHe: 'המפתח אינו תקין — בדקו שהועתק במלואו.' }
  }
  if (res.expired) {
    return {
      state: 'expired',
      ok: false,
      expiresAt: res.payload?.exp,
      messageHe: `המפתח פג ב-${res.payload?.exp}.`
    }
  }
  setSecret(LICENSE_SLOT, key.trim())
  setSecret(FINGERPRINT_SLOT, machineFingerprint())
  return getLicenseStatus()
}

export function clearLicense(): LicenseStatus {
  clearSecret(LICENSE_SLOT)
  clearSecret(FINGERPRINT_SLOT)
  return getLicenseStatus()
}
