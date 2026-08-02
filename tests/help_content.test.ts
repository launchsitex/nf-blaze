import { describe, expect, it } from 'vitest'
import { HELP_SHORTCUTS, HELP_TOPICS } from '../src/shared/help'

/**
 * מרכז העזרה נקרא על ידי לקוחות, בדיוק כמו הערות הגרסה. הבדיקה כאן היא
 * אותה בדיקה שמגינה על `release_notes.ts` — כדי שתוכן שנוסף למדריך בעתיד
 * לא יחשוף מבנה פנימי, כתובות שרת או תיאור של תקלה שתוקנה.
 */
describe('תוכן מרכז העזרה אינו חושף מידע על המערכת', () => {
  const forbidden = [
    // מבנה פנימי
    /\.tsx?\b/i,
    /\bsrc\//i,
    /\bipc\b/i,
    /\.nf-blaze\b/i,
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

  const allText = HELP_TOPICS.flatMap((t) => [
    t.title,
    t.intro,
    ...t.items.flatMap((i) => [i.title, i.text])
  ])

  it('אין נתיבים, כתובות פנימיות, מזהי מפתחות או תיאורי פרצות', () => {
    for (const text of allText) {
      for (const bad of forbidden) {
        expect(bad.test(text), `«${text}» מכיל ${bad}`).toBe(false)
      }
    }
  })

  it('לכל נושא יש כותרת, פתיח ולפחות פריט אחד', () => {
    expect(HELP_TOPICS.length).toBeGreaterThan(0)
    for (const topic of HELP_TOPICS) {
      expect(topic.id.trim().length).toBeGreaterThan(1)
      expect(topic.title.trim().length).toBeGreaterThan(2)
      expect(topic.intro.trim().length).toBeGreaterThan(10)
      expect(topic.items.length).toBeGreaterThan(0)
      for (const item of topic.items) {
        expect(item.title.trim().length).toBeGreaterThan(1)
        expect(item.text.trim().length).toBeGreaterThan(20)
      }
    }
  })

  it('מזהי הנושאים ייחודיים — התפריט מסתמך על זה', () => {
    const ids = HELP_TOPICS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('לכל קיצור מקלדת יש הסבר', () => {
    for (const s of HELP_SHORTCUTS) {
      expect(s.keys.trim().length).toBeGreaterThan(0)
      expect(s.what.trim().length).toBeGreaterThan(3)
    }
  })
})
