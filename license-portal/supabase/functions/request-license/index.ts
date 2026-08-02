/**
 * טופס «בקשת רישיון» מדף הנחיתה nf-blaze.dev → טבלת `nfb_license_requests`.
 *
 * הבקשות נשמרות במסד ומנוהלות בפורטל (טאב «בקשות רישיונות»), ולא נשלחות
 * במייל — כך הן לא הולכות לאיבוד בתיבה ויש להן סטטוס אישור/דחייה.
 *
 * הכתיבה נעשית ב-`service_role` שעוקף RLS, ולכן הטבלה חסומה להכנסה
 * מהדפדפן. הפונקציה נפרסת ללא JWT (הטופס ציבורי) ומגינה על עצמה:
 * מלכודת בוטים, אימות קלט, הגבלת אורך, ומגבלת קצב לפי IP.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

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

/**
 * מגבלת קצב פשוטה בזיכרון. אינסטנס של Edge Function חי מספיק זמן כדי
 * לחסום הצפה בסיסית; זו לא הגנה מוחלטת אלא בלם ראשוני.
 */
const recent = new Map<string, number[]>()
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 3

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  recent.set(ip, hits)
  if (recent.size > 5000) recent.clear() // גדר זיכרון
  return hits.length > MAX_PER_WINDOW
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** חייב להתאים ל-CHECK constraint שבטבלה */
const SOURCES = ['facebook', 'google', 'referral', 'other'] as const
type Source = (typeof SOURCES)[number]

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

interface RequestBody {
  name?: string
  email?: string
  source?: string
  message?: string
  /** מלכודת בוטים — שדה מוסתר שאדם לעולם לא ממלא */
  website?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = (await req.json()) as RequestBody

    // בוט מילא את השדה המוסתר — עונים «הצלחה» כדי לא ללמד אותו מה נכשל
    if (clean(body.website, 200)) return json({ ok: true })

    const name = clean(body.name, 120)
    const email = clean(body.email, 200)
    const source = clean(body.source, 20)
    const message = clean(body.message, 2000)

    // כל השדות חובה — נאכף גם כאן ולא רק בדפדפן
    if (!name) return json({ error: 'נא למלא שם מלא.' }, 400)
    if (!EMAIL_RE.test(email)) return json({ error: 'כתובת האימייל אינה תקינה.' }, 400)
    if (!SOURCES.includes(source as Source)) {
      return json({ error: 'נא לבחור איך הגעת אלינו.' }, 400)
    }
    if (!message) return json({ error: 'נא לספר בקצרה מה תרצה לבנות.' }, 400)

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown'
    if (rateLimited(ip)) {
      return json({ error: 'נשלחו יותר מדי בקשות. נסה שוב בעוד כמה דקות.' }, 429)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { error } = await admin.from('nfb_license_requests').insert({
      full_name: name,
      email,
      source,
      message
    })

    if (error) {
      // לא בולעים שגיאה של שירות חיצוני — נרשמת בשלמותה ביומן,
      // אבל למשתמש חוזרת הודעה ידידותית בלי פרטים פנימיים
      console.error('[request-license] insert', error.message, error.details)
      return json({ error: `שמירת הבקשה נכשלה. אפשר לכתוב ישירות ל-${CONTACT}.` }, 502)
    }

    return json({ ok: true })
  } catch (err) {
    console.error('[request-license]', err)
    return json({ error: `אירעה שגיאה. אפשר לכתוב ישירות ל-${CONTACT}.` }, 500)
  }
})
