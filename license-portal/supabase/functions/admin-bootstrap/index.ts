/**
 * הקמת חשבון המנהל היחיד של הפורטל.
 *
 * GET  → { canRegister: boolean }  — האם עדיין אין מנהל
 * POST → יוצר את המנהל הראשון. אחרי שנוצר אחד, כל קריאה נוספת נדחית ב-403
 *        לצמיתות. כך «ההרשמה נעלמת» ואי אפשר לפתוח חשבון שני.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * האם ההרשמה כבר נוצלה?
 *
 * מקור האמת הוא הדגל ב-nfb_portal_state ולא טבלת המשתמשים: אילו הסתמכנו על
 * auth.users, מחיקת חשבון המנהל הייתה פותחת את ההרשמה מחדש לכל מי שמגיע לאתר.
 */
async function isBootstrapped(): Promise<boolean> {
  const { data, error } = await admin()
    .from('nfb_portal_state')
    .select('admin_bootstrapped')
    .eq('id', true)
    .single()
  if (error) throw new Error(error.message)
  return data.admin_bootstrapped === true
}

/**
 * מנסה «לתפוס» את ההרשמה היחידה. מחזיר true רק למי שהצליח לשנות את הדגל
 * מ-false ל-true — כך שגם שתי בקשות במקביל לא ייצרו שני מנהלים.
 */
async function claimBootstrap(): Promise<boolean> {
  const { data, error } = await admin()
    .from('nfb_portal_state')
    .update({ admin_bootstrapped: true, bootstrapped_at: new Date().toISOString() })
    .eq('id', true)
    .eq('admin_bootstrapped', false)
    .select('id')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

/** שחרור הנעילה אם יצירת המשתמש נכשלה — אחרת היינו ננעלים בלי חשבון כלל */
async function releaseBootstrap(): Promise<void> {
  await admin()
    .from('nfb_portal_state')
    .update({ admin_bootstrapped: false, bootstrapped_at: null })
    .eq('id', true)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    if (req.method === 'GET') {
      return json({ canRegister: !(await isBootstrapped()) })
    }

    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    const { email, password } = (await req.json()) as { email?: string; password?: string }
    if (!email || !password) return json({ error: 'נדרשים אימייל וסיסמה.' }, 400)
    if (password.length < 10) return json({ error: 'הסיסמה חייבת להיות באורך 10 תווים לפחות.' }, 400)

    // תופסים את הנעילה לפני יצירת המשתמש — כך אין חלון לשתי הרשמות במקביל
    if (!(await claimBootstrap())) {
      return json({ error: 'ההרשמה סגורה — כבר קיים חשבון מנהל.' }, 403)
    }

    const { error } = await admin().auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })
    if (error) {
      await releaseBootstrap()
      return json({ error: error.message }, 400)
    }

    return json({ ok: true })
  } catch (err) {
    // לא בולעים שגיאות של השירות — מציגים את ההודעה המקורית
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
