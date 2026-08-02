import { createHash } from 'crypto'
import { get } from 'http'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * זרימת «התחבר עם…» מקצה לקצה בצד הלקוח: מה שנשלח לדפדפן, מה שהמאזין
 * המקומי מקבל, ומה שנשלח ל-broker בהחלפה. ה-broker עצמו מדומה — כאן
 * נבדק שהאפליקציה מתנהגת נכון, כולל שקשר ה-PKCE נאכף.
 */

let openedUrl = ''
vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(async (url: string) => {
      openedUrl = url
    })
  },
  app: { getPath: () => '/tmp/nf-test' }
}))

const { runOAuthFlow, cancelOAuthFlow, brokerBase } = await import(
  '../src/main/services/integrations/oauth'
)

function b64urlSha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

/** ממתין עד שהדפדפן «נפתח», ומחזיר את פרמטרי הכתובת */
async function waitForBrowser(): Promise<URLSearchParams> {
  for (let i = 0; i < 200; i++) {
    if (openedUrl) return new URL(openedUrl).searchParams
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('הדפדפן לא נפתח')
}

/** מדמה את ההפניה שה-broker עושה חזרה ללולאה המקומית */
function hitCallback(port: string, query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/callback?${query}`, (res) => {
      res.resume()
      resolve(res.statusCode || 0)
    }).on('error', reject)
  })
}

afterEach(() => {
  openedUrl = ''
  vi.unstubAllGlobals()
  cancelOAuthFlow('ניקוי בדיקה')
})

describe('runOAuthFlow — חיבור בלחיצה אחת', () => {
  it('פותח את הספק, מקבל את ההפניה המקומית, ומחליף את הצופן לטוקן', async () => {
    let sentBody: { blob?: string; verifier?: string } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sentBody = JSON.parse(init.body)
        return {
          ok: true,
          text: async () => JSON.stringify({ access_token: 'gho_test', expires_in: 3600 })
        }
      })
    )

    const flow = runOAuthFlow('github')
    const params = await waitForBrowser()

    // מה שנשלח לדפדפן: הספק, הפורט המקומי, ה-challenge והמזהה — בלי סודות
    expect(params.get('provider')).toBe('github')
    expect(new URL(openedUrl).origin + new URL(openedUrl).pathname).toBe(`${brokerBase()}/start`)
    const port = params.get('port')!
    const sid = params.get('sid')!
    const challenge = params.get('challenge')!
    expect(Number(port)).toBeGreaterThan(1024)

    expect(await hitCallback(port, `sid=${encodeURIComponent(sid)}&blob=SEALED`)).toBe(200)

    const tokens = await flow
    expect(tokens.accessToken).toBe('gho_test')
    expect(tokens.provider).toBe('github')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())

    // הקשר ה-PKCE: ה-verifier שנשלח ב-exchange הוא זה שממנו נגזר ה-challenge
    expect(sentBody.blob).toBe('SEALED')
    expect(b64urlSha256(sentBody.verifier!)).toBe(challenge)
  })

  it('מתעלם מהפניה עם מזהה שגוי ולא מסיים את ההמתנה', async () => {
    const flow = runOAuthFlow('vercel')
    const params = await waitForBrowser()
    const port = params.get('port')!

    // ניסיון מבחוץ לפורט המקומי — נדחה, וההמתנה נשארת פתוחה
    expect(await hitCallback(port, 'sid=not-the-right-one&blob=SEALED')).toBe(400)

    let settled = false
    void flow.then(
      () => (settled = true),
      () => (settled = true)
    )
    await new Promise((r) => setTimeout(r, 60))
    expect(settled).toBe(false)

    cancelOAuthFlow('בוטל בבדיקה')
    await expect(flow).rejects.toThrow('בוטל בבדיקה')
  })

  it('מעביר שגיאה מהספק כלשונה למשתמש', async () => {
    const flow = runOAuthFlow('supabase')
    // מצרפים את הציפייה מיד — אחרת הדחייה מגיעה לפני שמישהו מאזין לה
    const rejected = expect(flow).rejects.toThrow('האישור בוטל.')
    const params = await waitForBrowser()

    expect(
      await hitCallback(
        params.get('port')!,
        `sid=${encodeURIComponent(params.get('sid')!)}&error=${encodeURIComponent('האישור בוטל.')}`
      )
    ).toBe(200)

    await rejected
  })

  it('לחיצה חוזרת מבטלת את הזרימה הקודמת ולא משאירה פורט תלוי', async () => {
    const first = runOAuthFlow('github')
    const firstRejected = expect(first).rejects.toThrow('התחיל חיבור חדש')
    await waitForBrowser()
    openedUrl = ''

    const second = runOAuthFlow('github')
    await firstRejected

    const params = await waitForBrowser()
    cancelOAuthFlow('סיום בדיקה')
    await expect(second).rejects.toThrow('סיום בדיקה')
    expect(params.get('provider')).toBe('github')
  })
})
