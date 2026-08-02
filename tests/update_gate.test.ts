import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  decideUpdate,
  isNewerVersion,
  nextSnooze,
  snoozeVerdict,
  MAX_UPDATE_SNOOZES,
  UPDATE_SNOOZE_MS
} from '../src/shared/version'
import { notesSince, RELEASE_NOTES } from '../src/shared/release_notes'

describe('compareVersions', () => {
  it('משווה לפי סדר סמנטי ולא לקסיקוגרפי', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.63.0', '1.63.0')).toBe(0)
  })

  it('סובל תחילית v, אורך שונה, וקלט פגום', () => {
    expect(compareVersions('v1.64.0', '1.64')).toBe(0)
    expect(compareVersions('1.64', '1.64.0')).toBe(0)
    expect(compareVersions('1.64.1', '1.64')).toBeGreaterThan(0)
    expect(compareVersions('', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('abc', 'def')).toBe(0)
  })

  it('מתעלם מסיומת pre-release', () => {
    expect(compareVersions('1.64.0-beta.1', '1.64.0')).toBe(0)
  })

  it('isNewerVersion נכון בשני הכיוונים', () => {
    expect(isNewerVersion('1.64.0', '1.63.0')).toBe(true)
    expect(isNewerVersion('1.63.0', '1.64.0')).toBe(false)
    expect(isNewerVersion('1.63.0', '1.63.0')).toBe(false)
  })
})

describe('decideUpdate — ההחלטה שנועלת משתמשים', () => {
  it('אין מניפסט → לא חוסם. שרת שנפל הוא בעיה שלנו, לא של הלקוח', () => {
    expect(decideUpdate(null, '1.63.0')).toEqual({ available: false, required: false })
    expect(decideUpdate(undefined, '1.63.0')).toEqual({ available: false, required: false })
  })

  it('מניפסט פגום → לא חוסם', () => {
    expect(decideUpdate({} as never, '1.63.0').required).toBe(false)
    expect(decideUpdate({ version: '' }, '1.63.0').required).toBe(false)
    expect(decideUpdate({ version: '   ' }, '1.63.0').required).toBe(false)
    expect(decideUpdate({ version: 42 as never }, '1.63.0').required).toBe(false)
  })

  it('הגרסה עדכנית → אין עדכון ואין חסימה', () => {
    expect(decideUpdate({ version: '1.63.0' }, '1.63.0')).toEqual({
      available: false,
      required: false
    })
  })

  it('גרסה ישנה יותר בשרת → לא מוריד לאחור', () => {
    expect(decideUpdate({ version: '1.62.0' }, '1.63.0').available).toBe(false)
  })

  it('גרסה חדשה → חובה כברירת מחדל', () => {
    const d = decideUpdate({ version: '1.64.0' }, '1.63.0')
    expect(d).toEqual({ available: true, required: true, newVersion: '1.64.0' })
  })

  it('mandatory:false → מודיע אבל לא חוסם (כיבוי מרחוק לגרסה תקולה)', () => {
    const d = decideUpdate({ version: '1.64.0', mandatory: false }, '1.63.0')
    expect(d.available).toBe(true)
    expect(d.required).toBe(false)
  })

  it('minVersion גובר על mandatory ומאפשר חיוב חלקי', () => {
    // מתחת לרף — חייב לעדכן למרות mandatory:false
    expect(
      decideUpdate({ version: '1.64.0', mandatory: false, minVersion: '1.63.0' }, '1.62.0').required
    ).toBe(true)
    // מעל הרף — מקבל הודעה בלבד, למרות mandatory:true
    expect(
      decideUpdate({ version: '1.64.0', mandatory: true, minVersion: '1.63.0' }, '1.63.0').required
    ).toBe(false)
  })

  it('minVersion ריק אינו מבטל את mandatory', () => {
    expect(decideUpdate({ version: '1.64.0', minVersion: '  ' }, '1.63.0').required).toBe(true)
  })
})

/**
 * דחיית עדכון — «אני באמצע עבודה». זו הנקודה שבה משתמש יכול לפתוח לעצמו
 * את המערכת למרות עדכון חובה, ולכן כל ענף כאן מכוסה.
 */
describe('snoozeVerdict — דחיית עדכון חובה', () => {
  const now = Date.parse('2026-08-02T12:00:00Z')

  it('בלי דחייה קודמת — לא פעילה, ומותר לדחות', () => {
    const v = snoozeVerdict({ snooze: null, newVersion: '1.67.0', nowMs: now })
    expect(v.active).toBe(false)
    expect(v.canSnooze).toBe(true)
  })

  it('דחייה בתוקף פותחת את המערכת', () => {
    const snooze = { version: '1.67.0', untilMs: now + 3_600_000, count: 1 }
    const v = snoozeVerdict({ snooze, newVersion: '1.67.0', nowMs: now })
    expect(v.active).toBe(true)
    expect(v.untilMs).toBe(snooze.untilMs)
  })

  it('דחייה שנגמרה מחזירה את החסימה', () => {
    const snooze = { version: '1.67.0', untilMs: now - 1, count: 1 }
    expect(snoozeVerdict({ snooze, newVersion: '1.67.0', nowMs: now }).active).toBe(false)
  })

  it('גרסה חדשה יותר מאפסת את המונה — דחייה אינה מכסה גרסאות עתידיות', () => {
    const snooze = { version: '1.67.0', untilMs: now + 3_600_000, count: MAX_UPDATE_SNOOZES }
    const v = snoozeVerdict({ snooze, newVersion: '1.68.0', nowMs: now })
    expect(v.active).toBe(false)
    expect(v.canSnooze).toBe(true)
  })

  it('אחרי המכסה אי אפשר לדחות שוב', () => {
    const snooze = { version: '1.67.0', untilMs: now - 1, count: MAX_UPDATE_SNOOZES }
    expect(snoozeVerdict({ snooze, newVersion: '1.67.0', nowMs: now }).canSnooze).toBe(false)
    expect(nextSnooze({ snooze, newVersion: '1.67.0', nowMs: now })).toBeNull()
  })

  it('שעון שהוחזר אחורה אינו מאריך דחייה', () => {
    // «נותרו» יותר מחלון הדחייה — בהכרח שעון שגוי או ערך שנערך ידנית
    const snooze = { version: '1.67.0', untilMs: now + UPDATE_SNOOZE_MS + 60_000, count: 1 }
    expect(snoozeVerdict({ snooze, newVersion: '1.67.0', nowMs: now }).active).toBe(false)
  })

  it('nextSnooze מקדם את המונה ומאריך ב-12 שעות', () => {
    const first = nextSnooze({ snooze: null, newVersion: '1.67.0', nowMs: now })
    expect(first).toEqual({ version: '1.67.0', untilMs: now + UPDATE_SNOOZE_MS, count: 1 })
    const second = nextSnooze({ snooze: first, newVersion: '1.67.0', nowMs: now })
    expect(second?.count).toBe(2)
  })

  it('שתי דחיות מכסות יממה, ואז חובה לעדכן', () => {
    expect(MAX_UPDATE_SNOOZES * UPDATE_SNOOZE_MS).toBe(86_400_000)
  })

  it('בלי גרסה חדשה אין מה לדחות', () => {
    expect(nextSnooze({ snooze: null, newVersion: undefined, nowMs: now })).toBeNull()
  })
})

describe('notesSince — מה מוצג בפופ-אפ «מה חדש»', () => {
  const cmp = compareVersions

  it('התקנה ראשונה מציגה רק את הגרסה הנוכחית', () => {
    const notes = notesSince(undefined, '1.63.0', cmp)
    expect(notes.map((n) => n.version)).toEqual(['1.63.0'])
  })

  it('קפיצה על כמה גרסאות מציגה את כולן', () => {
    const notes = notesSince('1.62.0', '1.64.0', cmp)
    expect(notes.map((n) => n.version)).toEqual(['1.64.0', '1.63.0'])
  })

  it('אותה גרסה → לא מציג כלום', () => {
    expect(notesSince('1.64.0', '1.64.0', cmp)).toHaveLength(0)
  })

  it('לא מציג גרסאות שעוד לא הותקנו', () => {
    const notes = notesSince('1.62.0', '1.63.0', cmp)
    expect(notes.every((n) => cmp(n.version, '1.63.0') <= 0)).toBe(true)
  })
})

describe('הערות הגרסה אינן חושפות מידע על המערכת', () => {
  /**
   * מה שאסור זה **חשיפה של המערכת שלנו** — לא שימוש במילה «סוד» כתיאור
   * תועלת ללקוח. הדפוסים כאן מכוונים לדליפה אמיתית: נתיבים, כתובות
   * פנימיות, מזהי מפתחות, ולשון שמודה בפגם ומלמדת מה לחפש בגרסה ישנה.
   */
  const forbidden = [
    // מבנה פנימי
    /\.tsx?\b/i,
    /\bsrc\//i,
    /\bipc\b/i,
    // כתובות ומזהים
    /https?:\/\//i,
    /supabase\.co/i,
    /\bsk-(ant|proj|admin)/i,
    /\bsb[_-](publishable|secret)/i,
    /\bsbp_/i,
    // לשון שמלמדת תוקף מה לנצל בגרסאות ישנות
    /פרצה|פרצות/,
    /חולשה/,
    /עקיפ(ה|ות)/,
    /פגיעות/,
    /נחש[פף]/,
    /דלי?פ(ה|ת)/,
    /\bbypass\b/i,
    /\bCVE-/i
  ]

  it('אין נתיבים, כתובות פנימיות, מזהי מפתחות או תיאורי פרצות', () => {
    for (const note of RELEASE_NOTES) {
      const text = [note.headline, ...note.items].join(' | ')
      for (const bad of forbidden) {
        expect(bad.test(text), `«${text}» מכיל ${bad}`).toBe(false)
      }
    }
  })

  it('לכל גרסה יש כותרת ולפחות שינוי אחד', () => {
    for (const note of RELEASE_NOTES) {
      expect(note.headline.trim().length).toBeGreaterThan(3)
      expect(note.items.length).toBeGreaterThan(0)
      expect(note.date.trim().length).toBeGreaterThan(3)
    }
  })

  it('הרשימה ממוינת מהחדש לישן — הפופ-אפ מסתמך על זה', () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      expect(
        compareVersions(RELEASE_NOTES[i - 1]!.version, RELEASE_NOTES[i]!.version)
      ).toBeGreaterThan(0)
    }
  })
})
