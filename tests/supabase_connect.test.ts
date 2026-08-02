import { describe, expect, it } from 'vitest'
import {
  HEALTH_PATH,
  isEndpointRestriction,
  isJwtKey,
  jwtKeyRole,
  normalizeSupabaseUrl,
  sanitizeSupabaseKey,
  supabaseAuthHeaders
} from '../src/main/services/integrations/supabase'

function makeJwt(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role }), 'utf8').toString('base64url')
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`
}

describe('sanitizeSupabaseKey — הדבקה מלוכלכת מהדשבורד', () => {
  it('מסיר שורה חדשה ורווחים באמצע', () => {
    expect(sanitizeSupabaseKey('sb_publishable_abc\n  def')).toBe('sb_publishable_abcdef')
  })

  it('מסיר תווים בלתי-נראים (zero-width, BOM, סימני כיווניות)', () => {
    expect(sanitizeSupabaseKey('﻿sb_publishable_a​b‏c')).toBe('sb_publishable_abc')
  })

  it('לא נוגע במפתח נקי', () => {
    const clean = 'sb_publishable_1234567890abcdef'
    expect(sanitizeSupabaseKey(clean)).toBe(clean)
  })

  it('מחזיר מחרוזת ריקה לקלט ריק', () => {
    expect(sanitizeSupabaseKey('')).toBe('')
    expect(sanitizeSupabaseKey('   ')).toBe('')
  })
})

describe('isJwtKey — הבחנה בין דור ישן לחדש', () => {
  it('מזהה מפתח JWT מהדור הישן', () => {
    expect(isJwtKey(makeJwt('anon'))).toBe(true)
  })

  it('מזהה שמפתח publishable אינו JWT', () => {
    expect(isJwtKey('sb_publishable_1234567890abcdef')).toBe(false)
    expect(isJwtKey('sb_secret_1234567890abcdef')).toBe(false)
  })

  it('לא נופל על טקסט אקראי', () => {
    expect(isJwtKey('')).toBe(false)
    expect(isJwtKey('eyJ')).toBe(false)
    expect(isJwtKey('eyJabc.def')).toBe(false)
  })
})

describe('supabaseAuthHeaders — הבאג שגרם ל-401', () => {
  it('מפתח publishable נשלח ב-apikey בלבד — Supabase דוחה אותו ב-Bearer', () => {
    const headers = supabaseAuthHeaders('sb_publishable_1234567890abcdef')
    expect(headers.apikey).toBe('sb_publishable_1234567890abcdef')
    expect(headers.Authorization).toBeUndefined()
  })

  it('מפתח JWT מהדור הישן נשלח בשניהם, כמו קודם', () => {
    const jwt = makeJwt('anon')
    const headers = supabaseAuthHeaders(jwt)
    expect(headers.apikey).toBe(jwt)
    expect(headers.Authorization).toBe(`Bearer ${jwt}`)
  })
})

describe('jwtKeyRole — תפיסת מפתח בשדה הלא נכון', () => {
  it('מזהה מפתח service_role', () => {
    expect(jwtKeyRole(makeJwt('service_role'))).toBe('service_role')
  })

  it('מזהה מפתח anon', () => {
    expect(jwtKeyRole(makeJwt('anon'))).toBe('anon')
  })

  it('מחזיר null למפתח שאינו JWT', () => {
    expect(jwtKeyRole('sb_publishable_abc')).toBeNull()
  })

  it('לא זורק על JWT פגום', () => {
    expect(jwtKeyRole('eyJhbGciOiJIUzI1NiJ9.###.sig')).toBeNull()
  })
})

describe('נקודת הבדיקה — הבאג שהודעת השגיאה חשפה', () => {
  it('לא משתמשת ב-/rest/v1/ — הוא מוגבל ל-service_role ודוחה מפתח anon תקין', () => {
    expect(HEALTH_PATH).not.toContain('/rest/')
  })

  it('משתמשת בנקודה שמקבלת anon', () => {
    expect(HEALTH_PATH).toBe('/auth/v1/health')
  })
})

describe('isEndpointRestriction — הגבלת נקודה אינה מפתח פסול', () => {
  it('מזהה את ההודעה המדויקת ש-Supabase החזירה', () => {
    expect(
      isEndpointRestriction(
        '{"message":"Invalid API key","hint":"Only the `service_role` API key can be used for this endpoint."}'
      )
    ).toBe(true)
  })

  it('מזהה גם בלי הגרשיים האחוריים', () => {
    expect(isEndpointRestriction('Only the service_role API key can be used')).toBe(true)
  })

  it('לא מסמן מפתח פסול אמיתי כהצלחה', () => {
    expect(
      isEndpointRestriction('{"message":"Invalid API key","hint":"Double check your API key."}')
    ).toBe(false)
    expect(isEndpointRestriction('{"message":"No API key found in request"}')).toBe(false)
    expect(isEndpointRestriction('')).toBe(false)
  })
})

describe('normalizeSupabaseUrl', () => {
  it('מקבל כתובת תקינה ומסיר לוכסן בסוף', () => {
    expect(normalizeSupabaseUrl('https://abcdefg.supabase.co/')).toBe('https://abcdefg.supabase.co')
  })

  it('דוחה כתובת שאינה Supabase', () => {
    expect(() => normalizeSupabaseUrl('https://example.com')).toThrow(/לא חוקית/)
  })

  it('דוחה כתובת עם נתיב', () => {
    expect(() => normalizeSupabaseUrl('https://abc.supabase.co/rest/v1')).toThrow(/לא חוקית/)
  })
})
