import { describe, expect, it, vi } from 'vitest'

// חוסמים את שרשרת ה-import של electron/סודות — כאן נבדקת הלוגיקה הטהורה
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/nf-test' }, shell: {} }))
vi.mock('../src/main/services/secrets', () => ({
  getSecret: () => undefined,
  setSecret: () => undefined,
  clearSecret: () => undefined,
  supabaseMgmtSlot: (id: string) => `supabase-mgmt-${id}`
}))
vi.mock('../src/main/services/storage', () => ({ getProject: () => undefined }))
vi.mock('../src/main/services/integrations/store', () => ({
  loadIntegrations: () => ({ supabase: { connected: false } })
}))

const { sanitizeFunctionSlug, deployEdgeFunction, buildEdgeFunctionTool } = await import(
  '../src/main/services/integrations/supabase_functions'
)

describe('sanitizeFunctionSlug — שם חוקי ל-Edge Function', () => {
  it('מנרמל רווחים וקו תחתון למקפים', () => {
    expect(sanitizeFunctionSlug('Send Email')).toBe('send-email')
    expect(sanitizeFunctionSlug('send_email')).toBe('send-email')
    expect(sanitizeFunctionSlug('  Charge Card  ')).toBe('charge-card')
  })

  it('מסיר תווים לא חוקיים ומקפים בקצוות', () => {
    expect(sanitizeFunctionSlug('שלח-מייל!')).toBe('')
    expect(sanitizeFunctionSlug('--webhook--')).toBe('webhook')
    expect(sanitizeFunctionSlug('pay@stripe#1')).toBe('paystripe1')
  })

  it('חוסם קלט ריק', () => {
    expect(sanitizeFunctionSlug('')).toBe('')
    expect(sanitizeFunctionSlug('   ')).toBe('')
  })
})

describe('deployEdgeFunction — יצירה מול עדכון', () => {
  function mockFetch(handlers: Array<{ status: number; body: unknown }>) {
    let call = 0
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string; body?: string }) => {
        calls.push({
          url,
          method: init?.method || 'GET',
          body: init?.body ? JSON.parse(init.body) : undefined
        })
        const h = handlers[Math.min(call++, handlers.length - 1)]
        return {
          ok: h.status >= 200 && h.status < 300,
          status: h.status,
          text: async () => JSON.stringify(h.body)
        }
      })
    )
    return calls
  }

  it('פונקציה שלא קיימת נוצרת ב-POST', async () => {
    const calls = mockFetch([
      { status: 404, body: { message: 'not found' } },
      { status: 201, body: { slug: 'hello', version: 1 } }
    ])
    const res = await deployEdgeFunction({
      ref: 'abcdefghijklmnopqrst',
      token: 'sbp_x',
      slug: 'hello',
      code: 'Deno.serve(() => new Response("hi"))'
    })
    expect(res.ok).toBe(true)
    expect(res.created).toBe(true)
    expect(calls[1].method).toBe('POST')
    expect(calls[1].url).toMatch(/\/functions$/)
    expect(calls[1].body).toMatchObject({ slug: 'hello', verify_jwt: true })
    vi.unstubAllGlobals()
  })

  it('פונקציה קיימת מעודכנת ב-PATCH ולא נכשלת על «כבר קיים»', async () => {
    const calls = mockFetch([
      { status: 200, body: { slug: 'hello', version: 3 } },
      { status: 200, body: { slug: 'hello', version: 4 } }
    ])
    const res = await deployEdgeFunction({
      ref: 'abcdefghijklmnopqrst',
      token: 'sbp_x',
      slug: 'hello',
      code: 'Deno.serve(() => new Response("v2"))'
    })
    expect(res.ok).toBe(true)
    expect(res.created).toBe(false)
    expect(res.version).toBe(4)
    expect(calls[1].method).toBe('PATCH')
    expect(calls[1].url).toMatch(/\/functions\/hello$/)
    vi.unstubAllGlobals()
  })

  it('verify_jwt=false עובר כמו שהוא — נדרש ל-webhook ציבורי', async () => {
    const calls = mockFetch([
      { status: 404, body: {} },
      { status: 201, body: { slug: 'stripe-hook', version: 1 } }
    ])
    await deployEdgeFunction({
      ref: 'abcdefghijklmnopqrst',
      token: 'sbp_x',
      slug: 'stripe-hook',
      code: 'x',
      verifyJwt: false
    })
    expect(calls[1].body).toMatchObject({ verify_jwt: false })
    vi.unstubAllGlobals()
  })

  it('‏403 מתורגם לרמז על הרשאת Edge Functions חסרה', async () => {
    mockFetch([
      { status: 404, body: {} },
      { status: 403, body: { message: 'insufficient scope' } }
    ])
    const res = await deployEdgeFunction({
      ref: 'abcdefghijklmnopqrst',
      token: 'sbp_x',
      slug: 'hello',
      code: 'x'
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('insufficient scope')
    expect(res.error).toContain('Edge Functions')
    vi.unstubAllGlobals()
  })
})

describe('buildEdgeFunctionTool — זמינות הכלי', () => {
  it('לא נחשף לסוכן כשאין Supabase מחובר לפרויקט', () => {
    expect(buildEdgeFunctionTool('any-project')).toBeNull()
  })
})
