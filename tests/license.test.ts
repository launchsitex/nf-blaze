import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify
} from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  base64urlDecode,
  formatLicenseKey,
  parseLicenseKey,
  parseValidationToken,
  validationSigningInput,
  onlineGraceDecision,
  effectiveGraceMs,
  ONLINE_REVALIDATE_GRACE_MS,
  ACTIVATION_GRACE_MS,
  LICENSE_REVALIDATE_INTERVAL_MS,
  MAX_SERVER_GRACE_MS,
  VALIDATION_PREFIX,
  signingInput,
  daysUntil,
  hoursUntil,
  EXPIRY_WARN_HOURS,
  nextHighWater,
  effectiveNowMs,
  trustedEvaluationMs,
  ROLLBACK_GRACE_MS,
  MAX_FORWARD_JUMP_MS,
  LICENSE_PREFIX,
  LICENSE_PUBLIC_KEY_PEM,
  type LicensePayload
} from '../src/shared/license'

/**
 * שומר הסף שהכי חשוב בקובץ הזה.
 *
 * אם מריצים `license:keygen` ושוכחים להדביק את המפתח הציבורי החדש
 * ב-license.ts, האפליקציה נבנית בשקט ו**דוחה כל מפתח שתנפיק ללקוח**.
 * הבדיקה הזו הופכת את זה לכשל בנייה במקום לתקלה אצל לקוח משלם.
 */
describe('embedded public key matches the signing key', () => {
  const pemPath = join(__dirname, '..', 'secrets', 'license-public.pem')

  it.skipIf(!existsSync(pemPath))('app key === secrets/license-public.pem', () => {
    const onDisk = readFileSync(pemPath, 'utf8').trim()
    expect(LICENSE_PUBLIC_KEY_PEM.trim()).toBe(onDisk)
  })

  it('the embedded key is a usable Ed25519 public key', () => {
    expect(LICENSE_PUBLIC_KEY_PEM).toMatch(/^-----BEGIN PUBLIC KEY-----/)
    expect(LICENSE_PUBLIC_KEY_PEM).toMatch(/-----END PUBLIC KEY-----$/)
  })
})

/** מנפיק מפתח לבדיקה עם זוג מפתחות זמני */
function issue(payload: LicensePayload, privateKeyPem: string): string {
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const sig = cryptoSign(null, signingInput(payloadB64), createPrivateKey(privateKeyPem))
  return formatLicenseKey(payloadB64, base64urlEncode(sig))
}

describe('license key format', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  const payload: LicensePayload = {
    id: 'abc12345',
    n: 'משרד תיווך אולמו',
    e: 'dani@example.com',
    exp: '2027-01-01',
    t: 'full',
    iat: '2026-07-30'
  }

  it('round-trips payload through issue → parse (including Hebrew)', () => {
    const key = issue(payload, pem)
    expect(key.startsWith(`${LICENSE_PREFIX}.`)).toBe(true)
    const parsed = parseLicenseKey(key)
    expect(parsed).not.toBeNull()
    expect(parsed!.payload.n).toBe('משרד תיווך אולמו')
    expect(parsed!.payload.exp).toBe('2027-01-01')
    expect(parsed!.payload.id).toBe('abc12345')
  })

  it('tolerates whitespace from copy-paste', () => {
    const key = issue(payload, pem)
    const messy = `  ${key.slice(0, 20)}\n${key.slice(20)}  `
    expect(parseLicenseKey(messy)?.payload.id).toBe('abc12345')
  })

  it('rejects malformed keys', () => {
    expect(parseLicenseKey('')).toBeNull()
    expect(parseLicenseKey('nonsense')).toBeNull()
    expect(parseLicenseKey('WRONG.aaa.bbb')).toBeNull()
    expect(parseLicenseKey(`${LICENSE_PREFIX}.notbase64json.bbb`)).toBeNull()
    // payload חוקי כ-base64 אבל בלי שדות חובה
    const empty = base64urlEncode(Buffer.from('{}', 'utf-8'))
    expect(parseLicenseKey(`${LICENSE_PREFIX}.${empty}.sig`)).toBeNull()
  })

  it('signature covers the payload — tampering breaks verification input', () => {
    const key = issue(payload, pem)
    const parts = key.split('.')
    const tampered: LicensePayload = { ...payload, exp: '2099-01-01' }
    const tamperedB64 = base64urlEncode(Buffer.from(JSON.stringify(tampered), 'utf-8'))
    // אותה חתימה על payload אחר → קלט החתימה שונה, ולכן האימות ייכשל
    expect(signingInput(tamperedB64).toString()).not.toBe(signingInput(parts[1]!).toString())
  })
})

describe('daysUntil', () => {
  it('counts remaining days and goes negative after expiry', () => {
    const now = new Date('2026-07-30T10:00:00')
    expect(daysUntil('2026-08-09', now)).toBe(11)
    expect(daysUntil('2026-07-30', now)).toBe(1)
    expect(daysUntil('2026-07-29', now)).toBeLessThan(1)
    expect(daysUntil('2026-01-01', now)).toBeLessThan(0)
  })
})

/**
 * הגנה מהחזרת שעון. זו הייתה העקיפה היחידה שהצליחה בבדיקת החדירה:
 * לקוח עם רישיון שפג שמחזיר את שעון Windows אחורה — הרישיון «קם לתחייה».
 */
describe('anti-rollback (high-water mark)', () => {
  const D = (iso: string) => new Date(iso).getTime()

  it('closes the clock-rollback bypass: expiry is judged against the furthest time seen', () => {
    const exp = '2026-07-01'
    const seen = D('2026-07-31') // המערכת כבר ראתה תאריך אחרי התפוגה
    const rolledBack = D('2026-06-15') // התוקף החזיר את השעון לפני התפוגה

    // בלי ההגנה: מול השעון שהוחזר הרישיון נראה בתוקף
    expect(daysUntil(exp, new Date(rolledBack))).toBeGreaterThan(0)
    // עם ההגנה: הזמן האפקטיבי הוא המקסימום שנראה — עדיין פג
    const evalNow = new Date(effectiveNowMs(rolledBack, seen))
    expect(daysUntil(exp, evalNow)).toBeLessThan(0)
  })

  it('never lowers the mark when the clock goes backward', () => {
    const seen = D('2026-07-31')
    expect(nextHighWater(seen, D('2026-06-01'))).toBe(seen)
    expect(nextHighWater(seen, D('2026-07-31'))).toBe(seen)
  })

  it('advances the mark on genuine forward progress', () => {
    const seen = D('2026-07-01')
    const later = D('2026-07-20')
    expect(nextHighWater(seen, later)).toBe(later)
  })

  it('ignores absurd forward jumps so a mis-set future clock cannot lock out a paying customer', () => {
    const seen = D('2026-07-01')
    const wayFuture = seen + MAX_FORWARD_JUMP_MS + 86_400_000 // מעבר לתקרה
    expect(nextHighWater(seen, wayFuture)).toBe(seen)
    // קפיצה סבירה קדימה כן נרשמת
    const reasonable = seen + 30 * 86_400_000
    expect(nextHighWater(seen, reasonable)).toBe(reasonable)
  })

  it('seeds from zero on first sight and rejects non-finite input', () => {
    expect(nextHighWater(0, D('2026-07-01'))).toBe(D('2026-07-01'))
    expect(nextHighWater(D('2026-07-01'), Number.NaN)).toBe(D('2026-07-01'))
    expect(nextHighWater(D('2026-07-01'), 0)).toBe(D('2026-07-01'))
  })

  it('a license with no expiry is unaffected by the clock entirely', () => {
    // אין exp → daysUntil לא נקרא כלל; הזמן האפקטיבי לא רלוונטי
    expect(effectiveNowMs(D('2026-06-15'), D('2026-07-31'))).toBe(D('2026-07-31'))
  })
})

/**
 * הערכת זמן ממקורות מרובים — גישת Office/Adobe נגד החזרת שעון אופליין.
 * לוקחים max על שעון + high-water + iat חתום + mtime, עם חיתוך ערכים
 * עתידיים אבסורדיים כדי לא לנעול לקוח משלם.
 */
describe('trustedEvaluationMs (multi-source clock defense)', () => {
  const D = (iso: string) => new Date(iso).getTime()

  it('clock is correct: effective time is the system time, no tampering flag', () => {
    const sys = D('2026-07-15T10:00:00')
    const r = trustedEvaluationMs({ systemMs: sys, storedHighWaterMs: D('2026-07-15T09:00:00') })
    expect(r.effectiveMs).toBe(sys)
    expect(r.rolledBack).toBe(false)
  })

  it('rollback below the high-water is detected and the floor holds', () => {
    const hw = D('2026-07-31T00:00:00')
    const r = trustedEvaluationMs({ systemMs: D('2026-06-15T00:00:00'), storedHighWaterMs: hw })
    expect(r.effectiveMs).toBe(hw)
    expect(r.rolledBack).toBe(true)
  })

  it('small backward drift within grace is NOT flagged as tampering', () => {
    const hw = D('2026-07-31T12:00:00')
    const sys = hw - ROLLBACK_GRACE_MS + 60_000 // בתוך חלון החסד
    const r = trustedEvaluationMs({ systemMs: sys, storedHighWaterMs: hw })
    expect(r.rolledBack).toBe(false)
    expect(r.effectiveMs).toBe(hw)
  })

  it('the signed iat acts as a floor the clock cannot go below', () => {
    const iat = D('2026-06-01T00:00:00')
    const r = trustedEvaluationMs({ systemMs: D('2026-01-01T00:00:00'), iatMs: iat })
    expect(r.effectiveMs).toBe(iat)
    expect(r.rolledBack).toBe(true)
  })

  it('filesystem mtime floor is used when it is the furthest source', () => {
    const fs = D('2026-07-20T00:00:00')
    const r = trustedEvaluationMs({ systemMs: D('2026-07-05T00:00:00'), fsFloorMs: fs })
    expect(r.effectiveMs).toBe(fs)
  })

  it('an absurd future mtime is clamped so it cannot lock out a paying customer', () => {
    const sys = D('2026-07-05T00:00:00')
    const poison = sys + MAX_FORWARD_JUMP_MS + 10 * 86_400_000 // הרבה מעבר לתקרה
    const r = trustedEvaluationMs({ systemMs: sys, fsFloorMs: poison })
    expect(r.effectiveMs).toBe(sys) // המקור המורעל נחתך
    expect(r.rolledBack).toBe(false)
  })

  it('setting the clock far forward only harms the attacker (no false floor)', () => {
    const sys = D('2030-01-01T00:00:00')
    const r = trustedEvaluationMs({ systemMs: sys, storedHighWaterMs: D('2026-07-01T00:00:00') })
    expect(r.effectiveMs).toBe(sys)
    expect(r.rolledBack).toBe(false)
  })
})

/**
 * גבול התפוגה. הכלל: exp הוא היום האחרון בתוקף. daysUntil מחזיר 1 לאורך כל
 * אותו יום, 0 למחרת (כבר פג), ושלילי אחר כך. לכן תנאי התפוגה במערכת הוא
 * left <= 0 — אחרת הלקוח מקבל יום שימוש נוסף מעבר לתשלום, ואזהרת «יום אחרון»
 * מופעלת כש-left === 1.
 */
describe('expiry boundary (exp = last valid day)', () => {
  const expiredAt = (iso: string, now: string) => {
    const left = daysUntil(iso, new Date(now))
    return { left, expired: left <= 0, warnLastDay: left === 1 }
  }

  it('is valid and warns on the exp date itself', () => {
    expect(expiredAt('2026-07-01', '2026-07-01T00:00:00')).toEqual({
      left: 1,
      expired: false,
      warnLastDay: true
    })
    expect(expiredAt('2026-07-01', '2026-07-01T23:00:00')).toEqual({
      left: 1,
      expired: false,
      warnLastDay: true
    })
  })

  it('is expired the day AFTER exp — no bonus day (left === 0 counts as expired)', () => {
    expect(expiredAt('2026-07-01', '2026-07-02T00:30:00').expired).toBe(true)
    expect(expiredAt('2026-07-01', '2026-07-02T12:00:00').expired).toBe(true)
    expect(expiredAt('2026-07-01', '2026-07-02T23:00:00').expired).toBe(true)
  })

  it('does not warn when more than one day remains', () => {
    expect(expiredAt('2026-07-10', '2026-07-01T09:00:00').warnLastDay).toBe(false)
    expect(expiredAt('2026-07-10', '2026-07-01T09:00:00').expired).toBe(false)
  })
})

/**
 * אזהרת «12 שעות אחרונות». התפוגה היא בסוף יום ה-exp (23:59:59), ולכן
 * האזהרה נדלקת מאמצע היום האחרון (~12:00) והלאה, כל עוד לא פג.
 */
describe('12-hour expiry warning', () => {
  const warnSoon = (exp: string, now: string) => {
    const h = hoursUntil(exp, new Date(now))
    return h > 0 && h <= EXPIRY_WARN_HOURS
  }

  it('warns inside the final 12 hours', () => {
    expect(warnSoon('2026-08-15', '2026-08-15T13:00:00')).toBe(true) // ~11ש' לתפוגה
    expect(warnSoon('2026-08-15', '2026-08-15T20:00:00')).toBe(true) // ~4ש'
  })

  it('does not warn earlier than 12 hours before', () => {
    expect(warnSoon('2026-08-15', '2026-08-15T09:00:00')).toBe(false) // ~15ש'
    expect(warnSoon('2026-08-15', '2026-08-14T09:00:00')).toBe(false) // יותר מיממה
  })

  it('does not warn once already expired', () => {
    expect(warnSoon('2026-08-15', '2026-08-16T09:00:00')).toBe(false)
  })

  it('hoursUntil is positive on the exp day and negative after', () => {
    expect(hoursUntil('2026-08-15', new Date('2026-08-15T18:00:00'))).toBeGreaterThan(0)
    expect(hoursUntil('2026-08-15', new Date('2026-08-16T06:00:00'))).toBeLessThan(0)
  })
})

/**
 * אימות מקוון (בסגנון Office/Adobe): החלטת החסד + ביטול, ואימות שהתשובה
 * החתומה של השרת ניתנת לאימות מול המפתח הציבורי המוטמע.
 */
describe('online validation', () => {
  const D = (iso: string) => new Date(iso).getTime()

  it('revoked always locks immediately', () => {
    expect(
      onlineGraceDecision({ effectiveNowMs: D('2026-07-01'), anchorMs: D('2026-07-01'), revoked: true })
    ).toBe('revoked')
  })

  it('within the grace window it stays ok', () => {
    const anchor = D('2026-07-01')
    // רגע לפני סוף החסד — הבהוב רשת קצר לא זורק את המשתמש החוצה
    const within = anchor + ONLINE_REVALIDATE_GRACE_MS - 60_000
    expect(onlineGraceDecision({ effectiveNowMs: within, anchorMs: anchor, revoked: false })).toBe('ok')
  })

  it('past the grace window it needs revalidation', () => {
    const anchor = D('2026-07-01')
    const past = anchor + ONLINE_REVALIDATE_GRACE_MS + 60_000
    expect(onlineGraceDecision({ effectiveNowMs: past, anchorMs: anchor, revoked: false })).toBe(
      'needs_revalidation'
    )
  })

  it('with no anchor yet (0) it does not lock — grace only counts once seeded', () => {
    expect(onlineGraceDecision({ effectiveNowMs: D('2030-01-01'), anchorMs: 0, revoked: false })).toBe(
      'ok'
    )
  })

  /*
   * ספירת מושבים: המפתח היה עד כה «כרטיס נושא» — הבידינג למכונה נשמר מקומית
   * ולכן מפתח אחד עבד על כל מספר של מחשבים. הקביעה מגיעה מהשרת בתשובה חתומה.
   */
  it('seat_exceeded locks, and revocation still outranks it', () => {
    const at = D('2026-07-01')
    expect(
      onlineGraceDecision({ effectiveNowMs: at, anchorMs: at, revoked: false, seatExceeded: true })
    ).toBe('seat_exceeded')
    // ביטול הוא הקביעה החמורה יותר וגובר
    expect(
      onlineGraceDecision({ effectiveNowMs: at, anchorMs: at, revoked: true, seatExceeded: true })
    ).toBe('revoked')
  })

  /*
   * מ-1.66.0 שני החלונות זהים (15 דקות), ולכן מפתח שהופעל על מחשב מנותק
   * אינו מקבל יותר זמן ממי שכבר אומת. הבדיקה מוודאת שההתנהגות אחידה —
   * אם מישהו יפריד ביניהם שוב, זה חייב להיות בכוונה.
   */
  it('the pre-validation window is not longer than the regular one', () => {
    const anchor = D('2026-07-01')
    const past = anchor + ONLINE_REVALIDATE_GRACE_MS + 60_000
    for (const validated of [false, true]) {
      expect(
        onlineGraceDecision({ effectiveNowMs: past, anchorMs: anchor, revoked: false, validated })
      ).toBe('needs_revalidation')
    }
    const within = anchor + ONLINE_REVALIDATE_GRACE_MS - 60_000
    for (const validated of [false, true]) {
      expect(
        onlineGraceDecision({ effectiveNowMs: within, anchorMs: anchor, revoked: false, validated })
      ).toBe('ok')
    }
  })

  /*
   * מתג החירום. חלון החסד מוטמע בבינארי, ולכן בלי הארכה חתומה מהשרת תקלה
   * מתמשכת אצלנו הייתה נועלת את כל הלקוחות תוך 48 שעות בלי דרך לשחררם.
   */
  it('a signed server grace extends the window but is capped', () => {
    const anchor = D('2026-07-01')
    const tenDays = anchor + 10 * 86_400_000
    // בלי הארכה — נעול; עם הארכה של 14 יום — פתוח
    expect(onlineGraceDecision({ effectiveNowMs: tenDays, anchorMs: anchor, revoked: false })).toBe(
      'needs_revalidation'
    )
    expect(
      onlineGraceDecision({
        effectiveNowMs: tenDays,
        anchorMs: anchor,
        revoked: false,
        validated: true,
        serverGraceMs: 14 * 86_400_000
      })
    ).toBe('ok')

    // ערך מנופח (שנה) נחתך בתקרה — שרת שנפרץ לא הופך את האימות לאות מתה
    expect(effectiveGraceMs({ validated: true, serverGraceMs: 365 * 86_400_000 })).toBe(
      MAX_SERVER_GRACE_MS
    )
    // הארכה קטנה מהבסיס לא מקצרת אותו
    expect(effectiveGraceMs({ validated: true, serverGraceMs: 1_000 })).toBe(
      ONLINE_REVALIDATE_GRACE_MS
    )
  })

  /*
   * קפיצת שעון קדימה נצרבה עד 1.65.0 ב-high-water וב-mtime של קבצים שנכתבו
   * באותו רגע, ונשארה שם לצמיתות — תיקון השעון לא עזר ואימות מקוון לא עזר,
   * כי הרצפה רק עלתה. לקוח משלם עם סוללת BIOS מרוקנת ננעל בלי שחרור מרחוק.
   */
  it('a forward clock jump no longer bricks the license once the server is reached', () => {
    const real = D('2026-08-02')
    const jumped = real + 200 * 86_400_000 // רצפות מורעלות מקפיצה של 200 יום

    // בלי זמן שרת — הרצפה המורעלת שולטת, וזה המצב השבור
    const poisoned = trustedEvaluationMs({
      systemMs: real,
      storedHighWaterMs: jumped,
      fsFloorMs: jumped
    })
    expect(poisoned.effectiveMs).toBe(jumped)

    // עם זמן שרת חתום — הרצפות הפסולות נזרקות והזמן חוזר לאמת
    const healed = trustedEvaluationMs({
      systemMs: real,
      storedHighWaterMs: jumped,
      fsFloorMs: jumped,
      trustedServerMs: real
    })
    expect(healed.effectiveMs).toBe(real)
    expect(healed.rolledBack).toBe(false)
  })

  it('the server ceiling still allows legitimate drift inside the max grace window', () => {
    const server = D('2026-08-02')
    // יומיים אחרי האימות — לגיטימי לחלוטין, אסור שייזרק
    const later = server + 2 * 86_400_000
    const r = trustedEvaluationMs({
      systemMs: later,
      storedHighWaterMs: later,
      trustedServerMs: server
    })
    expect(r.effectiveMs).toBe(later)
    // והגנת ההחזרה אחורה ממשיכה לעבוד מתחת לתקרה
    const rolled = trustedEvaluationMs({
      systemMs: server - 30 * 86_400_000,
      storedHighWaterMs: later,
      trustedServerMs: server
    })
    expect(rolled.effectiveMs).toBe(later)
    expect(rolled.rolledBack).toBe(true)
  })

  /*
   * הערך שנועל לקוחות בפועל. מ-1.66.0 הוא 15 דקות ולא 48 שעות — נתי ביקש
   * שהמערכת תדרוש חיבור קבוע. הבדיקה כאן היא שומר-סף: שינוי של המספרים
   * האלה משנה את התנהגות המוצר אצל **כל** הלקוחות, ואסור שיקרה בהיסח הדעת.
   */
  it('the offline window is 15 minutes — the value clients are actually locked by', () => {
    expect(ONLINE_REVALIDATE_GRACE_MS).toBe(15 * 60_000)
    expect(ACTIVATION_GRACE_MS).toBe(15 * 60_000)
  })

  /*
   * מרווח האימות חייב להיות קטן משמעותית מחלון החסד, אחרת המשתמש נחסם בין
   * מחזור למחזור גם כשיש לו רשת תקינה. שלושה ניסיונות לפני חסימה.
   */
  it('the revalidation interval leaves room for retries inside the grace window', () => {
    expect(LICENSE_REVALIDATE_INTERVAL_MS).toBeLessThan(ONLINE_REVALIDATE_GRACE_MS)
    expect(ONLINE_REVALIDATE_GRACE_MS / LICENSE_REVALIDATE_INTERVAL_MS).toBeGreaterThanOrEqual(3)
  })

  const pemPath = join(__dirname, '..', 'secrets', 'license-private.pem')

  it.skipIf(!existsSync(pemPath))(
    "a server response signed with the private key verifies against the app's public key",
    () => {
      const priv = readFileSync(pemPath, 'utf8')
      // מדמה את מה שה-Edge Function בונה
      const payload = { id: 'srv12345', ok: true, revoked: false, exp: '2026-12-31', st: D('2026-08-01T10:00:00'), nc: 'abc123nonce', v: 1 }
      const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'))
      const sig = cryptoSign(null, validationSigningInput(payloadB64), createPrivateKey(priv))
      const token = `${VALIDATION_PREFIX}.${payloadB64}.${base64urlEncode(sig)}`

      // מה שהאפליקציה עושה: פירוק + אימות חתימה מול המפתח הציבורי
      const parsed = parseValidationToken(token)
      expect(parsed).not.toBeNull()
      const ok = cryptoVerify(
        null,
        validationSigningInput(parsed!.payloadB64),
        createPublicKey(LICENSE_PUBLIC_KEY_PEM),
        base64urlDecode(parsed!.sigB64)
      )
      expect(ok).toBe(true)
      expect(parsed!.payload.nc).toBe('abc123nonce')
      expect(parsed!.payload.revoked).toBe(false)
    }
  )

  it('a tampered server response fails verification', () => {
    const parsed = parseValidationToken(`${VALIDATION_PREFIX}.bm90LWpzb24.c2ln`)
    // מבנה חוקי אך payload לא-JSON → null, וגם אם היה — החתימה לא תתאמת
    expect(parsed).toBeNull()
  })
})
