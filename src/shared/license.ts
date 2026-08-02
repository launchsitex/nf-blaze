/**
 * פורמט רישיון NF-Blaze — משותף לאפליקציה ול-CLI ההנפקה.
 * מפתח = NFB1.<base64url(payload)>.<base64url(ed25519 signature)>
 * החתימה נוצרת עם המפתח הפרטי (אצל המפתח בלבד) ומאומתת עם הציבורי שמוטמע כאן.
 */

export const LICENSE_PREFIX = 'NFB1'

/**
 * אין תקופת ניסיון — בלי מפתח רישיון אין גישה למערכת (מ-1.57.0).
 * הניסיון הקודם נשען על `installedAt` בקובץ הגדרות רגיל, כלומר היה
 * ניתן לאיפוס אינסופי בעריכת קובץ. «trial» נשמר בטיפוסים לתאימות לאחור.
 */
export const TRIAL_DAYS = 0

/** המפתח הציבורי לאימות — אין בו סוד, הוא רק מאמת חתימות */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA9mwjyzQHgGRJNlEaEWq07lzMMP4eNy3dcJicljOwE+8=
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
  // בוטל מרחוק דרך הפורטל (אימות מקוון)
  | 'revoked'
  // המפתח כבר פעיל במספר המחשבים המרבי, והמחשב הזה אינו אחד מהם
  | 'seat_exceeded'
  // עברו יותר מדי ימים בלי אימות מקוון מוצלח — צריך להתחבר לרשת
  | 'needs_revalidation'

export interface LicenseStatus {
  state: LicenseState
  /** האם מותר להשתמש במערכת */
  ok: boolean
  name?: string
  expiresAt?: string
  /** ימים שנותרו (רישיון או ניסיון) */
  daysLeft?: number
  /** שעות שנותרו עד התפוגה (מדויק יותר מ-daysLeft, לצורך אזהרת 12 שעות) */
  hoursLeft?: number
  /** צריך להקפיץ אזהרת «פג בקרוב» — נשארו 12 שעות או פחות */
  warnExpirySoon?: boolean
  /** מושבים בשימוש ומכסה — לתצוגה במסך החסימה בלבד */
  seatsUsed?: number
  seatsMax?: number
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

/**
 * אימות מקוון — תשובת השרת חתומה.
 * טוקן = NFBV1.<base64url(payload)>.<base64url(ed25519 signature)>
 * נחתם ב-Edge Function עם המפתח הפרטי, ומאומת באפליקציה עם הציבורי — כך
 * ששרת מזויף (הפניית דומיין / MITM) לא יכול לזייף תשובת «תקף».
 */
export const VALIDATION_PREFIX = 'NFBV1'

/**
 * חלון חסד אופליין: כמה זמן מותר לעבוד בלי אימות מקוון מוצלח.
 *
 * ⚠️ הערך הזה מוטמע בבינארי ולכן **אינו ניתן לשינוי מרחוק** — ראה `gr`
 * ב-`ValidationResponse` ואת `MAX_SERVER_GRACE_MS` למתג החירום.
 *
 * **15 דקות (מ-1.66.0). היה 48 שעות.** נתי ביקש שהמערכת תדרוש חיבור קבוע,
 * בנימוק שהיא ממילא עובדת מול מודלי AI מרוחקים. המשמעות בפועל:
 *
 * - **עלייה בלי רשת → המערכת לא נפתחת.** האימות רץ בעליית האפליקציה, ואם
 *   האחרון המוצלח היה לפני יותר מ-15 דקות המשתמש מגיע למסך «נדרש אימות מקוון».
 * - **הערך אינו 0 ואינו יכול להיות 0:** הבדיקה היא `now - anchor > grace`,
 *   והפרש של מילישניות בין שעון הלקוח לשעון השרת קיים תמיד. 15 דקות הן
 *   שלושה מחזורי אימות (`LICENSE_REVALIDATE_INTERVAL_MS`), כלומר הבהוב רשת
 *   של כמה שניות באמצע עבודה לא זורק את המשתמש החוצה.
 *
 * ⚠️ **ההשלכה שצריך להכיר:** תקלה ב-Supabase משביתה את כל הלקוחות למשך
 * התקלה. המצב מתקן את עצמו — ברגע שהשרת חוזר, «בדוק שוב» מחזיר גישה —
 * אבל זו תלות בשרת יחיד שאנחנו מחזיקים. מודלים מקומיים (Ollama / LM Studio),
 * שעובדים ללא אינטרנט, כפופים לאותה דרישה.
 */
export const ONLINE_REVALIDATE_GRACE_MS = 15 * 60_000

/**
 * חלון עד לאימות המקוון המוצלח הראשון. בלי זה אפשר היה להפעיל מפתח על
 * מחשב מנותק ולעבוד בלי שהשרת ידע על ההפעלה — כלומר גם בלי שספירת המושבים
 * תראה אותה. זהה לחלון הרגיל: ההפעלה עצמה כבר ממתינה לאימות מקוון.
 */
export const ACTIVATION_GRACE_MS = 15 * 60_000

/**
 * תדירות האימות המקוון ברקע. חייבת להיות קטנה משמעותית מחלון החסד, אחרת
 * המשתמש נחסם בין מחזור למחזור. 5 דקות = שלושה ניסיונות לפני חסימה.
 *
 * **שיקול עלות:** ‏288 קריאות ליום לכל לקוח (~8,640 בחודש). הפרויקט על מסלול
 * Supabase Pro (‏2M קריאות פונקציה כלולות) — כלומר כ-230 לקוחות פעילים בתוך
 * המכסה, ואחריה עלות שולית זניחה. הנוסחה שתישאר נכונה תמיד:
 * `מספר לקוחות × 8,640 = קריאות בחודש`.
 */
export const LICENSE_REVALIDATE_INTERVAL_MS = 5 * 60_000

/**
 * תקרה להארכת חלון החסד מרחוק (`gr` בתשובה החתומה) — מתג החירום.
 *
 * **למה זה קיים:** חלון החסד מוטמע בבינארי, ולכן תקלה בצד השרת הייתה נועלת
 * את כל הלקוחות תוך 48 שעות בלי שום דרך לשחרר אותם מלבד גרסה חדשה — בניגוד
 * למערכת העדכונים, שם עריכת `version.json` משחררת מיד. השדה `gr` מאפשר
 * להאריך את החלון בתשובה **חתומה**, והתקרה מונעת מהארכה שגויה (או משרת
 * שנפרץ) להפוך את האימות המקוון לאות מתה.
 */
export const MAX_SERVER_GRACE_MS = 30 * 86_400_000

export interface ValidationResponse {
  /** מזהה הרישיון (payload.id של המפתח) */
  id: string
  /** השרת קובע: הרישיון תקף (קיים, לא בוטל, לא פג לפי שעון השרת) */
  ok: boolean
  /** בוטל מפורשות בפורטל */
  revoked: boolean
  /** תאריך תפוגה לפי השרת (מקור אמת) */
  exp?: string
  /** זמן השרת (ms) — עוגן זמן אמין שאי אפשר לזייף בצד הלקוח */
  st: number
  /** ה-nonce שהלקוח שלח, מוחזר כדי למנוע שידור חוזר (replay) */
  nc: string
  /**
   * מצב המושב עבור המכונה ששלחה את הבקשה:
   * `ok` — נרשמה או כבר רשומה · `exceeded` — המכסה מלאה והמכונה אינה בתוכה.
   * חסר = שרת בגרסה ישנה, ואז אין אכיפת מושבים (fail-open בכוונה).
   */
  seat?: 'ok' | 'exceeded'
  /** מספר המושבים בשימוש והמכסה — לתצוגה בלבד */
  su?: number
  sm?: number
  /**
   * הארכת חלון החסד מרחוק (ms) — מתג החירום. נחתם יחד עם שאר התשובה,
   * ונחתך ב-`MAX_SERVER_GRACE_MS` בצד הלקוח.
   */
  gr?: number
  /** גרסת פורמט */
  v: 1
}

/** קלט החתימה של תשובת האימות — זהה בשרת ובלקוח */
export function validationSigningInput(payloadB64: string): Buffer {
  return Buffer.from(`${VALIDATION_PREFIX}.${payloadB64}`, 'utf-8')
}

/** פירוק טוקן אימות; null אם המבנה שגוי */
export function parseValidationToken(
  token: string
): { payloadB64: string; sigB64: string; payload: ValidationResponse } | null {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts[0] !== VALIDATION_PREFIX) return null
  try {
    const payload = JSON.parse(base64urlDecode(parts[1]!).toString('utf-8')) as ValidationResponse
    if (!payload || typeof payload.id !== 'string' || typeof payload.st !== 'number') return null
    return { payloadB64: parts[1]!, sigB64: parts[2]!, payload }
  } catch {
    return null
  }
}

export type OnlineVerdict = 'ok' | 'revoked' | 'seat_exceeded' | 'needs_revalidation'

/**
 * חלון החסד בפועל — לוגיקה טהורה, כדי שתהיה בדיקה אחת לכל המקרים.
 * לפני האימות המוצלח הראשון החלון קצר יותר; הארכה מהשרת גוברת אך נחתכת
 * בתקרה, כך שערך מנופח (תקלה או שרת שנפרץ) לא מבטל את האימות המקוון.
 */
export function effectiveGraceMs(opts: {
  validated?: boolean
  serverGraceMs?: number
  graceMs?: number
}): number {
  const base =
    opts.graceMs ?? (opts.validated === false ? ACTIVATION_GRACE_MS : ONLINE_REVALIDATE_GRACE_MS)
  const server = opts.serverGraceMs
  if (typeof server === 'number' && Number.isFinite(server) && server > base) {
    return Math.min(server, MAX_SERVER_GRACE_MS)
  }
  return base
}

/**
 * החלטת האימות המקוון — לוגיקה טהורה.
 * - `revoked` → נעילה מיידית (בוטל בפורטל).
 * - `seat_exceeded` → המכסה מלאה והמכונה הזו אינה בתוכה.
 * - עברו יותר מ-grace מאז האימות/ההפעלה האחרונים → `needs_revalidation`.
 *
 * מדידת הזמן היא מול «זמן אמין» (effectiveNowMs), כך שהחזרת שעון אינה מאריכה
 * את חלון החסד. הסדר מכוון: ביטול ומושב הם קביעות של השרת וגוברים על החסד.
 */
export function onlineGraceDecision(opts: {
  effectiveNowMs: number
  anchorMs: number
  revoked: boolean
  seatExceeded?: boolean
  validated?: boolean
  serverGraceMs?: number
  graceMs?: number
}): OnlineVerdict {
  if (opts.revoked) return 'revoked'
  if (opts.seatExceeded) return 'seat_exceeded'
  const grace = effectiveGraceMs(opts)
  if (opts.anchorMs > 0 && opts.effectiveNowMs - opts.anchorMs > grace) {
    return 'needs_revalidation'
  }
  return 'ok'
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

/** שעות שנותרו עד סוף יום התפוגה (שלילי = עבר) — לאזהרת «12 שעות אחרונות» */
export function hoursUntil(dateIso: string, now = new Date()): number {
  const end = new Date(`${dateIso}T23:59:59`)
  return (end.getTime() - now.getTime()) / 3_600_000
}

/** סף האזהרה: מקפיצים פופ-אפ כשנשארו 12 שעות או פחות לתפוגה */
export const EXPIRY_WARN_HOURS = 12

/**
 * הגנה מהחזרת שעון (anti-rollback).
 *
 * אימות התפוגה הוא אופליין ומסתמך על שעון המערכת, ולכן לקוח יכול להחזיר את
 * השעון אחורה כדי «להחיות» רישיון שפג. הפתרון: המערכת שומרת את הזמן הרחוק
 * ביותר שראתה אי-פעם («high-water mark»), ובודקת תפוגה מול המקסימום בין
 * השעון הנוכחי לבין אותו זמן — כך אי אפשר לחזור בזמן.
 */

/** קפיצה קדימה מעבר לזה נחשבת שעון תקול ואינה נרשמת — מונעת «הרעלת» הסימן */
export const MAX_FORWARD_JUMP_MS = 400 * 86_400_000

/**
 * הזמן שיירשם כ«רחוק ביותר שנראה».
 * - שעון שהוחזר אחורה (nowMs <= seenMs) לא מוריד את הסימן.
 * - קפיצה אבסורדית קדימה (שעון שהוגדר בטעות לשנה עתידית) לא נרשמת, אחרת
 *   תיקון השעון בהמשך היה גורם לרישיון להיראות «פג» לצמיתות אצל לקוח משלם.
 */
export function nextHighWater(seenMs: number, nowMs: number): number {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return seenMs
  if (nowMs <= seenMs) return seenMs
  if (seenMs > 0 && nowMs - seenMs > MAX_FORWARD_JUMP_MS) return seenMs
  return nowMs
}

/** זמן אפקטיבי לבדיקת תפוגה — לעולם לא לפני הזמן הרחוק ביותר שכבר נראה */
export function effectiveNowMs(nowMs: number, seenMs: number): number {
  return Math.max(nowMs, seenMs)
}

/** חלון חסד לפני שסטייה אחורה נחשבת מניפולציה (תיקוני NTP/אזור זמן/DST) */
export const ROLLBACK_GRACE_MS = 2 * 86_400_000

/**
 * הערכת «זמן אמין» ממספר מקורות — הגישה שבה משתמשים Office / Adobe / FlexNet
 * כדי להתגונן מהחזרת שעון אופליין: לא סומכים על שעון המערכת לבדו, אלא לוקחים
 * את המקסימום על כל המקורות המונוטוניים:
 *   - שעון המערכת (systemMs)
 *   - ה-high-water השמור (storedHighWaterMs)
 *   - תאריך ההנפקה החתום שברישיון (iatMs) — רצפה שאי אפשר לזייף
 *   - הזמן הרחוק ביותר מתוך mtime של קבצי האפליקציה (fsFloorMs)
 *
 * מקור זמן «עתידי» בצורה אבסורדית (קובץ עם תאריך שנת 2099) נחתך מול תקרה, כדי
 * שלא ינעל לקוח משלם. מוחזר גם `rolledBack` — האם שעון המערכת מאחור בצורה
 * שמעידה על מניפולציה.
 */
export function trustedEvaluationMs(opts: {
  systemMs: number
  storedHighWaterMs?: number
  iatMs?: number
  fsFloorMs?: number
  /**
   * זמן השרת מהאימות המקוון האחרון — **חתום ב-Ed25519 וקשור ל-nonce אקראי**,
   * ולכן אי אפשר לזייף אותו ואי אפשר לשדר אותו מחדש. כשהוא קיים, כל רצפה
   * שמעליו ביותר מחלון החסד המרבי היא בהכרח תוצר של שעון שגוי ונזרקת.
   *
   * **למה זה נחוץ:** בלעדיו קפיצת שעון קדימה נצרבה ב-high-water וב-mtime של
   * קבצים שנכתבו בזמן הקפיצה, ונשארה שם **לצמיתות** — תיקון השעון לא עזר,
   * ואימות מקוון לא עזר, כי הרצפה רק עולה. לקוח משלם עם סוללת BIOS מרוקנת
   * ננעל בלי דרך לשחרר אותו מרחוק.
   */
  trustedServerMs?: number
  clampWindowMs?: number
  graceMs?: number
}): { effectiveMs: number; rolledBack: boolean } {
  const pos = (n?: number): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
  const sys = pos(opts.systemMs)
  const iat = pos(opts.iatMs)
  const server = pos(opts.trustedServerMs)
  const clamp = opts.clampWindowMs ?? MAX_FORWARD_JUMP_MS
  const grace = opts.graceMs ?? ROLLBACK_GRACE_MS

  /*
   * תקרה מהשרת: מאז האימות האחרון יכול היה לחלוף לכל היותר חלון החסד המרבי
   * (אחרת המערכת כבר הייתה דורשת אימות מחדש), ולכן רצפה גבוהה מכך פסולה.
   * מוסיפים את חלון ה-rollback כמרווח לסטיות לגיטימיות קטנות.
   */
  const serverCeiling = server > 0 ? server + MAX_SERVER_GRACE_MS + grace : Infinity
  const sane = (n: number): number => (n > 0 && n <= serverCeiling ? n : 0)

  const hw = sane(pos(opts.storedHighWaterMs))
  const fsRaw = pos(opts.fsFloorMs)

  // התקרה נגזרת מהמקורות ה«בטוחים» + שעון המערכת, כדי לחתוך רק ערכים חריגים
  const ceiling = Math.max(sys, hw, iat) + clamp
  const fsClamped = sane(fsRaw > 0 && fsRaw <= ceiling ? fsRaw : 0)

  const trustedFloor = Math.max(hw, iat, fsClamped)
  const effectiveMs = Math.max(sys, trustedFloor)
  const rolledBack = trustedFloor > 0 && sys < trustedFloor - grace
  return { effectiveMs, rolledBack }
}
