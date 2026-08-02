/**
 * אימות רישיון מקומי — חתימת Ed25519, בלי שרת ובלי אינטרנט.
 * המפתח נשמר מוצפן (safeStorage) יחד עם טביעת אצבע של המחשב.
 */
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify as cryptoVerify
} from 'crypto'
import { existsSync, readdirSync, statSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { hostname, userInfo } from 'os'
import { app } from 'electron'
import {
  LICENSE_PUBLIC_KEY_PEM,
  daysUntil,
  hoursUntil,
  EXPIRY_WARN_HOURS,
  parseLicenseKey,
  parseValidationToken,
  validationSigningInput,
  onlineGraceDecision,
  signingInput,
  base64urlDecode,
  trustedEvaluationMs,
  nextHighWater,
  type LicensePayload,
  type LicenseStatus
} from '../../shared/license'
import { getSecret, setSecret, clearSecret } from './secrets'

const LICENSE_SLOT = 'license-key'
const FINGERPRINT_SLOT = 'license-fingerprint'

/**
 * חיבור לאימות המקוון (פרויקט הרישוי הייעודי ב-Supabase).
 * שני הערכים אינם סוד — מפתח publishable מיועד ללקוח, וה-RLS נועל את הנתונים.
 * המפתח הפרטי לחתימה לעולם אינו כאן; הוא נשאר ב-Secrets של Supabase.
 */
export const LICENSE_FUNCTIONS_BASE = 'https://ilsidpixxkfwowsnkntg.supabase.co/functions/v1'
export const LICENSE_ANON_KEY = 'sb_publishable_6TuWWlf5vZBoNqaW5naH3w_FHUj8HSr'
const ONLINE_VALIDATE_URL = `${LICENSE_FUNCTIONS_BASE}/validate-license`
const ONLINE_ANON_KEY = LICENSE_ANON_KEY
const ONLINE_TIMEOUT_MS = 8000

/** מצב האימות המקוון — קשור למזהה הרישיון וחתום ב-HMAC */
const ONLINE_SLOT = 'license-online'
const ONLINE_HMAC_SALT = 'nfb-license-online-v1'

interface OnlineState {
  /** מזהה הרישיון שאליו שייך המצב — מונע «איפוס» ביטול ע"י הפעלה מחדש */
  id: string
  /** זמן האימות/ההפעלה האחרון (ms) — ממנו נמדד חלון החסד */
  anchorMs: number
  /** בוטל מרחוק */
  revoked: boolean
  /** בוצע אימות מקוון מוצלח אי-פעם */
  validated: boolean
  /** המפתח פעיל כבר במספר המחשבים המרבי, והמחשב הזה אינו אחד מהם */
  seatExceeded?: boolean
  /** מושבים בשימוש ומכסה, כפי שדווחו באימות האחרון — לתצוגה בלבד */
  seatsUsed?: number
  seatsMax?: number
  /** הארכת חלון חסד שהשרת חתם עליה (מתג חירום), נחתכת בתקרה */
  serverGraceMs?: number
  /** זמן השרת מהאימות המוצלח האחרון (חתום) — תקרה לרצפות הזמן */
  serverMs?: number
}
/**
 * הזמן הרחוק ביותר שהמערכת ראתה אי-פעם (ms), מוצפן כמו המפתח עצמו וחתום
 * ב-HMAC. הבסיס להגנה מהחזרת שעון — ראה trustedEvaluationMs ב-shared.
 */
const SEEN_SLOT = 'license-seen'
/** «מלח» ל-HMAC של ה-high-water — מקשה על עריכה ידנית של הערך */
const SEEN_HMAC_SALT = 'nfb-license-seen-v1'

/** חתימת שלמות על ערך ה-high-water, קשורה למכונה */
function seenMac(ms: number): string {
  return createHmac('sha256', machineFingerprint() + SEEN_HMAC_SALT)
    .update(String(ms))
    .digest('hex')
    .slice(0, 16)
}

/** קריאת ה-high-water mark; 0 אם עוד לא נרשם, פגום, או חתימתו שגויה */
function readSeenMs(): number {
  const raw = getSecret(SEEN_SLOT)
  if (!raw) return 0
  // פורמט חדש: "<ms>|<hmac>" — ערך שנערך ידנית ייפסל
  if (raw.includes('|')) {
    const [msStr, mac] = raw.split('|')
    const ms = Number(msStr)
    if (!Number.isFinite(ms) || ms <= 0) return 0
    return seenMac(ms) === mac ? ms : 0
  }
  // תאימות לאחור: ערך רגיל שנכתב לפני הוספת ה-HMAC
  const legacy = Number(raw)
  return Number.isFinite(legacy) && legacy > 0 ? legacy : 0
}

/** תיקיית הנתונים של האפליקציה — שם נמצאים הסודות וקובץ העוגן */
function dataDir(): string {
  return join(app.getPath('userData'), 'nf-blaze-data')
}

/** קובץ עוגן שה-mtime שלו משמש עותק שני, מונוטוני, של ה-high-water */
function anchorPath(): string {
  return join(dataDir(), '.license-anchor')
}

/**
 * רצפת זמן ממערכת הקבצים: ה-mtime הרחוק ביותר בין קבצי האפליקציה. עותק
 * מבוזר של הזמן שנראה — שורד מחיקה של קובץ ה-high-water היחיד (בדומה ל-SLStore
 * של Adobe). ערך עתידי אבסורדי נחתך בהמשך ב-trustedEvaluationMs.
 */
function fsTimeFloorMs(): number {
  let max = 0
  for (const d of [dataDir(), join(dataDir(), 'secrets')]) {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      continue
    }
    for (const f of entries) {
      try {
        const m = statSync(join(d, f)).mtimeMs
        if (m > max) max = m
      } catch {
        /* קובץ נעלם בין קריאה לבדיקה — מתעלמים */
      }
    }
  }
  return max
}

/** מעלה את ה-mtime של קובץ העוגן לזמן האמין — לעולם לא מוריד אותו */
function raiseAnchor(effMs: number): void {
  try {
    const p = anchorPath()
    let cur = 0
    if (existsSync(p)) {
      try {
        cur = statSync(p).mtimeMs
      } catch {
        /* ignore */
      }
    } else {
      try {
        writeFileSync(p, 'nfb')
        cur = statSync(p).mtimeMs
      } catch {
        return
      }
    }
    if (effMs > cur) {
      const s = new Date(effMs)
      utimesSync(p, s, s)
    }
  } catch {
    /* עוגן הוא הגנה נוספת בלבד — כשלו לא מפיל את בדיקת הרישיון */
  }
}

/**
 * קובע את ה-mtime של העוגן לזמן מדויק — כולל **הורדה**. מיועד אך ורק למסלול
 * שבו הזמן הגיע מתשובת שרת חתומה, שהיא המקור היחיד שמותר להוריד רצפה לפיו.
 */
function setAnchorExact(ms: number): void {
  try {
    const p = anchorPath()
    if (!existsSync(p)) writeFileSync(p, 'nfb')
    const s = new Date(ms)
    utimesSync(p, s, s)
  } catch {
    /* עוגן הוא הגנה נוספת בלבד — כשלו לא מפיל את בדיקת הרישיון */
  }
}

/** תאריך ההנפקה החתום כרצפת זמן (ms) — אי אפשר לזייף בלי המפתח הפרטי */
function iatFloorMs(payload?: LicensePayload): number {
  if (!payload?.iat) return 0
  const t = Date.parse(`${payload.iat}T00:00:00Z`)
  return Number.isFinite(t) ? t : 0
}

/**
 * כותבים לדיסק רק כשהסימן מתקדם בשעה לפחות. הבדיקה החיה רצה כל 30 שנ',
 * ובלי הסף היינו כותבים קובץ מוצפן פעמיים בדקה ללא צורך. דיוק של שעה מספיק
 * בהרבה — התקפות החזרת שעון מדברות על ימים/חודשים, לא דקות.
 */
const SEEN_WRITE_THRESHOLD_MS = 3_600_000

/** קידום מונוטוני של הסימן — לעולם לא אחורה, ולא בקפיצה תקולה קדימה */
function recordSeen(nowMs: number): number {
  const seen = readSeenMs()
  const next = nextHighWater(seen, nowMs)
  if (next > seen && (seen === 0 || next - seen >= SEEN_WRITE_THRESHOLD_MS)) {
    try {
      setSecret(SEEN_SLOT, `${next}|${seenMac(next)}`)
    } catch {
      /* אם האחסון המוצפן לא זמין — לא מפילים את בדיקת הרישיון */
    }
    return next
  }
  return seen
}

/**
 * מיישר את הסימן לזמן שרת חתום — **כולל הורדה**, בניגוד ל-recordSeen.
 *
 * זה המסלול היחיד שמוריד רצפת זמן, והוא בטוח כי `st` מגיע בתשובה חתומה
 * ‏Ed25519 שקשורה ל-nonce אקראי: אי אפשר לזייף אותה, ואי אפשר לשדר מחדש
 * תשובה ישנה. בלי זה קפיצת שעון קדימה נצרבה לצמיתות ונעלה לקוח משלם.
 */
function alignSeenToServer(serverMs: number): void {
  const seen = readSeenMs()
  if (seen === serverMs) return
  try {
    setSecret(SEEN_SLOT, `${serverMs}|${seenMac(serverMs)}`)
  } catch {
    /* אם האחסון המוצפן לא זמין — לא מפילים את בדיקת הרישיון */
  }
}

/** חתימת שלמות על מצב האימות המקוון, קשורה למכונה */
function onlineMac(json: string): string {
  return createHmac('sha256', machineFingerprint() + ONLINE_HMAC_SALT)
    .update(json)
    .digest('hex')
    .slice(0, 16)
}

/** קריאת מצב האימות המקוון; null אם חסר, פגום, או חתימתו שגויה */
function readOnlineState(): OnlineState | null {
  const raw = getSecret(ONLINE_SLOT)
  if (!raw) return null
  const i = raw.lastIndexOf('|')
  if (i < 0) return null
  const json = raw.slice(0, i)
  if (onlineMac(json) !== raw.slice(i + 1)) return null
  try {
    const o = JSON.parse(json) as Partial<OnlineState>
    if (typeof o.id !== 'string' || typeof o.anchorMs !== 'number') return null
    return {
      id: o.id,
      anchorMs: o.anchorMs,
      revoked: Boolean(o.revoked),
      validated: Boolean(o.validated),
      seatExceeded: Boolean(o.seatExceeded),
      seatsUsed: typeof o.seatsUsed === 'number' ? o.seatsUsed : undefined,
      seatsMax: typeof o.seatsMax === 'number' ? o.seatsMax : undefined,
      serverGraceMs: typeof o.serverGraceMs === 'number' ? o.serverGraceMs : undefined,
      serverMs: typeof o.serverMs === 'number' ? o.serverMs : undefined
    }
  } catch {
    return null
  }
}

function writeOnlineState(s: OnlineState): void {
  const json = JSON.stringify(s)
  try {
    setSecret(ONLINE_SLOT, `${json}|${onlineMac(json)}`)
  } catch {
    /* אחסון לא זמין — לא מפילים את בדיקת הרישיון */
  }
}

/**
 * אימות מקוון מול Supabase. פונה עם המפתח + nonce, מאמת את חתימת התשובה מול
 * המפתח הציבורי המוטמע, ומעדכן: עוגן זמן אמין (server time), מצב ביטול, וחלון
 * חסד. כשלון רשת/timeout אינו נועל — נשארים על חלון החסד. אינו זורק לעולם.
 */
export async function revalidateOnline(now = new Date()): Promise<LicenseStatus> {
  const key = getSecret(LICENSE_SLOT)
  if (!key) return getLicenseStatus(now)
  const res = verifyLicenseKey(key, now)
  if (!res.valid || !res.payload) return getLicenseStatus(now)

  const nonce = randomBytes(16).toString('hex')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ONLINE_TIMEOUT_MS)
  try {
    const resp = await fetch(ONLINE_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ONLINE_ANON_KEY },
      // טביעת האצבע נשלחת כדי שספירת המושבים תיעשה בשרת. עד כה הבידינג
      // למכונה היה מקומי בלבד ומוצהר ע"י הלקוח — כלומר מפתח אחד עבד על כל
      // מספר של מחשבים והשרת לא ידע. ה-hostname נשלח כרמז לזיהוי בפורטל.
      body: JSON.stringify({
        key: key.trim(),
        nonce,
        fp: machineFingerprint(),
        host: safeHostHint()
      }),
      signal: controller.signal
    })
    if (!resp.ok) return getLicenseStatus(now)
    const body = (await resp.json()) as { token?: string }
    if (!body.token) return getLicenseStatus(now)

    const parsed = parseValidationToken(body.token)
    if (!parsed) return getLicenseStatus(now)
    // אימות חתימת השרת — שרת מזויף לא יכול לזייף תשובה
    const pub = createPublicKey(LICENSE_PUBLIC_KEY_PEM)
    const sigOk = cryptoVerify(
      null,
      validationSigningInput(parsed.payloadB64),
      pub,
      base64urlDecode(parsed.sigB64)
    )
    if (!sigOk) return getLicenseStatus(now)

    const p = parsed.payload
    // בדיקות ריפליי/קישור: nonce תואם, אותו רישיון, זמן שרת תקין
    if (p.nc !== nonce || p.id !== res.payload.id || !(p.st > 0)) return getLicenseStatus(now)

    /*
     * זמן השרת הוא הקובע — **מיישרים אליו ולא רק מעלים**. שעון שקפץ קדימה
     * (סוללת BIOS, תאריך שהוגדר לא נכון) נצרב עד כה ב-high-water וב-mtime של
     * קבצים שנכתבו באותו זמן, ונשאר שם לצמיתות: תיקון השעון לא עזר ואימות
     * מקוון לא עזר, כי הרצפה רק עלתה. עכשיו האימות הראשון אחרי החזרת הרשת
     * מנקה את זה לבד, בלי להדריך לקוח למחוק קבצים.
     */
    alignSeenToServer(p.st)
    setAnchorExact(p.st)
    // ההארכה נשמרת גם כשהתשובה שלילית — היא מתג חירום ולא פרס על תקינות
    const serverGraceMs = typeof p.gr === 'number' && p.gr > 0 ? p.gr : undefined
    const seatFields = {
      seatExceeded: p.seat === 'exceeded',
      seatsUsed: typeof p.su === 'number' ? p.su : undefined,
      seatsMax: typeof p.sm === 'number' ? p.sm : undefined,
      serverGraceMs,
      // נשמר כתקרה לרצפות הזמן — ראה trustedServerMs ב-trustedEvaluationMs
      serverMs: p.st
    }
    if (p.revoked) {
      writeOnlineState({ id: p.id, anchorMs: p.st, revoked: true, validated: true, ...seatFields })
    } else if (p.ok) {
      /*
       * חריגת מושבים אינה מרעננת את העוגן: אחרת מחשב שנדחה היה מאריך לעצמו
       * את חלון החסד בכל פנייה וממשיך לעבוד ללא הגבלה. הוא נשאר על העוגן
       * הישן, וכשזה יפוג הוא ייחסם — בדיוק כמו מחשב מנותק.
       */
      const anchorMs = seatFields.seatExceeded ? (readOnlineState()?.anchorMs ?? p.st) : p.st
      writeOnlineState({ id: p.id, anchorMs, revoked: false, validated: true, ...seatFields })
    }
    // p.ok=false ולא revoked (לא נמצא / פג לפי השרת): לא מרעננים עוגן, לא נועלים
    // כאן — התפוגה כבר נאכפת מקומית, וחוסר-מציאה עלול להיות תקלת מנהל.
  } catch {
    /* אופליין / timeout — נשארים על חלון החסד */
  } finally {
    clearTimeout(timer)
  }
  return getLicenseStatus(now)
}

/**
 * שם המחשב כרמז לזיהוי בפורטל בלבד — כדי שאפשר יהיה לשחרר מושב של מחשב
 * ישן בלי לנחש איזו טביעת אצבע שייכת למי. מקוצר, ולא נדרש לשום החלטה.
 */
function safeHostHint(): string {
  try {
    return hostname().slice(0, 64)
  } catch {
    return ''
  }
}

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

    // הגנה מהחזרת שעון בגישת מקורות-מרובים (כמו Office/Adobe): התפוגה נבדקת
    // מול «זמן אמין» = max(שעון, high-water, iat חתום, mtime של קבצי האפליקציה),
    // ולא מול השעון הנוכחי לבדו. הקידום נעשה רק אחרי שאומת שהמפתח חתום.
    // נקרא לפני הערכת הזמן — זמן השרת החתום משמש תקרה לרצפות, כדי שקפיצת
    // שעון קדימה שנצרבה ב-high-water או ב-mtime לא תשרוד לנצח.
    let online = readOnlineState()

    const { effectiveMs, rolledBack } = trustedEvaluationMs({
      systemMs: now.getTime(),
      storedHighWaterMs: readSeenMs(),
      iatMs: iatFloorMs(res.payload),
      fsFloorMs: fsTimeFloorMs(),
      trustedServerMs: online?.serverMs
    })
    const evalNow = new Date(effectiveMs)
    recordSeen(effectiveMs)
    raiseAnchor(effectiveMs)

    // תאריך התפוגה הוא היום האחרון בתוקף. daysUntil מחזיר 1 לאורך כל אותו
    // יום, 0 למחרת (פג), ושלילי אחר כך — לכן התנאי הוא left <= 0, אחרת
    // הלקוח היה מקבל יום שימוש נוסף מעבר למה ששילם עליו.
    const exp = res.payload?.exp
    const left = exp ? daysUntil(exp, evalNow) : undefined
    if (exp && left !== undefined && left <= 0) {
      return {
        state: 'expired',
        ok: false,
        name: res.payload?.n,
        expiresAt: exp,
        // הודעת מניפולציה מפורשת כשזוהתה החזרת שעון (בסגנון Adobe)
        messageHe: rolledBack
          ? `זוהתה החזרה של שעון המערכת. הרישיון פג (${exp}) — פנו לחידוש.`
          : `הרישיון פג ב-${exp}. פנו לחידוש.`
      }
    }

    // אימות מקוון: ביטול מרחוק + חלון חסד. המצב קשור למזהה הרישיון; אם הוא
    // חסר או שייך למפתח אחר, מזריעים עוגן טרי כדי שהחסד יתחיל למנות.
    const currentId = res.payload?.id
    if (currentId && (!online || online.id !== currentId)) {
      online = { id: currentId, anchorMs: effectiveMs, revoked: false, validated: false }
      writeOnlineState(online)
    }
    if (online) {
      const verdict = onlineGraceDecision({
        effectiveNowMs: effectiveMs,
        anchorMs: online.anchorMs,
        revoked: online.revoked,
        seatExceeded: online.seatExceeded,
        validated: online.validated,
        serverGraceMs: online.serverGraceMs
      })
      if (verdict === 'revoked') {
        return {
          state: 'revoked',
          ok: false,
          name: res.payload?.n,
          expiresAt: exp,
          messageHe: 'הרישיון בוטל. פנו אלינו לקבלת מפתח חדש.'
        }
      }
      if (verdict === 'seat_exceeded') {
        return {
          state: 'seat_exceeded',
          ok: false,
          name: res.payload?.n,
          expiresAt: exp,
          seatsUsed: online.seatsUsed,
          seatsMax: online.seatsMax,
          messageHe: online.seatsMax
            ? `המפתח כבר פעיל ב-${online.seatsMax} מחשבים. פנו אלינו כדי לשחרר מחשב או להרחיב את הרישיון.`
            : 'המפתח כבר פעיל במספר המחשבים המרבי. פנו אלינו כדי לשחרר מחשב או להרחיב את הרישיון.'
        }
      }
      if (verdict === 'needs_revalidation') {
        return {
          state: 'needs_revalidation',
          ok: false,
          name: res.payload?.n,
          expiresAt: exp,
          messageHe: online.validated
            ? 'נדרש חיבור לאינטרנט לאימות הרישיון. התחברו ולחצו «בדוק שוב».'
            : 'נדרש חיבור לאינטרנט כדי להשלים את הפעלת הרישיון. התחברו ולחצו «בדוק שוב».'
        }
      }
    }

    // אזהרת «12 שעות אחרונות» — מדויקת יותר מ-daysLeft, מול הזמן האמין
    const hoursLeft = exp ? hoursUntil(exp, evalNow) : undefined
    const warnExpirySoon =
      hoursLeft !== undefined && hoursLeft > 0 && hoursLeft <= EXPIRY_WARN_HOURS

    return {
      state: 'licensed',
      ok: true,
      name: res.payload?.n,
      expiresAt: exp,
      daysLeft: left,
      hoursLeft,
      warnExpirySoon,
      messageHe: exp
        ? `רישיון פעיל · ${res.payload!.n} · בתוקף עוד ${left} ימים`
        : `רישיון פעיל · ${res.payload?.n}`
    }
  }

  // אין תקופת ניסיון: בלי מפתח אין גישה. תקופת ניסיון שנשענה על
  // `installedAt` בקובץ הגדרות רגיל הייתה ניתנת לאיפוס אינסופי בעריכת הקובץ.
  return {
    state: 'none',
    ok: false,
    messageHe: 'נדרש מפתח רישיון כדי להשתמש ב-NF-Blaze.'
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
  // מזריעים את ה-high-water ואת העוגן בזמן ההפעלה (השעון בדרך כלל תקין אז),
  // כדי שהחזרת שעון מיד אחרי ההפעלה לא תעקוף את בדיקת התפוגה.
  recordSeen(Date.now())
  raiseAnchor(Date.now())
  return getLicenseStatus()
}

/**
 * המפתח השמור, לשימוש **בתהליך הראשי בלבד** — הוא מזהה את בעל הרישיון מול
 * פרויקט הרישוי (משוב/דיווח), בדיוק כמו באימות המקוון. לעולם לא חוצה IPC:
 * שיוך המשוב נעשה בשרת מתוך החתימה, ולכן אין דרך להתחזות לבעל רישיון אחר.
 */
export function getStoredLicenseKey(): string | null {
  return getSecret(LICENSE_SLOT)
}

export function clearLicense(): LicenseStatus {
  clearSecret(LICENSE_SLOT)
  clearSecret(FINGERPRINT_SLOT)
  return getLicenseStatus()
}
