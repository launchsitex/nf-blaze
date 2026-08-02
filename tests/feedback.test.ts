import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_EMAIL_RE,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_TITLE_MAX,
  isFeedbackKind,
  validateFeedbackInput,
  type FeedbackSubmitInput
} from '../src/shared/types'

const base: FeedbackSubmitInput = {
  kind: 'bug',
  title: 'התצוגה לא עולה',
  message: 'יצרתי פרויקט חדש והתצוגה נשארה ריקה.'
}

describe('סוגי הפניות במשוב', () => {
  it('כל סוג מזוהה, ייחודי, ועם תווית והסבר', () => {
    const ids = FEEDBACK_KINDS.map((k) => k.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const kind of FEEDBACK_KINDS) {
      expect(isFeedbackKind(kind.id)).toBe(true)
      expect(kind.label.trim().length).toBeGreaterThan(2)
      expect(kind.hint.trim().length).toBeGreaterThan(10)
    }
  })

  it('כולל בקשת/חידוש רישיון', () => {
    expect(isFeedbackKind('license')).toBe(true)
    expect(FEEDBACK_KINDS.find((k) => k.id === 'license')?.label).toContain('רישיון')
  })

  it('סוג שאינו ברשימה נדחה — השרת אוכף את אותה רשימה', () => {
    expect(isFeedbackKind('spam')).toBe(false)
    expect(isFeedbackKind('')).toBe(false)
    expect(isFeedbackKind(undefined)).toBe(false)
    expect(isFeedbackKind(null)).toBe(false)
    expect(isFeedbackKind(42)).toBe(false)
  })
})

describe('ולידציה של פנייה — בעל רישיון מול פונה בלי רישיון', () => {
  it('בעל רישיון: כותרת ותיאור מספיקים, שם ואימייל לא נדרשים', () => {
    expect(validateFeedbackInput(base, true)).toBeNull()
  })

  it('בלי רישיון: שם ואימייל הם חובה — אחרת אין לאן להשיב', () => {
    expect(validateFeedbackInput(base, false)).toContain('שם')
    expect(validateFeedbackInput({ ...base, name: 'ישראל ישראלי' }, false)).toContain('אימייל')
    expect(
      validateFeedbackInput(
        { ...base, name: 'ישראל ישראלי', email: 'israel@example.com' },
        false
      )
    ).toBeNull()
  })

  it('כותרת או תיאור ריקים נדחים בשני המצבים', () => {
    expect(validateFeedbackInput({ ...base, title: '   ' }, true)).toContain('כותרת')
    expect(validateFeedbackInput({ ...base, message: '' }, true)).toContain('לתאר')
  })

  it('אימייל פסול נדחה גם כשהוא אופציונלי', () => {
    expect(validateFeedbackInput({ ...base, email: 'לא-אימייל' }, true)).toContain('אימייל')
    expect(validateFeedbackInput({ ...base, email: 'a@b.co' }, true)).toBeNull()
  })

  it('סוג פנייה לא חוקי נדחה', () => {
    expect(
      validateFeedbackInput({ ...base, kind: 'drop-table' as never }, true)
    ).toContain('סוג')
  })
})

/**
 * הבדיקות כאן מגנות על התשובה לשאלה «האם אפשר להריץ שאילתות דרך המשוב».
 * הן לא מוכיחות את התנהגות המסד — הן מוודאות ששכבת האפליקציה **לא**
 * מנסה לנקות או לפרש את הטקסט, כי הניקוי אינו ההגנה: ההגנה היא שהערך
 * לעולם אינו מגיע ל-SQL כטקסט. טקסט שנראה כמו SQL נשמר כמחרוזת רגילה.
 */
describe('טקסט שנראה כמו SQL הוא תוכן, לא פקודה', () => {
  const payloads = [
    "'; DROP TABLE nfb_user_feedback; --",
    "1' OR '1'='1",
    'admin"--',
    '\\x27; select pg_sleep(10); --',
    '${jndi:ldap://evil}',
    '<script>alert(1)</script>'
  ]

  it('נשמר כתוכן חוקי ואינו נדחה — הוא פשוט טקסט', () => {
    for (const p of payloads) {
      expect(validateFeedbackInput({ ...base, title: p, message: p }, true)).toBeNull()
    }
  })

  it('כתובת אימייל בעלת צורת הזרקה נדחית בביטוי הרגולרי', () => {
    expect(FEEDBACK_EMAIL_RE.test("a@b.co'; drop table x; --")).toBe(false)
    expect(FEEDBACK_EMAIL_RE.test('a b@c.co')).toBe(false)
    expect(FEEDBACK_EMAIL_RE.test('real@nf-blaze.dev')).toBe(true)
  })

  it('האורכים חסומים, כך שאי אפשר להזריק מטען ענק', () => {
    expect(FEEDBACK_TITLE_MAX).toBeLessThanOrEqual(200)
    expect(FEEDBACK_MESSAGE_MAX).toBeLessThanOrEqual(8000)
  })
})

/**
 * שומר-סף על ה-Edge Function ועל המיגרציה: אם מישהו יוסיף בעתיד בניית SQL
 * ממחרוזות (‏`EXECUTE`, ‏`format()`, שרשור `||` בתוך שאילתה), הבדיקה תיפול.
 * זו הנקודה היחידה שבה טקסט של משתמש היה יכול להפוך לפקודה.
 */
describe('אין בניית SQL דינמית בצד השרת', () => {
  const portal = join(__dirname, '..', 'license-portal')
  const fn = readFileSync(
    join(portal, 'supabase', 'functions', 'submit-feedback', 'index.ts'),
    'utf8'
  )
  const migration = readFileSync(
    join(portal, 'supabase', 'migrations', '0007_feedback_unlicensed.sql'),
    'utf8'
  )

  it('ה-Edge Function ניגשת למסד רק דרך insert/select/rpc מפורשים', () => {
    // אין שאילתה גולמית ואין קריאה שמקבלת SQL כמחרוזת
    expect(/\.rpc\(\s*['"`]exec/i.test(fn)).toBe(false)
    expect(/execute\s+/i.test(fn)).toBe(false)
    expect(/\bsql\s*[:=]\s*[`'"]/i.test(fn)).toBe(false)
    // הכתיבה היחידה היא insert על טבלת המשוב
    expect(fn).toContain(".from('nfb_user_feedback').insert(")
  })

  it('פונקציית מגבלת הקצב אינה בונה SQL ממחרוזות ומקבעת search_path', () => {
    const body = migration.slice(migration.indexOf('nfb_feedback_throttle_check'))
    expect(/\bexecute\b/i.test(body)).toBe(false)
    expect(/\bformat\s*\(/i.test(body)).toBe(false)
    // security definer בלי search_path מקובע הוא וקטור השתלטות מוכר
    expect(body).toContain('set search_path = public')
    // והרשאת ההרצה נשללת מכל מי שאינו service_role
    expect(migration).toMatch(/revoke all on function[\s\S]*nfb_feedback_throttle_check/i)
  })

  it('המיגרציה מגבילה את סוגי הפנייה ברמת המסד', () => {
    expect(migration).toMatch(/check \(kind in \(/i)
    for (const k of FEEDBACK_KINDS) {
      expect(migration).toContain(`'${k.id}'`)
    }
  })
})
