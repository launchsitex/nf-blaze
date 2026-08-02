import { describe, expect, it } from 'vitest'
import { mergeStreamedWithFinal } from '../src/main/services/ai/llm'

// ההודעה שנשמרת לצ׳אט חייבת להיות מה שהמשתמש ראה זורם בלייב —
// אחרת הטקסט «נעלם» בסוף הסבב ומוחלף בטקסט האיטרציה האחרונה בלבד.
describe('mergeStreamedWithFinal', () => {
  it('בלי טקסט שהוזרם — הטקסט הסופי כמו שהוא', () => {
    expect(mergeStreamedWithFinal('', 'סיימתי.')).toBe('סיימתי.')
    expect(mergeStreamedWithFinal('', '')).toBe('')
  })

  it('הטקסט הסופי כבר כלול במה שהוזרם — נשמר המוזרם, בלי כפילות', () => {
    const streamed = 'אני בונה את הדף.\n\nסיימתי, הדף מוכן.'
    expect(mergeStreamedWithFinal(streamed, 'סיימתי, הדף מוכן.')).toBe(streamed)
  })

  it('טקסט סופי ריק — נשמר המוזרם', () => {
    expect(mergeStreamedWithFinal('הסבר תוך כדי עבודה', '')).toBe('הסבר תוך כדי עבודה')
  })

  it('זנב שלא הוזרם (סיכום בדיקת דפדפן) מצורף אחרי המוזרם', () => {
    const lastIteration = 'סיימתי לבנות את דף הנחיתה עם כל הסקשנים שביקשת.'
    const streamed = `קודם אקרא את הקבצים.\n\n${lastIteration}`
    const qaNote = '\n\n---\nבדיקת דפדפן (1/2): עבר\nהכל תקין'
    const finalText = `${lastIteration}${qaNote}`.trim()
    const merged = mergeStreamedWithFinal(streamed, finalText)
    expect(merged.startsWith(streamed)).toBe(true)
    expect(merged).toContain('בדיקת דפדפן (1/2)')
    // הטקסט של האיטרציה האחרונה לא מוכפל
    expect(merged.split('סיימתי לבנות').length - 1).toBe(1)
  })

  it('טקסט סופי שלא קשור למוזרם — מצורף בפסקה חדשה', () => {
    const merged = mergeStreamedWithFinal('הסבר ראשון', 'סיכום שונה לגמרי')
    expect(merged).toBe('הסבר ראשון\n\nסיכום שונה לגמרי')
  })

  it('מוזרם קצר מהעוגן (פחות מ-40 תווים) — המיזוג עדיין עובד', () => {
    const merged = mergeStreamedWithFinal('קצר.', 'קצר. ועוד תוספת.')
    expect(merged).toBe('קצר. ועוד תוספת.')
  })
})
