import { useState } from 'react'
import type { UpdateState } from '@shared/version'
import { Download, Loader2 } from 'lucide-react'

/**
 * חיווי עדכון בסרגל העליון — כשיש גרסה חדשה שאינה חוסמת כרגע.
 *
 * שני המצבים שהוא נועד להם:
 * 1. **עדכון לא-חובה** (`mandatory: false` במניפסט). קודם לכן הוא היה
 *    **בלתי נראה לחלוטין**: `UpdateGate` היה הממשק היחיד שדיבר על עדכונים
 *    והוא נטען רק בעדכון חובה, כך שההורדה וההתקנה קרו בשקט מוחלט והמשתמש
 *    לא ידע שקיימת גרסה חדשה.
 * 2. **עדכון חובה שנדחה** ב«אחר כך» — המשתמש ממשיך לעבוד, אבל רואה כל
 *    הזמן שהעדכון ממתין ויכול להתקין אותו ברגע שנוח לו.
 */
interface Props {
  state: UpdateState
}

/** «עוד 7 שעות» / «עוד 40 דקות» — עדיף על שעה מדויקת שדורשת חישוב מהמשתמש */
function untilLabel(untilMs?: number): string {
  if (!untilMs) return ''
  const left = untilMs - Date.now()
  if (left <= 0) return ''
  // עיגול ולא קיצוץ: 6.9 שעות שהוצגו כ«6» נראו כאילו נגנבה שעה
  const hours = left / 3_600_000
  if (hours >= 1) return `· נדחה לעוד ${Math.round(hours)} שע׳`
  return `· נדחה לעוד ${Math.max(1, Math.round(left / 60_000))} דק׳`
}

export default function UpdateBanner({ state }: Props) {
  const [busy, setBusy] = useState(false)

  // כשהעדכון חוסם, המסך המלא כבר מוצג — אין טעם בחיווי כפול
  if (state.required) return null
  if (state.stage === 'idle' || !state.newVersion) return null

  const ready = state.stage === 'ready'
  const downloading = state.stage === 'downloading'
  const percent = typeof state.percent === 'number' ? Math.round(state.percent) : 0

  async function install(): Promise<void> {
    setBusy(true)
    try {
      await window.nfblaze.updateInstall()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className={`update-pill${ready ? ' ready' : ''}`}
      disabled={!ready || busy}
      title={
        ready
          ? 'התקנת העדכון תפעיל את NF-Blaze מחדש. הפרויקטים וההגדרות נשמרים.'
          : 'העדכון יורד ברקע'
      }
      onClick={() => ready && void install()}
    >
      {ready ? <Download size={14} /> : <Loader2 size={14} className="spin" />}
      {ready ? (
        <>
          גרסה {state.newVersion} מוכנה — עדכן עכשיו
          <span className="update-pill-sub">{untilLabel(state.snoozedUntil)}</span>
        </>
      ) : (
        <>
          מוריד עדכון {state.newVersion}
          {downloading ? ` · ${percent}%` : '…'}
        </>
      )}
    </button>
  )
}
