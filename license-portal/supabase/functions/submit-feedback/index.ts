/**
 * משוב ודיווחי תקלות מהאפליקציה → טבלת `nfb_user_feedback`.
 *
 * קלט:  POST { key?, kind, title, message, name?, email?, appVersion?, os? }
 * פלט:  { ok: true }
 *
 * **שני מסלולים, ובכוונה לא שווים:**
 *
 * 1. **עם `key`** — מפתח רישיון חתום. השרת מאמת את חתימת ה-Ed25519 ומחלץ
 *    ממנה את זהות הלקוח בעצמו (כמו `validate-license`). השם נלקח מ-
 *    `nfb_licenses`, לא ממה שהלקוח שלח. `verified = true`.
 * 2. **בלי `key`** — מי שתקוע בשער הרישיון חייב דרך לבקש רישיון או חידוש.
 *    כאן השם והאימייל **מוצהרים על ידי השולח**, ולכן `verified = false`
 *    והפורטל מציג תגית «לא מאומתת». בלי ההפרדה הזו אפשר היה לכתוב שם של
 *    לקוח קיים והפנייה הייתה נראית זהה לפנייה אמיתית.
 *
 * מגבלת קצב: פנייה אחת לכל 3 שעות **לכל כתובת IP**, נשמרת במסד (לא
 * בזיכרון האינסטנס, שלא שורד מיחזור ולכן חסר ערך לחלון כזה).
 *
 * הכתיבה נעשית ב-`service_role` שעוקף RLS — הטבלה חסומה להכנסה מהדפדפן.
 * הפונקציה נפרסת ללא JWT: היא מזדהה דרך חתימת המפתח, לא דרך התחברות משתמש.
 *
 * ⚠️ כל הכתיבות למסד עוברות דרך `supabase-js` (`.insert` / `.rpc`), שמייצר
 * קריאות PostgREST עם פרמטרים מופרדים. אין כאן בשום מקום בניית SQL ממחרוזות,
 * ולכן טקסט חופשי מהמשתמש נשמר כערך ולא מתפרש כשאילתה.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const PREFIX = 'NFB1'
const CONTACT = 'Info@nf-blaze.dev'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })

/** חייב להתאים ל-CHECK constraint שבטבלה */
const KINDS = ['bug', 'feature', 'feedback', 'question', 'license'] as const
type Kind = (typeof KINDS)[number]

const TITLE_MAX = 120
const MESSAGE_MAX = 4000
const NAME_MAX = 120
const EMAIL_MAX = 200
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * חלון מגבלת הקצב לפי IP — 3 שעות, **לכל השולחים**, כולל בעלי רישיון.
 *
 * ⚠️ שתי השלכות שצריך להכיר: משרד שכל המחשבים בו יוצאים דרך אותה כתובת
 * חולק מכסה אחת, ולקוח ששלח דיווח לא יוכל לשלוח לו המשך במשך 3 שעות.
 * להחרגת בעלי רישיון — לדלג על הבדיקה כש-`verified` קיים.
 */
const THROTTLE_WINDOW_SECONDS = 3 * 60 * 60

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '')
  const raw = atob(b64)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf.buffer
}

/** אימות חתימת המפתח הנכנס — מחזיר את המזהה ואת השם שנחתמו בו */
async function verifyIncomingKey(key: string): Promise<{ id: string; name: string } | null> {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) return null
  const pubPem = Deno.env.get('LICENSE_PUBLIC_KEY')
  if (!pubPem) throw new Error('חסר הסוד LICENSE_PUBLIC_KEY בפרויקט.')
  try {
    const pub = await crypto.subtle.importKey(
      'spki',
      pemToDer(pubPem),
      { name: 'Ed25519' },
      false,
      ['verify']
    )
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      pub,
      b64urlDecode(parts[2]),
      new TextEncoder().encode(`${PREFIX}.${parts[1]}`)
    )
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as {
      id?: string
      n?: string
    }
    if (!payload?.id) return null
    return { id: payload.id, name: (payload.n || '').slice(0, NAME_MAX) }
  } catch {
    return null
  }
}

/** גיבוב כתובת ה-IP — למגבלת קצב מספיק מזהה יציב, בלי לשמור כתובות */
async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get('FEEDBACK_IP_SALT') || 'nfb-feedback-ip-v1'
  const data = new TextEncoder().encode(`${salt}|${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40)
}

function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    ''
  )
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

interface Body {
  key?: string
  kind?: string
  title?: string
  message?: string
  name?: string
  email?: string
  appVersion?: string
  os?: string
  /** מלכודת בוטים — שדה שאדם לעולם לא ממלא */
  website?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = (await req.json()) as Body

    // בוט מילא את השדה המוסתר — עונים «הצלחה» כדי לא ללמד אותו מה נכשל
    if (clean(body.website, 200)) return json({ ok: true })

    const key = clean(body.key, 4000)
    const kind = clean(body.kind, 20)
    const title = clean(body.title, TITLE_MAX)
    const message = clean(body.message, MESSAGE_MAX)
    const declaredName = clean(body.name, NAME_MAX)
    const email = clean(body.email, EMAIL_MAX)
    const appVersion = clean(body.appVersion, 32)
    const os = clean(body.os, 60)

    if (!KINDS.includes(kind as Kind)) return json({ error: 'סוג פנייה לא תקין.' }, 400)
    if (!title) return json({ error: 'נדרשת כותרת לפנייה.' }, 400)
    if (!message) return json({ error: 'נדרש תיאור לפנייה.' }, 400)
    if (email && !EMAIL_RE.test(email)) {
      return json({ error: 'כתובת האימייל אינה תקינה.' }, 400)
    }

    // מפתח שנשלח חייב להיות תקין. מפתח פגום אינו «נופל» לפנייה אנונימית —
    // אחרת אפשר היה לעקוף בכוונה את השיוך על ידי שליחת זבל בשדה.
    let verified: { id: string; name: string } | null = null
    if (key) {
      verified = await verifyIncomingKey(key)
      if (!verified) return json({ error: 'מפתח לא תקין.' }, 400)
    }

    if (!verified) {
      // בלי מפתח אין מאיפה לגזור זהות — שם ואימייל הם חובה, אחרת אין לאן להשיב
      if (!declaredName) return json({ error: 'יש להזין שם מלא.' }, 400)
      if (!email) return json({ error: 'יש להזין אימייל — בלעדיו לא נוכל לחזור אליכם.' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // מגבלת קצב: פנייה אחת לכל 3 שעות לכל כתובת IP — גם למי שיש לו רישיון.
    // כשאין כותרת IP בכלל (פרוקסי חריג) לא חוסמים: שאר האימותים עדיין בתוקף,
    // ועדיף לקבל פנייה כפולה נדירה מאשר להשתיק פונה לגיטימי.
    const ip = clientIp(req)
    if (ip) {
      const { data: allowed, error: throttleErr } = await admin.rpc(
        'nfb_feedback_throttle_check',
        { p_ip_hash: await hashIp(ip), p_window_seconds: THROTTLE_WINDOW_SECONDS }
      )
      // כשל בבדיקת המגבלה **חוסם**, בניגוד לספירת המושבים: שם fail-open מגן
      // על לקוח משלם, וכאן הוא היה פותח ערוץ בלי שום הגנה.
      if (throttleErr) {
        console.error('[submit-feedback] throttle', throttleErr.message)
        return json({ error: `לא הצלחנו לשלוח כרגע. נסו שוב, או כתבו ל-${CONTACT}.` }, 503)
      }
      if (allowed === false) {
        return json(
          { error: 'כבר נשלחה פנייה מהמחשב הזה. אפשר לשלוח פנייה נוספת בעוד 3 שעות.' },
          429
        )
      }
    }

    /*
     * השם מהמסד גובר על השם שבתוך המפתח: אם שינינו שם לקוח בפורטל אחרי
     * ההנפקה, הפנייה תופיע תחת השם המעודכן. המפתח נשאר גיבוי למקרה שהרשומה
     * נמחקה. בפנייה לא מאומתת — מה שהשולח הצהיר, ותו לא.
     */
    let customerName = declaredName || 'לא ידוע'
    if (verified) {
      const { data: lic } = await admin
        .from('nfb_licenses')
        .select('customer_name')
        .eq('license_id', verified.id)
        .maybeSingle()
      customerName = (lic?.customer_name || verified.name || '').trim() || 'לא ידוע'
    }

    const { error } = await admin.from('nfb_user_feedback').insert({
      license_id: verified?.id ?? null,
      customer_name: customerName,
      verified: Boolean(verified),
      email: email || null,
      kind,
      title,
      message,
      app_version: appVersion || null,
      os: os || null
    })

    if (error) {
      // לא בולעים שגיאה של שירות חיצוני — נרשמת בשלמותה ביומן, אבל למשתמש
      // חוזרת הודעה ידידותית בלי פרטים פנימיים
      console.error('[submit-feedback] insert', error.message, error.details)
      return json({ error: `שמירת הפנייה נכשלה. אפשר לכתוב ישירות ל-${CONTACT}.` }, 502)
    }

    return json({ ok: true })
  } catch (err) {
    console.error('[submit-feedback]', err)
    return json({ error: `אירעה שגיאה. אפשר לכתוב ישירות ל-${CONTACT}.` }, 500)
  }
})
