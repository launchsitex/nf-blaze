import { describe, expect, it } from 'vitest'
import { normalizeRepoUrl, repoNameFromUrl } from '../src/main/services/integrations/github'

describe('normalizeRepoUrl — כל הצורות שמשתמש עלול להדביק', () => {
  const expected = 'https://github.com/vercel/next.js.git'

  it('מקבל כתובת דפדפן', () => {
    expect(normalizeRepoUrl('https://github.com/vercel/next.js')).toBe(expected)
  })

  it('מקבל כתובת clone עם .git', () => {
    expect(normalizeRepoUrl('https://github.com/vercel/next.js.git')).toBe(expected)
  })

  it('מקבל קיצור owner/repo', () => {
    expect(normalizeRepoUrl('vercel/next.js')).toBe(expected)
  })

  it('מקבל כתובת SSH', () => {
    expect(normalizeRepoUrl('git@github.com:vercel/next.js.git')).toBe(expected)
  })

  it('מתעלם מרווחים ומלוכסן בסוף', () => {
    expect(normalizeRepoUrl('  https://github.com/vercel/next.js/  ')).toBe(expected)
  })

  it('שומר על מקפים ונקודות בשמות', () => {
    expect(normalizeRepoUrl('my-org/some.repo-name')).toBe(
      'https://github.com/my-org/some.repo-name.git'
    )
  })
})

describe('normalizeRepoUrl — קלט לא תקין נדחה עם הסבר', () => {
  it('דוחה קלט ריק', () => {
    expect(() => normalizeRepoUrl('')).toThrow(/יש להזין/)
    expect(() => normalizeRepoUrl('   ')).toThrow(/יש להזין/)
  })

  it('דוחה אתר אחר', () => {
    expect(() => normalizeRepoUrl('https://gitlab.com/a/b')).toThrow(/לא מזוהה/)
  })

  it('דוחה טקסט חופשי', () => {
    expect(() => normalizeRepoUrl('תביא לי את הריפו של הפרויקט')).toThrow(/לא מזוהה/)
  })

  // כתובת GitHub שאינה ריפו עוברת נרמול ונופלת בשכפול עם «הריפוזיטורי לא נמצא» —
  // הודעה ברורה למשתמש, ולכן אין צורך לחסום אותה כאן
  it('לא מנחש: כתובת GitHub תקנית תמיד הופכת ל-owner/repo', () => {
    expect(normalizeRepoUrl('https://github.com/settings/tokens')).toBe(
      'https://github.com/settings/tokens.git'
    )
  })

  it('דוחה ניסיון הזרקת מארח אחר', () => {
    expect(() => normalizeRepoUrl('https://evil.com/github.com/a/b')).toThrow(/לא מזוהה/)
  })
})

describe('repoNameFromUrl', () => {
  it('מחלץ שם ריפו לשם ברירת מחדל של הפרויקט', () => {
    expect(repoNameFromUrl('https://github.com/vercel/next.js.git')).toBe('next.js')
    expect(repoNameFromUrl('https://github.com/my-org/crm-system.git')).toBe('crm-system')
  })

  it('מחזיר ריק כשאין התאמה', () => {
    expect(repoNameFromUrl('not a url')).toBe('')
  })
})
