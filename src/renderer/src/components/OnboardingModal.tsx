import { useState } from 'react'
import {
  Bot,
  Eye,
  GitCompare,
  History,
  KeyRound,
  MousePointer2,
  Rocket,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  X
} from 'lucide-react'

interface Props {
  onFinish: () => void
}

interface Step {
  title: string
  items: Array<{ icon: React.ReactNode; title: string; text: string }>
}

const STEPS: Step[] = [
  {
    title: 'ברוכים הבאים ל-NF-Blaze 👋',
    items: [
      {
        icon: <Bot size={20} />,
        title: 'בונים עם AI — בעברית',
        text: 'מתארים בצ׳אט מה רוצים לבנות (אתר, מערכת, CRM) — והסוכן כותב קבצים אמיתיים לתיקייה במחשב שלכם, עם תצוגה חיה שמתעדכנת תוך כדי.'
      },
      {
        icon: <ShieldCheck size={20} />,
        title: 'הכל מקומי ופרטי',
        text: 'אין ענן של NF-Blaze ואין חשבון. הקוד, ההיסטוריה והמפתחות נשארים אצלכם — המידע היחיד שיוצא הוא אל ספק המודל שבחרתם.'
      },
      {
        icon: <KeyRound size={20} />,
        title: 'צעד ראשון: מפתח API',
        text: 'בהגדרות מוסיפים מפתח של OpenAI / Claude / Gemini / OpenRouter — או בוחרים Ollama מקומי בלי מפתח בכלל. המפתחות נשמרים מוצפנים.'
      }
    ]
  },
  {
    title: 'איך עובדים',
    items: [
      {
        icon: <Rocket size={20} />,
        title: 'פרויקט חדש או ייבוא',
        text: '«פרויקט חדש» יוצר שלד רץ מתבנית (React + Tailwind, עברית ו-RTL מובנים) — או מייבאים פרויקט Node קיים וממשיכים לעבוד עליו.'
      },
      {
        icon: <Eye size={20} />,
        title: 'תצוגה חיה + מסך פרויקט',
        text: 'כל שינוי של הסוכן מופיע מיד בתצוגה. במסך הפרויקט מנהלים שם, GitHub (כולל ענף וסנכרון) ו-Supabase למסד נתונים ואימות.'
      },
      {
        icon: <MousePointer2 size={20} />,
        title: 'מסמנים ומדברים',
        text: 'בוחרים אלמנטים ישירות בתצוגה (אפשר כמה בבת אחת) — והסוכן יודע בדיוק על מה אתם מדברים: «תגדיל את הכפתור הזה».'
      }
    ]
  },
  {
    title: 'שליטה מלאה במה שהסוכן עושה',
    items: [
      {
        icon: <GitCompare size={20} />,
        title: 'אישור שינויים + diff',
        text: 'בסוף כל סבב רואים בדיוק מה השתנה (לפני/אחרי לכל קובץ) ומחליטים: לאשר או לבטל. שום דבר לא קורה בלי שתראו.'
      },
      {
        icon: <History size={20} />,
        title: 'היסטוריית גרסאות',
        text: 'כל סבב נשמר כנקודת שחזור — אפשר לחזור לכל שלב קודם של הפרויקט בלחיצה.'
      },
      {
        icon: <Terminal size={20} />,
        title: 'טרמינל, קונסול ובעיות',
        text: 'בפאנל התחתון: טרמינל מאובטח להרצת פקודות npm, קונסול חי של שרת הפיתוח, ורשימת שגיאות עם «תן לסוכן לתקן».'
      }
    ]
  },
  {
    title: 'ולפני שמפרסמים',
    items: [
      {
        icon: <Smartphone size={20} />,
        title: 'בדיקה בכל מכשיר',
        text: 'סרגל המכשירים מציג את האתר כמו ב-iPhone, Galaxy, iPad או מחשב — עם המידות האמיתיות של כל דגם.'
      },
      {
        icon: <ShieldCheck size={20} />,
        title: 'סריקת אבטחה ובדיקות',
        text: 'טאב «אבטחה» סורק סודות בקוד וטבלאות פתוחות; טאב «בדיקות» מריץ את בדיקות הפרויקט. פרסום ל-Vercel נחסם עד שהבעיות מטופלות.'
      },
      {
        icon: <Sparkles size={20} />,
        title: 'טיפ אחרון',
        text: 'שיחה ארוכה? «סכם לצ׳אט חדש» פותח שיחה נקייה עם כל ההקשר. והסוכן יודע גם לחפש ברשת — פשוט בקשו «בדוק ברשת».'
      }
    ]
  }
]

/** מסך הסבר בהפעלה הראשונה — נעלם אחרי סיום ולא חוזר */
export default function OnboardingModal({ onFinish }: Props) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]!
  const last = step === STEPS.length - 1

  return (
    <div className="modal-backdrop" style={{ zIndex: 60 }}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{current.title}</h2>
          <button
            className="btn btn-ghost"
            style={{ marginInlineStart: 'auto' }}
            title="דלג"
            onClick={onFinish}
          >
            <X size={16} />
          </button>
        </div>
        <p className="sub" style={{ marginTop: 2 }}>
          שלב {step + 1} מתוך {STEPS.length}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '16px 0 20px' }}>
          {current.items.map((item) => (
            <div key={item.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                {item.icon}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{item.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  {item.text}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === step ? 22 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: i === step ? 'var(--accent)' : 'var(--border-strong)',
                  transition: 'width 0.2s ease'
                }}
              />
            ))}
          </div>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button className="btn" onClick={() => setStep((s) => s - 1)}>
                הקודם
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => (last ? onFinish() : setStep((s) => s + 1))}
            >
              {last ? 'מתחילים!' : 'הבא'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
