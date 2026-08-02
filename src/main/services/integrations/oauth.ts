/**
 * חיבור חשבונות בלחיצה אחת — «Authorize NF-Blaze» במקום הדבקת טוקן.
 *
 * הזרימה (RFC 8252 — OAuth לאפליקציות מקומיות, עם broker):
 *
 *   1. האפליקציה מייצרת `verifier` אקראי ושולחת רק את ה-`challenge` שלו
 *      (SHA-256) ל-broker, יחד עם הפורט המקומי שהיא מאזינה עליו.
 *   2. הדפדפן של המשתמש נפתח בדף האישור של הספק. הספק חוזר ל-broker.
 *   3. ה-broker (ורק הוא) מחזיק את ה-client_secret ומחליף את הקוד בטוקן,
 *      מצפין אותו במפתח שנגזר מה-challenge, ומחזיר את הצופן לפורט המקומי.
 *   4. האפליקציה שולחת ל-broker את ה-`verifier` דרך HTTPS ומקבלת את הטוקן.
 *
 * למה ככה ולא redirect ישיר לפורט מקומי: ספקי OAuth דורשים כתובת חזרה
 * רשומה וקבועה, ו-client_secret לא יכול לשבת בתוך אפליקציית דסקטופ —
 * כל מי שמפרק את החבילה היה משיג אותו. הטוקן עצמו לעולם אינו עובר
 * בכתובת שהדפדפן רואה (רק צופן חד-פעמי שחסר לו המפתח).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { shell } from 'electron'
import type { AddressInfo } from 'net'

export type OAuthProvider = 'github' | 'supabase' | 'vercel'

export interface OAuthTokens {
  provider: OAuthProvider
  accessToken: string
  refreshToken?: string
  /** מתי הטוקן פג (epoch ms). ללא ערך = לא פג. */
  expiresAt?: number
  scope?: string
  /** שדות ייחודיים לספק (למשל teamId של Vercel) */
  extra?: Record<string, unknown>
}

const DEFAULT_BROKER = 'https://ilsidpixxkfwowsnkntg.supabase.co/functions/v1/oauth'
const BROKER_ANON_KEY = 'sb_publishable_6TuWWlf5vZBoNqaW5naH3w_FHUj8HSr'

/** ברירת מחדל ניתנת לעקיפה — נוח לבדיקות מול broker מקומי */
export function brokerBase(): string {
  const raw = process.env.NF_BLAZE_OAUTH_BROKER?.trim() || DEFAULT_BROKER
  return raw.replace(/\/+$/, '')
}

const FLOW_TIMEOUT_MS = 5 * 60 * 1000
const EXCHANGE_TIMEOUT_MS = 20_000

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  github: 'GitHub',
  supabase: 'Supabase',
  vercel: 'Vercel'
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** השוואה עמידה לתזמון — ה-sid מגיע מבקשת רשת */
function sameSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8')
  const bufB = Buffer.from(b, 'utf-8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * דף שהמשתמש רואה בדפדפן בסוף התהליך. עברית RTL בצבעי המערכת,
 * כי זה חלק מהמוצר — לא מסך שגיאה של שרת.
 */
function resultPage(kind: 'ok' | 'error', title: string, detail: string): string {
  const accent = kind === 'ok' ? '#22c55e' : '#ef4444'
  const icon = kind === 'ok' ? '✓' : '!'
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NF-Blaze</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0b0d12; color: #e6e8ee;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  .card {
    text-align: center; padding: 48px 56px; border-radius: 18px;
    background: #141821; border: 1px solid #232838; max-width: 460px;
  }
  .badge {
    width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 22px;
    display: grid; place-items: center; font-size: 32px; font-weight: 700;
    background: ${accent}1f; color: ${accent}; border: 2px solid ${accent};
  }
  h1 { font-size: 22px; margin: 0 0 10px; }
  p { margin: 0; color: #9aa3b8; line-height: 1.75; font-size: 15px; }
  .brand { margin-top: 26px; font-size: 13px; color: #5b6478; letter-spacing: .04em; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">${icon}</div>
    <h1>${title}</h1>
    <p>${detail}</p>
    <div class="brand">NF-Blaze</div>
  </div>
</body>
</html>`
}

/** מונע DNS rebinding: רק בקשות שפנו ממש ללולאה המקומית */
function isLoopbackHost(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host || '').trim()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

interface PendingFlow {
  server: Server
  abort: (reason: string) => void
}

/** זרימה אחת בכל רגע — לחיצה חוזרת מבטלת את הקודמת ולא תוקעת פורט פתוח */
let pending: PendingFlow | null = null

export function cancelOAuthFlow(reason = 'החיבור בוטל'): void {
  pending?.abort(reason)
}

/**
 * מריץ את מסך האישור של הספק ומחזיר את הטוקן.
 * זורק שגיאה מתורגמת אם המשתמש ביטל, אם עבר הזמן, או אם ה-broker דחה.
 */
export async function runOAuthFlow(provider: OAuthProvider): Promise<OAuthTokens> {
  cancelOAuthFlow('התחיל חיבור חדש')

  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const sid = b64url(randomBytes(16))

  const server = createServer()
  let settled = false

  const blobPromise = new Promise<string>((resolve, reject) => {
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      pending = null
      clearTimeout(timer)
      server.close()
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('פג הזמן לאישור החיבור (5 דקות). נסה שוב.')))
    }, FLOW_TIMEOUT_MS)
    timer.unref?.()

    pending = {
      server,
      abort: (reason: string) => finish(() => reject(new Error(reason)))
    }

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const port = (server.address() as AddressInfo | null)?.port ?? 0
      if (!isLoopbackHost(req, port)) {
        res.writeHead(400).end()
        return
      }

      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }

      const gotSid = url.searchParams.get('sid') || ''
      if (!sameSecret(gotSid, sid)) {
        // לא הבקשה שלנו — לא מדליפים כלום ולא מפילים את ההמתנה
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(resultPage('error', 'בקשה לא מזוהה', 'הפנייה הזו אינה שייכת לחיבור הפעיל.'))
        return
      }

      const err = url.searchParams.get('error')
      const blob = url.searchParams.get('blob')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (err) {
        res.end(
          resultPage('error', 'החיבור לא הושלם', escapeHtml(err) + '<br>אפשר לסגור את החלון.')
        )
        finish(() => reject(new Error(err)))
        return
      }
      if (!blob) {
        res.end(resultPage('error', 'החיבור לא הושלם', 'התשובה מהשרת הייתה חסרה.'))
        finish(() => reject(new Error('תשובת ה-broker הייתה חסרה.')))
        return
      }

      res.end(
        resultPage(
          'ok',
          `${PROVIDER_LABELS[provider]} חובר בהצלחה`,
          'אפשר לסגור את החלון ולחזור ל-NF-Blaze.'
        )
      )
      finish(() => resolve(blob))
    })

    server.on('error', (e) => {
      finish(() => reject(new Error(`לא הצלחתי לפתוח מאזין מקומי לחיבור: ${e.message}`)))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const port = (server.address() as AddressInfo).port
  const startUrl = new URL(`${brokerBase()}/start`)
  startUrl.searchParams.set('provider', provider)
  startUrl.searchParams.set('challenge', challenge)
  startUrl.searchParams.set('port', String(port))
  startUrl.searchParams.set('sid', sid)
  startUrl.searchParams.set('apikey', BROKER_ANON_KEY)

  await shell.openExternal(startUrl.toString())

  const blob = await blobPromise
  return exchangeBlob(provider, blob, verifier)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function brokerPost<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(`${brokerBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: BROKER_ANON_KEY },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (e) {
    throw new Error(
      `לא הצלחתי להגיע לשרת החיבורים של NF-Blaze: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e }
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await resp.text()
  if (!resp.ok) {
    let msg = text.slice(0, 300)
    try {
      msg = (JSON.parse(text) as { error?: string }).error || msg
    } catch {
      /* טקסט גולמי */
    }
    throw new Error(msg)
  }
  return JSON.parse(text) as T
}

interface BrokerTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  extra?: Record<string, unknown>
}

function toTokens(provider: OAuthProvider, r: BrokerTokenResponse): OAuthTokens {
  if (!r?.access_token) throw new Error('ה-broker לא החזיר טוקן.')
  return {
    provider,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    // שוליים של דקה כדי לא להשתמש בטוקן שפג בדיוק בזמן הבקשה
    expiresAt: r.expires_in ? Date.now() + (r.expires_in - 60) * 1000 : undefined,
    scope: r.scope,
    extra: r.extra
  }
}

async function exchangeBlob(
  provider: OAuthProvider,
  blob: string,
  verifier: string
): Promise<OAuthTokens> {
  const r = await brokerPost<BrokerTokenResponse>('/exchange', { blob, verifier })
  return toTokens(provider, r)
}

/** חידוש טוקן שפג (Supabase). ה-client_secret נשאר ב-broker. */
export async function refreshOAuthToken(
  provider: OAuthProvider,
  refreshToken: string
): Promise<OAuthTokens> {
  const r = await brokerPost<BrokerTokenResponse>('/refresh', {
    provider,
    refresh_token: refreshToken
  })
  const tokens = toTokens(provider, r)
  // ספקים מסוימים לא מחזירים refresh_token חדש — משמרים את הקיים
  return { ...tokens, refreshToken: tokens.refreshToken || refreshToken }
}
