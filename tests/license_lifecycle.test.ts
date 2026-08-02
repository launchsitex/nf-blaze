import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { createPrivateKey, sign as cryptoSign } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  base64urlEncode,
  formatLicenseKey,
  signingInput,
  type LicensePayload
} from '../src/shared/license'

// תיקיית userData אמיתית וזמנית — כדי לבדוק את רצפת ה-mtime של קבצי האפליקציה
const userData = vi.hoisted(() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  return mkdtempSync(join(tmpdir(), 'nf-lic-'))
})
const dataDir = join(userData, 'nf-blaze-data')

/**
 * בדיקות מחזור-חיים של הרישיון מול השירות האמיתי (getLicenseStatus/
 * activateLicense/clearLicense), עם אחסון סודות מדומה שנשמר בין קריאות.
 * מכסה שלוש דרישות אבטחה:
 *   1. הסרת רישיון → מצב «אין גישה» מיד.
 *   2. תפוגה חיה → «expired» ברגע שהזמן עובר, בלי צורך בהפעלה מחדש.
 *   3. הגנת שעון → החזרת שעון אחורה אינה מחזירה רישיון שפג.
 */

const secrets = new Map<string, string>()
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../src/main/services/secrets', () => ({
  getSecret: (slot: string) => secrets.get(slot),
  setSecret: (slot: string, v: string) => void secrets.set(slot, v),
  clearSecret: (slot: string) => void secrets.delete(slot)
}))

const { getLicenseStatus, activateLicense, clearLicense } = await import(
  '../src/main/services/license'
)

const pemPath = join(__dirname, '..', 'secrets', 'license-private.pem')
const hasKey = existsSync(pemPath)

/** מנפיק מפתח אמיתי שמאומת מול המפתח הציבורי המוטמע באפליקציה */
function issue(payload: LicensePayload): string {
  const priv = createPrivateKey(readFileSync(pemPath, 'utf8'))
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const sig = cryptoSign(null, signingInput(payloadB64), priv)
  return formatLicenseKey(payloadB64, base64urlEncode(sig))
}

const forever: LicensePayload = { id: 'life0001', n: 'לקוח', t: 'full', iat: '2026-07-31' }
const timed = (exp: string): LicensePayload => ({
  id: 'life0002',
  n: 'לקוח מוגבל',
  exp,
  t: 'full',
  iat: '2026-06-01'
})

beforeEach(() => {
  secrets.clear()
  // תיקיית נתונים נקייה בכל בדיקה, כדי ש-mtime של קבצים לא ידלוף בין תרחישים
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

afterAll(() => {
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('דרישה 1 — הסרת רישיון מוציאה מיד למסך הרישיון', () => {
  it.skipIf(!hasKey)('אחרי clearLicense המצב הוא none ו-ok=false', () => {
    const activated = activateLicense(issue(forever))
    expect(activated.ok).toBe(true)
    expect(activated.state).toBe('licensed')
    expect(secrets.has('license-key')).toBe(true)

    const after = clearLicense()
    expect(after.ok).toBe(false)
    expect(after.state).toBe('none')
    expect(secrets.has('license-key')).toBe(false)
    // בדיקה חוזרת (כמו הפולינג החי ב-App) עדיין מחזירה «אין גישה»
    expect(getLicenseStatus().ok).toBe(false)
  })
})

describe('דרישה 2 — תפוגה חיה מחזירה למסך הרישיון', () => {
  it.skipIf(!hasKey)('תקף ביום התפוגה, פג למחרת — בלי יום בונוס', () => {
    secrets.set('license-key', issue(timed('2026-07-10')))

    const onExpDay = getLicenseStatus(new Date('2026-07-10T09:00:00'))
    expect(onExpDay.ok).toBe(true)
    expect(onExpDay.daysLeft).toBe(1) // «נשאר יום אחד» — טריגר הפופ-אפ

    const dayAfter = getLicenseStatus(new Date('2026-07-11T09:00:00'))
    expect(dayAfter.ok).toBe(false)
    expect(dayAfter.state).toBe('expired')
  })

  it.skipIf(!hasKey)('מעבר חי מ-ok ל-expired כשהזמן עובר תוך כדי ריצה', () => {
    secrets.set('license-key', issue(timed('2026-07-10')))
    expect(getLicenseStatus(new Date('2026-07-05T09:00:00')).ok).toBe(true)
    // הזמן «התקדם» בין שתי בדיקות פולינג — המערכת עוברת ל-expired
    expect(getLicenseStatus(new Date('2026-07-12T09:00:00')).ok).toBe(false)
  })
})

describe('דרישה 3 — הגנת שעון (anti-rollback) בשירות האמיתי', () => {
  it.skipIf(!hasKey)('החזרת שעון אחורה אחרי תפוגה אינה מחזירה גישה', () => {
    secrets.set('license-key', issue(timed('2026-07-10')))

    // המערכת «רואה» תאריך אחרי התפוגה — נרשם high-water
    expect(getLicenseStatus(new Date('2026-07-20T09:00:00')).state).toBe('expired')
    expect(secrets.has('license-seen')).toBe(true)

    // התוקף מחזיר את השעון לתוך תקופת התוקף — עדיין פג
    const rolledBack = getLicenseStatus(new Date('2026-07-05T09:00:00'))
    expect(rolledBack.ok).toBe(false)
    expect(rolledBack.state).toBe('expired')
  })

  it.skipIf(!hasKey)('ה-high-water שורד הסרה+הפעלה מחדש (אי אפשר לאפס בהסרה)', () => {
    const key = issue(timed('2026-07-10'))
    secrets.set('license-key', key)
    getLicenseStatus(new Date('2026-07-20T09:00:00')) // רושם high-water רחוק
    const seenAfterExpiry = secrets.get('license-seen')
    expect(seenAfterExpiry).toBeTruthy()

    clearLicense() // מסיר מפתח וטביעת אצבע — אך לא את ה-high-water
    expect(secrets.get('license-seen')).toBe(seenAfterExpiry)

    // הפעלה מחדש של אותו מפתח והחזרת שעון — עדיין פג
    secrets.set('license-key', key)
    expect(getLicenseStatus(new Date('2026-07-05T09:00:00')).ok).toBe(false)
  })

  it.skipIf(!hasKey)('הודעת מניפולציה מפורשת כשמזוהה החזרת שעון', () => {
    secrets.set('license-key', issue(timed('2026-07-10')))
    getLicenseStatus(new Date('2026-07-25T09:00:00')) // רושם high-water רחוק
    const rolled = getLicenseStatus(new Date('2026-07-05T09:00:00'))
    expect(rolled.state).toBe('expired')
    expect(rolled.messageHe).toContain('זוהתה החזרה של שעון המערכת')
  })

  it.skipIf(!hasKey)('ערך high-water שנערך ידנית (HMAC שגוי) נפסל', () => {
    secrets.set('license-key', issue(timed('2026-07-10')))
    getLicenseStatus(new Date('2026-07-25T09:00:00'))
    // תוקף מנסה «להוריד» את הסימן בעריכת הקובץ — החתימה כבר לא תואמת
    secrets.set('license-seen', '1000000000000|deadbeefdeadbeef')
    // הסימן הפגום מתעלם, אבל רצפת ה-iat עדיין מונעת חזרה לפני ההנפקה
    const rolled = getLicenseStatus(new Date('2026-07-05T09:00:00'))
    // התאריך עדיין בתוך התוקף (05.07 < 10.07) ולכן הרישיון תקף — אבל לא
    // ניתן היה לחזור לפני ה-iat (01.06). הבדיקה מוודאת שהערך הפגום לא «שרד».
    expect(rolled.state).not.toBe('invalid')
  })
})

describe('אימות מקוון — חלון חסד (בלי רשת, דרך התקדמות זמן)', () => {
  // מפתח ללא הגבלת זמן עם iat מוקדם, כדי שרצפת ה-iat לא תזיז את חלון הבדיקה
  const graceKey = () => issue({ id: 'grace001', n: 'לקוח', t: 'full', iat: '2026-06-01' })

  it.skipIf(!hasKey)('רישיון תקף עובד בתוך החסד, ודורש אימות אחרי שהחסד נגמר', () => {
    secrets.set('license-key', graceKey())
    // קריאה ראשונה מזריעה עוגן חסד בזמן הזה, עם validated=false — כלומר
    // עוד לא היה אימות מקוון מוצלח, ולכן החלון הוא ACTIVATION_GRACE (24ש')
    const seeded = getLicenseStatus(new Date('2026-06-15T09:00:00'))
    expect(seeded.ok).toBe(true)
    expect(secrets.has('license-online')).toBe(true)

    // עדיין בתוך 24 שעות — תקף
    expect(getLicenseStatus(new Date('2026-06-15T22:00:00')).ok).toBe(true)

    // עברו יותר מ-24 שעות בלי אימות מקוון מוצלח — נדרש אימות
    const late = getLicenseStatus(new Date('2026-06-17T09:00:00'))
    expect(late.ok).toBe(false)
    expect(late.state).toBe('needs_revalidation')
  })

  it.skipIf(!hasKey)('החזרת שעון אינה מאריכה את חלון החסד', () => {
    secrets.set('license-key', graceKey())
    getLicenseStatus(new Date('2026-06-15T09:00:00')) // עוגן חסד
    getLicenseStatus(new Date('2026-07-20T09:00:00')) // עבר החסד → high-water רחוק
    // התוקף מחזיר את השעון לתוך החסד — ה«זמן האמין» עדיין אחרי הגבול
    const rolled = getLicenseStatus(new Date('2026-07-01T09:00:00'))
    expect(rolled.state).toBe('needs_revalidation')
  })
})

describe('רצפת mtime — הגנה ששורדת מחיקת קובץ ה-high-water (בסגנון SLStore)', () => {
  it.skipIf(!hasKey)('mtime של קובץ אפליקציה עדכני חושף החזרת שעון גם בלי high-water', () => {
    secrets.set('license-key', issue(timed('2026-07-10')))
    // מדמים «עקבה» אמיתית שנשארה מריצה בזמן אמת: קובץ בתיקיית הנתונים
    // עם mtime של 24.07 (אחרי התפוגה). ה-high-water נמחק לגמרי.
    mkdirSync(dataDir, { recursive: true })
    const marker = join(dataDir, 'projects.json')
    writeFileSync(marker, '{}')
    const realTime = new Date('2026-07-24T00:00:00')
    utimesSync(marker, realTime, realTime)
    secrets.delete('license-seen') // התוקף מחק את ה-high-water

    // השעון הוחזר לתוך התוקף — אך רצפת ה-mtime חושפת שהזמן האמיתי מאוחר יותר
    const rolled = getLicenseStatus(new Date('2026-07-05T09:00:00'))
    expect(rolled.ok).toBe(false)
    expect(rolled.state).toBe('expired')
  })
})
