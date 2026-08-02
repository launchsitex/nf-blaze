/**
 * הנפקת מפתח רישיון חתום — זהה בפורמט ל-`scripts/license.cjs`:
 *   NFB1.<base64url(payload)>.<base64url(ed25519 signature)>
 * קלט החתימה: "NFB1.<payloadB64>" ב-UTF-8.
 *
 * המפתח הפרטי מגיע ממשתנה הסביבה LICENSE_PRIVATE_KEY (סוד של הפרויקט)
 * ולעולם אינו נשלח לדפדפן. הפונקציה דורשת משתמש מחובר.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const PREFIX = 'NFB1'

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

/** PEM (pkcs8) → ArrayBuffer לייבוא ל-WebCrypto */
function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const raw = atob(b64)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf.buffer
}

async function signEd25519(input: string): Promise<Uint8Array> {
  const pem = Deno.env.get('LICENSE_PRIVATE_KEY')
  if (!pem) throw new Error('חסר הסוד LICENSE_PRIVATE_KEY בפרויקט — ראה README של הפורטל.')
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'Ed25519' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(input))
  return new Uint8Array(sig)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    // רק מנהל מחובר רשאי להנפיק
    const authHeader = req.headers.get('Authorization') ?? ''
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: userData, error: userErr } = await anon.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'נדרשת התחברות.' }, 401)

    const body = (await req.json()) as {
      name?: string
      email?: string
      expiresAt?: string | null
    }
    const name = (body.name ?? '').trim()
    if (!name) return json({ error: 'נדרש שם מלא של הלקוח.' }, 400)

    const expiresAt = body.expiresAt ? String(body.expiresAt).slice(0, 10) : undefined
    if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      return json({ error: 'תאריך תפוגה לא תקין (נדרש YYYY-MM-DD).' }, 400)
    }
    if (expiresAt && expiresAt < new Date().toISOString().slice(0, 10)) {
      return json({ error: 'תאריך התפוגה כבר עבר.' }, 400)
    }

    const email = (body.email ?? '').trim()
    const payload = {
      id: crypto.randomUUID().slice(0, 8),
      n: name,
      ...(email ? { e: email } : {}),
      ...(expiresAt ? { exp: expiresAt } : {}),
      t: 'full',
      iat: new Date().toISOString().slice(0, 10)
    }

    const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)))
    const sig = await signEd25519(`${PREFIX}.${payloadB64}`)
    const licenseKey = `${PREFIX}.${payloadB64}.${b64url(sig)}`

    // הכתיבה ב-service_role — לא ניתן להזריק רשומות מהדפדפן
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data, error } = await admin
      .from('nfb_licenses')
      .insert({
        license_id: payload.id,
        customer_name: name,
        email: email || null,
        expires_at: expiresAt ?? null,
        license_key: licenseKey,
        created_by: userData.user.id
      })
      .select()
      .single()

    if (error) return json({ error: `שמירת הרישיון נכשלה: ${error.message}` }, 500)

    return json({ ok: true, license: data, key: licenseKey })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
