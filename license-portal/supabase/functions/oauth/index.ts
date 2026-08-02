/**
 * NF-Blaze OAuth broker — «Authorize NF-Blaze» לחיבור GitHub / Supabase / Vercel.
 *
 * למה בכלל צריך שרת: אפליקציית דסקטופ לא יכולה להחזיק `client_secret`
 * (כל מי שמפרק את החבילה משיג אותו), וספקי OAuth דורשים כתובת חזרה קבועה
 * ורשומה — לא פורט אקראי במחשב של המשתמש. הפונקציה הזו היא הכתובת הרשומה,
 * והיא היחידה שמחזיקה את הסודות.
 *
 * מסלולים:
 *   GET  /start?provider&challenge&port&sid   → 302 לדף האישור של הספק
 *   GET  /callback?code&state                 → 302 חזרה ל-127.0.0.1 עם צופן
 *   POST /exchange { blob, verifier }         → { access_token, ... }
 *   POST /refresh  { provider, refresh_token }→ { access_token, ... }
 *
 * הטוקן לעולם אינו עובר בכתובת שהדפדפן רואה. ה-callback מחזיר צופן
 * שהמפתח שלו נגזר מ-`challenge`, ורק האפליקציה — שמחזיקה את ה-`verifier`
 * המקורי — יכולה לבקש את פענוחו ב-`/exchange` דרך HTTPS.
 *
 * חסר-מצב לחלוטין: אין טבלה ואין ניקוי רשומות. כל ההקשר נוסע מוצפן
 * וחתום (AES-GCM) בתוך פרמטר ה-`state` של הספק.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const STATE_TTL_MS = 10 * 60 * 1000
const BLOB_TTL_MS = 5 * 60 * 1000

type Provider = 'github' | 'supabase' | 'vercel'

interface ProviderConfig {
  label: string
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  /** איך נשלחים פרטי הלקוח לנקודת הטוקן */
  clientAuth: 'basic' | 'body'
  scope?: string
  /** פרמטרים נוספים לדף האישור */
  authorizeExtra?: Record<string, string>
  /**
   * האם לשלוח `redirect_uri` בדף האישור. אצל Vercel הכתובת מוגדרת
   * בקונסולת האינטגרציות ואינה מתקבלת כפרמטר.
   */
  authorizeSendsRedirect: boolean
  supportsRefresh: boolean
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    }
  })

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`חסר הסוד ${name} בפרויקט Supabase.`)
  return v
}

function redirectUri(): string {
  // חייבת להיות זהה בדיוק לכתובת הרשומה אצל הספק
  return Deno.env.get('OAUTH_REDIRECT_URI') || `${env('SUPABASE_URL')}/functions/v1/oauth/callback`
}

function providerConfig(p: Provider): ProviderConfig {
  switch (p) {
    case 'github':
      return {
        label: 'GitHub',
        clientId: env('GITHUB_CLIENT_ID'),
        clientSecret: env('GITHUB_CLIENT_SECRET'),
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientAuth: 'body',
        // `repo` — יצירת ריפו פרטי ודחיפת קוד; `workflow` — כדי שדחיפה של
        // קובץ ב-.github/workflows לא תיפסל; `read:user` — שם המשתמש בממשק.
        scope: 'repo read:user workflow',
        authorizeSendsRedirect: true,
        supportsRefresh: false
      }
    case 'supabase':
      return {
        label: 'Supabase',
        clientId: env('SB_OAUTH_CLIENT_ID'),
        clientSecret: env('SB_OAUTH_CLIENT_SECRET'),
        authorizeUrl: 'https://api.supabase.com/v1/oauth/authorize',
        tokenUrl: 'https://api.supabase.com/v1/oauth/token',
        clientAuth: 'basic',
        // ההרשאות עצמן מוגדרות על האפליקציה בדשבורד; `scope=all` הוא מה
        // שמופיע בדוגמה הרשמית של Supabase ואינו מרחיב מעבר להגדרת האפליקציה.
        scope: 'all',
        authorizeExtra: { response_type: 'code' },
        authorizeSendsRedirect: true,
        supportsRefresh: true
      }
    case 'vercel':
      return {
        label: 'Vercel',
        clientId: env('VERCEL_CLIENT_ID'),
        clientSecret: env('VERCEL_CLIENT_SECRET'),
        // Vercel מתקינה אינטגרציה במקום «דף אישור» רגיל. «Sign in with
        // Vercel» אינו מתאים כאן — הוא נותן זהות בלבד, בלי הרשאות ליצירת
        // פרויקטים ודיפלויים. כתובת החזרה מוגדרת בקונסולת האינטגרציות.
        authorizeUrl: `https://vercel.com/integrations/${env('VERCEL_INTEGRATION_SLUG')}/new`,
        tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
        clientAuth: 'body',
        authorizeSendsRedirect: false,
        supportsRefresh: false
      }
  }
}

function isProvider(v: unknown): v is Provider {
  return v === 'github' || v === 'supabase' || v === 'vercel'
}

/* ---------- הצפנה ---------- */

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** סוד הבסיס של ה-broker — 32 בתים ב-base64 */
function stateSecret(): Uint8Array {
  const raw = env('OAUTH_STATE_KEY')
  const bytes = b64urlDecode(raw)
  if (bytes.length < 32) throw new Error('OAUTH_STATE_KEY חייב להיות 32 בתים לפחות (base64).')
  return bytes
}

/**
 * מפתח AES-GCM. עבור ה-state — הסוד עצמו; עבור ה-blob — הסוד יחד עם
 * ה-challenge, כך שרק מי שמחזיק את ה-verifier המקורי יכול לבקש פענוח.
 */
async function aesKey(salt?: string): Promise<CryptoKey> {
  const base = stateSecret()
  const material = salt
    ? new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new Uint8Array([...base, ...new TextEncoder().encode(`|${salt}`)])
        )
      )
    : base.slice(0, 32)
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt'
  ])
}

async function seal(value: unknown, salt?: string): Promise<string> {
  const key = await aesKey(salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(value))
    )
  )
  return b64url(new Uint8Array([...iv, ...ct]))
}

async function open<T>(token: string, salt?: string): Promise<T | null> {
  try {
    const raw = b64urlDecode(token)
    if (raw.length < 13) return null
    const key = await aesKey(salt)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      key,
      raw.slice(12)
    )
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}

/* ---------- דפי שגיאה ---------- */

function errorPage(title: string, detail: string, status = 400): Response {
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>NF-Blaze</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#e6e8ee;
      font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
 .card{text-align:center;padding:48px 56px;border-radius:18px;background:#141821;
       border:1px solid #232838;max-width:480px}
 .badge{width:64px;height:64px;border-radius:50%;margin:0 auto 22px;display:grid;place-items:center;
        font-size:32px;font-weight:700;background:#ef444420;color:#ef4444;border:2px solid #ef4444}
 h1{font-size:22px;margin:0 0 10px} p{margin:0;color:#9aa3b8;line-height:1.75;font-size:15px}
 .brand{margin-top:26px;font-size:13px;color:#5b6478;letter-spacing:.04em}
</style></head>
<body><div class="card"><div class="badge">!</div><h1>${title}</h1><p>${detail}</p>
<div class="brand">NF-Blaze</div></div></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ---------- state / blob ---------- */

interface StatePayload {
  p: Provider
  port: number
  ch: string
  sid: string
  exp: number
}

interface BlobPayload {
  p: Provider
  t: TokenResult
  exp: number
}

interface TokenResult {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  extra?: Record<string, unknown>
}

/* ---------- החלפת קוד בטוקן ---------- */

async function exchangeCode(
  cfg: ProviderConfig,
  params: Record<string, string>
): Promise<TokenResult> {
  const body = new URLSearchParams(params)
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  }
  if (cfg.clientAuth === 'basic') {
    headers.Authorization = `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`
  } else {
    body.set('client_id', cfg.clientId)
    body.set('client_secret', cfg.clientSecret)
  }

  const resp = await fetch(cfg.tokenUrl, { method: 'POST', headers, body })
  const text = await resp.text()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    // GitHub מחזיר form-encoded אם לא ביקשו JSON במפורש
    parsed = Object.fromEntries(new URLSearchParams(text))
  }

  if (!resp.ok || parsed.error) {
    const detail =
      (parsed.error_description as string) || (parsed.error as string) || text.slice(0, 200)
    throw new Error(`${cfg.label} דחה את הבקשה: ${detail}`)
  }
  const access = parsed.access_token
  if (typeof access !== 'string' || !access) {
    throw new Error(`${cfg.label} לא החזיר טוקן.`)
  }

  // שדות ייחודיים לספק שכדאי לשמור (למשל הצוות של Vercel)
  const extra: Record<string, unknown> = {}
  for (const k of ['team_id', 'installation_id', 'user_id', 'configuration_id']) {
    if (parsed[k] !== undefined && parsed[k] !== null) extra[k] = parsed[k]
  }

  return {
    access_token: access,
    refresh_token: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined,
    expires_in: typeof parsed.expires_in === 'number' ? parsed.expires_in : undefined,
    scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
    extra: Object.keys(extra).length ? extra : undefined
  }
}

/* ---------- מסלולים ---------- */

async function handleStart(url: URL): Promise<Response> {
  const provider = url.searchParams.get('provider')
  const challenge = url.searchParams.get('challenge') || ''
  const sid = url.searchParams.get('sid') || ''
  const port = Number(url.searchParams.get('port'))

  if (!isProvider(provider)) return errorPage('בקשה לא תקינה', 'ספק לא מוכר.')
  if (challenge.length < 20 || sid.length < 10) {
    return errorPage('בקשה לא תקינה', 'חסרים פרטי אימות מהאפליקציה.')
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return errorPage('בקשה לא תקינה', 'פורט מקומי לא תקין.')
  }

  let cfg: ProviderConfig
  try {
    cfg = providerConfig(provider)
  } catch (e) {
    return errorPage(
      'החיבור עוד לא הופעל',
      `${escapeHtml(e instanceof Error ? e.message : String(e))}<br>` +
        'פנה למנהל המערכת של NF-Blaze.',
      503
    )
  }

  const state = await seal({
    p: provider,
    port,
    ch: challenge,
    sid,
    exp: Date.now() + STATE_TTL_MS
  } satisfies StatePayload)

  const target = new URL(cfg.authorizeUrl)
  target.searchParams.set('state', state)
  if (cfg.authorizeSendsRedirect) {
    target.searchParams.set('client_id', cfg.clientId)
    target.searchParams.set('redirect_uri', redirectUri())
  }
  if (cfg.scope) target.searchParams.set('scope', cfg.scope)
  for (const [k, v] of Object.entries(cfg.authorizeExtra || {})) target.searchParams.set(k, v)

  return Response.redirect(target.toString(), 302)
}

async function handleCallback(url: URL): Promise<Response> {
  const stateRaw = url.searchParams.get('state') || ''
  const state = await open<StatePayload>(stateRaw)
  if (!state || !isProvider(state.p)) {
    return errorPage('בקשה לא מזוהה', 'פרטי החיבור פגומים או שפג תוקפם. התחל את החיבור מחדש.')
  }
  if (Date.now() > state.exp) {
    return errorPage('פג תוקף החיבור', 'עברו יותר מ-10 דקות מאז שהתחלת. התחל מחדש מהאפליקציה.')
  }

  const back = new URL(`http://127.0.0.1:${state.port}/callback`)
  back.searchParams.set('sid', state.sid)

  // המשתמש לחץ «ביטול» או שהספק סירב
  const providerError = url.searchParams.get('error')
  if (providerError) {
    const desc = url.searchParams.get('error_description') || providerError
    back.searchParams.set(
      'error',
      providerError === 'access_denied' ? 'האישור בוטל.' : `הספק החזיר שגיאה: ${desc}`
    )
    return Response.redirect(back.toString(), 302)
  }

  const code = url.searchParams.get('code')
  if (!code) {
    back.searchParams.set('error', 'הספק לא החזיר קוד אישור.')
    return Response.redirect(back.toString(), 302)
  }

  try {
    const cfg = providerConfig(state.p)
    const token = await exchangeCode(cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri()
    })

    // Vercel מעבירה את הצוות בכתובת החזרה ולא בתשובת הטוקן
    const teamId = url.searchParams.get('teamId')
    if (teamId) token.extra = { ...(token.extra || {}), team_id: teamId }
    const configurationId = url.searchParams.get('configurationId')
    if (configurationId) {
      // מזהה ההתקנה נשמר — התקנה חוזרת מגיעה עם אותו מזהה, והוא לא ממוחזר
      token.extra = { ...(token.extra || {}), configuration_id: configurationId }
    }

    const blob = await seal(
      { p: state.p, t: token, exp: Date.now() + BLOB_TTL_MS } satisfies BlobPayload,
      state.ch
    )
    back.searchParams.set('blob', blob)
    return Response.redirect(back.toString(), 302)
  } catch (e) {
    back.searchParams.set('error', e instanceof Error ? e.message : String(e))
    return Response.redirect(back.toString(), 302)
  }
}

async function handleExchange(req: Request): Promise<Response> {
  const { blob, verifier } = (await req.json()) as { blob?: string; verifier?: string }
  if (!blob || !verifier) return json({ error: 'חסרים blob או verifier.' }, 400)

  // ה-challenge נגזר מה-verifier — כך מוכיחה האפליקציה שהיא זו שהתחילה
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  )
  const payload = await open<BlobPayload>(blob, challenge)
  if (!payload) return json({ error: 'הצופן לא תואם את הבקשה. התחל את החיבור מחדש.' }, 400)
  if (Date.now() > payload.exp) return json({ error: 'פג תוקף החיבור. התחל מחדש.' }, 400)

  return json(payload.t)
}

async function handleRefresh(req: Request): Promise<Response> {
  const body = (await req.json()) as { provider?: string; refresh_token?: string }
  if (!isProvider(body.provider)) return json({ error: 'ספק לא מוכר.' }, 400)
  if (!body.refresh_token) return json({ error: 'חסר refresh_token.' }, 400)

  const cfg = providerConfig(body.provider)
  if (!cfg.supportsRefresh) return json({ error: `${cfg.label} אינו תומך בחידוש טוקן.` }, 400)

  try {
    const token = await exchangeCode(cfg, {
      grant_type: 'refresh_token',
      refresh_token: body.refresh_token
    })
    return json(token)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })

  const url = new URL(req.url)
  // הנתיב מגיע כ-/functions/v1/oauth/<route> או /oauth/<route> לפי הסביבה
  const route = url.pathname.replace(/\/+$/, '').split('/').pop() || ''

  try {
    if (req.method === 'GET' && route === 'start') return await handleStart(url)
    if (req.method === 'GET' && route === 'callback') return await handleCallback(url)
    if (req.method === 'POST' && route === 'exchange') return await handleExchange(req)
    if (req.method === 'POST' && route === 'refresh') return await handleRefresh(req)
    if (req.method === 'GET' && route === 'health') return json({ ok: true })
    return json({ error: 'מסלול לא קיים.' }, 404)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (req.method === 'GET') return errorPage('שגיאה בשרת החיבורים', escapeHtml(message), 500)
    return json({ error: message }, 500)
  }
})
