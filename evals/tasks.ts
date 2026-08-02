/**
 * סט משימות הייחוס — מייצג את מה שלקוחות ישראלים באמת מבקשים.
 *
 * הכלל: כל משימה מנוסחת כמו שמשתמש אמיתי היה מנסח, ולכל אחת
 * בדיקות קבלה דטרמיניסטיות. אין כאן שיפוט של מודל.
 */
import {
  fileExists,
  hasHebrewContent,
  listHasAllStates,
  noHardcodedSecrets,
  noPlaceholderText,
  respectsDesignSystem,
  rtlDocument,
  sourceLacks,
  sourceMatches,
  type Check
} from './checks'

export interface EvalTask {
  id: string
  /** הבקשה כפי שמשתמש היה כותב אותה */
  prompt: string
  /** התבנית שממנה מתחילים */
  template: 'web-app' | 'data-app'
  /** מצב עבודה מבוקש */
  workMode: 'BUILD' | 'ASK' | 'PLAN'
  checks: Check[]
}

/** בדיקות שחלות על כל משימת בנייה — הבסיס שאסור לרדת ממנו */
const BASELINE: Check[] = [
  noPlaceholderText,
  hasHebrewContent,
  respectsDesignSystem,
  noHardcodedSecrets,
  rtlDocument
]

export const EVAL_TASKS: EvalTask[] = [
  {
    id: 'landing-lawyer',
    prompt: 'בנה דף נחיתה למשרד עורכי דין בתל אביב — תחומי עיסוק, אודות, טופס יצירת קשר',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, sourceMatches('יש טופס', /<form[\s>]/i)]
  },
  {
    id: 'landing-ev-charging',
    prompt: 'דף נחיתה לחברת התקנת עמדות טעינה לרכב חשמלי, עם הצעת מחיר',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, sourceMatches('יש CTA', /<(?:button|a)[^>]*>/i)]
  },
  {
    id: 'crm-customers',
    prompt: 'צור מערכת CRM לניהול לקוחות: טבלה, חיפוש, וטופס הוספת לקוח',
    template: 'data-app',
    workMode: 'BUILD',
    checks: [...BASELINE, listHasAllStates, sourceMatches('יש חיפוש', /search|חיפוש/i)]
  },
  {
    id: 'inventory-table',
    prompt: 'מסך ניהול מלאי עם טבלת מוצרים, סינון לפי קטגוריה וסימון מלאי נמוך',
    template: 'data-app',
    workMode: 'BUILD',
    checks: [...BASELINE, listHasAllStates]
  },
  {
    id: 'contact-form-validation',
    prompt: 'הוסף טופס יצירת קשר עם ולידציה בעברית — שם, טלפון ישראלי, אימייל',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, sourceMatches('ולידציה', /required|invalid|שגיאה|חובה/i)]
  },
  {
    id: 'dark-mode',
    prompt: 'הוסף מצב כהה עם כפתור החלפה בהדר',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, sourceMatches('מצב כהה', /dark|כהה/i)]
  },
  {
    id: 'pricing-page',
    prompt: 'הוסף עמוד תמחור עם שלוש חבילות והשוואה ביניהן',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE]
  },
  {
    id: 'faq-accordion',
    prompt: 'הוסף אזור שאלות נפוצות עם אקורדיון שנפתח בלחיצה',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, sourceMatches('אינטראקציה', /useState|onClick/)]
  },
  {
    id: 'orders-dashboard',
    prompt: 'לוח בקרה להזמנות: כרטיסי סיכום למעלה וטבלת הזמנות אחרונות',
    template: 'data-app',
    workMode: 'BUILD',
    checks: [...BASELINE, listHasAllStates]
  },
  {
    id: 'appointment-booking',
    prompt: 'מסך קביעת תור: בחירת תאריך, בחירת שעה פנויה ואישור',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, sourceMatches('בחירת תאריך', /date|תאריך/i)]
  },
  {
    id: 'testimonials',
    prompt: 'הוסף אזור המלצות לקוחות עם שלוש המלצות',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE]
  },
  {
    id: 'restaurant-menu',
    prompt: 'בנה תפריט למסעדה עם קטגוריות, מחירים ותמונות',
    template: 'web-app',
    workMode: 'BUILD',
    // אין hot-link לתמונות חיצוניות — נשברות אצל הלקוח
    checks: [...BASELINE, sourceLacks('אין תמונות חיצוניות', /src=["']https?:\/\//)]
  },
  {
    id: 'scoped-edit',
    prompt: 'שנה רק את הכותרת הראשית לטקסט "ברוכים הבאים" — אל תיגע בשום דבר אחר',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, sourceMatches('הכותרת שונתה', /ברוכים הבאים/), fileExists('src/App.tsx')]
  },
  {
    id: 'no-secret-leak',
    prompt: 'חבר את הפרויקט ל-API חיצוני עם מפתח — תעשה את זה נכון מבחינת אבטחה',
    template: 'web-app',
    workMode: 'BUILD',
    checks: [...BASELINE, noHardcodedSecrets, fileExists('.env.example')]
  },
  {
    id: 'ask-mode-no-writes',
    prompt: 'איך בנוי הפרויקט הזה? רק תסביר, אל תשנה כלום',
    template: 'web-app',
    workMode: 'ASK',
    checks: [] // הבדיקה היא שהעץ לא השתנה — נבדק על ידי הרץ עצמו
  },
  {
    id: 'plan-before-build',
    prompt: 'תכנן מערכת ניהול פרויקטים עם משימות, סטטוסים ומשתמשים',
    template: 'data-app',
    workMode: 'PLAN',
    checks: []
  }
]

export function getTask(id: string): EvalTask | undefined {
  return EVAL_TASKS.find((t) => t.id === id)
}

/** משימות שאסור להן לכתוב קבצים */
export function isReadOnlyTask(task: EvalTask): boolean {
  return task.workMode !== 'BUILD'
}
