/**
 * משוב ודיווח באגים מהאפליקציה → פורטל הרישיונות.
 *
 * **עם רישיון** — נשלח **המפתח החתום**, והשרת מחלץ ממנו את זהות בעל הרישיון
 * בעצמו (בדיוק כמו באימות המקוון). הלקוח אינו מצהיר על שמו, ולכן אי אפשר
 * לשלוח משוב בשם לקוח אחר. הפנייה מסומנת בפורטל כ«מאומתת».
 *
 * **בלי רישיון** — מותר לשלוח, בעיקר כדי לבקש או לחדש רישיון: מי שתקוע
 * בשער הרישיון אין לו שום דרך אחרת לפנות מתוך המערכת. אז השם והאימייל
 * מוצהרים על ידי השולח, הפנייה מסומנת כ«לא מאומתת», והשרת אוכף מגבלת קצב
 * לפי כתובת IP.
 *
 * גרסת המערכת ומערכת ההפעלה נשלחות כדי שאפשר יהיה לטפל בדיווח בלי לחזור
 * ללקוח בשאלות. לא נשלח שום מידע על הפרויקטים, הקוד או המפתחות שלו.
 */
import { app } from 'electron'
import { release } from 'os'
import {
  FEEDBACK_EMAIL_MAX,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_NAME_MAX,
  FEEDBACK_TITLE_MAX,
  validateFeedbackInput,
  type FeedbackSubmitInput,
  type FeedbackSubmitResult
} from '../../shared/types'
import { getStoredLicenseKey, LICENSE_ANON_KEY, LICENSE_FUNCTIONS_BASE } from './license'

const SUBMIT_URL = `${LICENSE_FUNCTIONS_BASE}/submit-feedback`
const SUBMIT_TIMEOUT_MS = 12_000
const SUPPORT_EMAIL = 'Info@nf-blaze.dev'

/** תיאור קצר של מערכת ההפעלה — לשחזור תקלה, בלי מידע מזהה */
function osLabel(): string {
  const name =
    process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'darwin'
        ? 'macOS'
        : process.platform
  try {
    return `${name} ${release()}`.slice(0, 60)
  } catch {
    return name
  }
}

/**
 * שולח משוב אחד. לעולם אינו זורק שגיאה גולמית של ספק חיצוני החוצה —
 * המשתמש מקבל הודעה שאומרת מה לעשות עכשיו, עם דרך חלופית ליצור קשר.
 */
export async function submitFeedback(
  input: FeedbackSubmitInput
): Promise<FeedbackSubmitResult> {
  // מפתח שמור = יש רישיון. גם מפתח שפג נשלח: הוא עדיין מזהה את הלקוח מול
  // השרת, וזה בדיוק המצב שבו הוא צריך לבקש חידוש.
  const key = getStoredLicenseKey()

  const invalid = validateFeedbackInput(input, Boolean(key))
  if (invalid) return { ok: false, messageHe: invalid }

  const title = input.title.trim().slice(0, FEEDBACK_TITLE_MAX)
  const message = input.message.trim().slice(0, FEEDBACK_MESSAGE_MAX)
  const name = (input.name || '').trim().slice(0, FEEDBACK_NAME_MAX)
  const email = (input.email || '').trim().slice(0, FEEDBACK_EMAIL_MAX)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)
  try {
    const resp = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: LICENSE_ANON_KEY },
      body: JSON.stringify({
        // בלי רישיון נשלח מחרוזת ריקה — השרת מטפל בזה כפנייה לא מאומתת
        key: key ? key.trim() : '',
        kind: input.kind,
        title,
        message,
        name,
        email,
        appVersion: app.getVersion(),
        os: osLabel()
      }),
      signal: controller.signal
    })

    if (resp.ok) {
      return { ok: true, messageHe: 'הפנייה נשלחה. תודה — היא הגיעה אלינו.' }
    }

    // הודעת השרת מוצגת כשהיא ידידותית (אימות קלט / מגבלת קצב); אחרת מנוסחת
    // כאן. אין להעביר ללקוח קוד סטטוס או פרטים פנימיים.
    let serverMessage = ''
    try {
      const body = (await resp.json()) as { error?: string }
      if (typeof body?.error === 'string') serverMessage = body.error.slice(0, 300)
    } catch {
      /* גוף לא-JSON — נשארים עם ההודעה הגנרית */
    }
    if (resp.status === 429) {
      return {
        ok: false,
        messageHe:
          serverMessage || 'כבר נשלחה פנייה מהמחשב הזה לאחרונה. אפשר לשלוח שוב בעוד כמה שעות.'
      }
    }
    if (resp.status === 400 && serverMessage) {
      return { ok: false, messageHe: serverMessage }
    }
    return {
      ok: false,
      messageHe: `שליחת הפנייה לא הצליחה. אפשר לכתוב לנו ישירות ל-${SUPPORT_EMAIL}.`
    }
  } catch {
    return {
      ok: false,
      messageHe: `אין כרגע חיבור לשרת. נסו שוב, או כתבו לנו ל-${SUPPORT_EMAIL}.`
    }
  } finally {
    clearTimeout(timer)
  }
}
