/**
 * אימות מקוון של רישיון NF-Blaze.
 *
 * קלט:  POST { key: "<מפתח רישיון חתום מלא>", nonce: "<אקראי>" }
 * פלט:  { token: "NFBV1.<payloadB64>.<sigB64>" }  — תשובה חתומה ב-Ed25519
 *
 * העיקרון: השרת הוא מקור הזמן והמצב האמין. התשובה חתומה עם המפתח הפרטי,
 * כך ששרת מזויף לא יכול לזייף «תקף», ומזהה ה-nonce מונע שידור חוזר.
 * המפתח הנכנס מאומת חתימתית בשרת לפני כל פנייה למסד — כדי שניחוש מזהים
 * אקראיים לא יחזיר דבר.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const PREFIX = 'NFB1'
const VALIDATION_PREFIX = 'NFBV1'

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

function pemToDer(pem: string, kind: 'PRIVATE' | 'PUBLIC'): ArrayBuffer {
  const b64 = pem
    .replace(new RegExp(`-----BEGIN ${kind} KEY-----`), '')
    .replace(new RegExp(`-----END ${kind} KEY-----`), '')
    .replace(/\s+/g, '')
  const raw = atob(b64)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf.buffer
}

/** אימות חתימת המפתח הנכנס מול המפתח הציבורי */
async function verifyIncomingKey(key: string): Promise<{ id: string } | null> {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) return null
  const pubPem = Deno.env.get('LICENSE_PUBLIC_KEY')
  if (!pubPem) throw new Error('חסר הסוד LICENSE_PUBLIC_KEY בפרויקט.')
  try {
    const pub = await crypto.subtle.importKey(
      'spki',
      pemToDer(pubPem, 'PUBLIC'),
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
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as { id?: string }
    if (!payload?.id) return null
    return { id: payload.id }
  } catch {
    return null
  }
}

/** חתימת תשובת האימות עם המפתח הפרטי */
async function signResponse(payloadB64: string): Promise<string> {
  const pem = Deno.env.get('LICENSE_PRIVATE_KEY')
  if (!pem) throw new Error('חסר הסוד LICENSE_PRIVATE_KEY בפרויקט.')
  const priv = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem, 'PRIVATE'),
    { name: 'Ed25519' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    priv,
    new TextEncoder().encode(`${VALIDATION_PREFIX}.${payloadB64}`)
  )
  return b64url(new Uint8Array(sig))
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { key, nonce, fp, host } = (await req.json()) as {
      key?: string
      nonce?: string
      fp?: string
      host?: string
    }
    if (!key || !nonce) return json({ error: 'נדרשים key ו-nonce.' }, 400)
    if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) {
      return json({ error: 'nonce לא תקין.' }, 400)
    }
    // טביעת אצבע של המכונה — hex בלבד, כדי שלא ייכנס קלט חופשי לטבלה
    const fingerprint =
      typeof fp === 'string' && /^[a-f0-9]{16,64}$/.test(fp) ? fp : null
    const hostHint =
      typeof host === 'string' && host.length > 0 && host.length <= 64 ? host.slice(0, 64) : null
    // כתובת ה-IP נשמרת **לזיהוי בפורטל בלבד** ואינה משמשת לאכיפה: היא
    // מתחלפת בכל אתחול ראוטר ובכל מעבר רשת, והאכיפה נעשית לפי טביעת האצבע.
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      null

    // מאמתים את חתימת המפתח לפני כל פנייה למסד — חוסם ניחוש מזהים
    const verified = await verifyIncomingKey(key)
    if (!verified) return json({ error: 'מפתח לא תקין.' }, 400)

    // מצב הרישיון לפי מקור האמת
    const db = admin()
    const { data, error } = await db
      .from('nfb_licenses')
      .select('license_id, expires_at, revoked')
      .eq('license_id', verified.id)
      .maybeSingle()
    if (error) return json({ error: `שגיאת מסד: ${error.message}` }, 500)

    const serverMs = Date.now()
    const today = new Date(serverMs).toISOString().slice(0, 10)
    const found = Boolean(data)
    const revoked = Boolean(data?.revoked)
    const exp = data?.expires_at ?? undefined
    const serverExpired = Boolean(exp && exp < today)
    const ok = found && !revoked && !serverExpired

    /*
     * ספירת מושבים. נתפס רק כשהרישיון תקף — אחרת מפתח שפג היה ממשיך לתפוס
     * מקום ולחסום את הלקוח אחרי חידוש. אין טביעת אצבע (גרסה ישנה של
     * האפליקציה) → מדלגים, כדי שעדכון השרת לבדו לא ינעל לקוחות קיימים.
     */
    let seat: 'ok' | 'exceeded' | undefined
    let seatsUsed: number | undefined
    let seatsMax: number | undefined
    if (ok && fingerprint) {
      const { data: claim, error: seatErr } = await db
        .rpc('nfb_claim_seat', {
          p_license_id: verified.id,
          p_fingerprint: fingerprint,
          p_hostname: hostHint,
          p_ip: clientIp ? clientIp.slice(0, 45) : null
        })
        .maybeSingle()
      // כשל ברישום המושב אינו נועל לקוח — תקלת מסד היא הבעיה שלנו, לא שלו
      if (!seatErr && claim) {
        const row = claim as { allowed: boolean; used: number; max_seats: number }
        seat = row.allowed ? 'ok' : 'exceeded'
        seatsUsed = row.used
        seatsMax = row.max_seats
      }
    }

    /*
     * מתג החירום: הארכת חלון החסד לכל הלקוחות בלי גרסה חדשה. מוגדר כמשתנה
     * סביבה בפרויקט, נחתם יחד עם התשובה, ונחתך בצד הלקוח ב-30 יום. נועד
     * לתקלה מתמשכת בשרת הזה — בלעדיו כל לקוח היה ננעל תוך 48 שעות ואי אפשר
     * היה לשחררו מרחוק, כי חלון החסד מוטמע בבינארי.
     */
    const graceOverride = Number(Deno.env.get('LICENSE_GRACE_OVERRIDE_MS') ?? '')

    const payload = {
      id: verified.id,
      ok,
      revoked,
      ...(exp ? { exp } : {}),
      ...(seat ? { seat } : {}),
      ...(seatsUsed !== undefined ? { su: seatsUsed } : {}),
      ...(seatsMax !== undefined ? { sm: seatsMax } : {}),
      ...(Number.isFinite(graceOverride) && graceOverride > 0 ? { gr: graceOverride } : {}),
      st: serverMs,
      nc: nonce,
      v: 1
    }
    const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)))
    const sig = await signResponse(payloadB64)

    return json({ token: `${VALIDATION_PREFIX}.${payloadB64}.${sig}` })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
