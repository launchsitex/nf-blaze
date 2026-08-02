import { useState } from 'react'
import type { UpdateState } from '@shared/version'
import { Clock, Download, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'

/**
 * שער עדכון חובה — חוסם את כל המערכת עד להתקנת הגרסה החדשה.
 *
 * זהו UI בלבד; הגבול האמיתי הוא שומר ה-IPC בתהליך הראשי, שחוסם כל ערוץ
 * מלבד אלה שדרושים להורדה ולהתקנה. אין כאן כפתור סגירה בכוונה.
 *
 * ההודעות למשתמש נשארות ברמת התועלת ולא חושפות פרטים על המערכת —
 * גם כשמשהו נכשל.
 */
interface Props {
  state: UpdateState
  /** נקרא אחרי דחייה מוצלחת, כדי שהמסך ייסגר מיד */
  onSnoozed?: (next: UpdateState) => void
}

export default function UpdateGate({ state, onSnoozed }: Props) {
  const [busy, setBusy] = useState(false)

  const percent = typeof state.percent === 'number' ? Math.min(100, Math.max(0, state.percent)) : 0
  const ready = state.stage === 'ready'
  const failed = state.stage === 'error'

  async function install(): Promise<void> {
    setBusy(true)
    try {
      await window.nfblaze.updateInstall()
    } finally {
      // בהצלחה האפליקציה נסגרת ממילא; בכישלון משחררים את הכפתור
      setBusy(false)
    }
  }

  async function retry(): Promise<void> {
    setBusy(true)
    try {
      await window.nfblaze.updateRetry()
    } finally {
      setBusy(false)
    }
  }

  /** «אחר כך» — פותח את המערכת ל-12 שעות כדי לא לקטוע עבודה באמצע */
  async function snooze(): Promise<void> {
    setBusy(true)
    try {
      onSnoozed?.(await window.nfblaze.updateSnooze())
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className="preview-empty" style={{ padding: 40 }} role="dialog" aria-modal="true">
      <div
        className="settings-card"
        style={{ maxWidth: 520, width: '100%', textAlign: 'start', margin: 0 }}
      >
        <div
          style={{
            width: 62,
            height: 62,
            margin: '0 auto 20px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 18,
            background: 'var(--accent-soft)',
            border: '1px solid rgba(232,160,74,0.3)',
            color: 'var(--accent-hot)'
          }}
        >
          {ready ? <ShieldCheck size={30} /> : <Download size={30} />}
        </div>

        <h2 style={{ textAlign: 'center', marginBottom: 8 }}>
          {ready ? 'העדכון מוכן להתקנה' : 'יש גרסה חדשה'}
        </h2>

        <p className="desc" style={{ textAlign: 'center', marginBottom: 22 }}>
          {state.newVersion && (
            <>
              גרסה <strong style={{ color: 'var(--accent-hot)' }}>{state.newVersion}</strong>{' '}
              זמינה
              {state.currentVersion ? ` (מותקנת אצלך ${state.currentVersion})` : ''}.
              <br />
            </>
          )}
          כדי להמשיך לעבוד יש לעדכן את המערכת.
        </p>

        {!ready && !failed && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.07)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${percent}%`,
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, var(--accent-hot), var(--accent))',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                justifyContent: 'center',
                marginTop: 10,
                color: 'var(--text-muted)',
                fontSize: '0.88rem'
              }}
            >
              <Loader2 size={15} className="spin" />
              מוריד את העדכון… {percent}%
            </div>
          </div>
        )}

        {failed && state.message && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid rgba(232,93,93,0.4)',
              background: 'rgba(232,93,93,0.08)',
              color: '#f09a9a',
              fontSize: '0.9rem',
              marginBottom: 18
            }}
            role="alert"
          >
            {state.message}
          </div>
        )}

        <div style={{ display: 'grid', gap: 10 }}>
          {/* בכישלון «נסה שוב» הוא הפעולה — כפתור התקנה מושבת רק מבלבל */}
          {!failed && (
            <button
              className="btn btn-primary"
              style={{ justifyContent: 'center', minHeight: 48 }}
              disabled={!ready || busy}
              onClick={() => void install()}
            >
              {busy ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
              {ready ? 'עדכן גרסה והפעל מחדש' : 'ממתין לסיום ההורדה…'}
            </button>
          )}

          {failed && (
            <button
              className="btn btn-primary"
              style={{ justifyContent: 'center', minHeight: 48 }}
              disabled={busy}
              onClick={() => void retry()}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              נסה שוב
            </button>
          )}

          {state.offerManual && (
            <button
              className="btn btn-ghost"
              style={{ justifyContent: 'center' }}
              onClick={() => void window.nfblaze.openExternal(state.downloadUrl)}
            >
              <ExternalLink size={16} />
              הורדה ידנית מהאתר
            </button>
          )}

          {/*
           * «אחר כך» — מי שנמצא באמצע בנייה של פרויקט לא אמור לאבד אותה
           * בגלל עדכון. ההורדה ממשיכה ברקע, ולכן הכפתור זמין בכל שלב.
           */}
          {state.canSnooze && (
            <button
              className="btn btn-ghost"
              style={{ justifyContent: 'center' }}
              disabled={busy}
              onClick={() => void snooze()}
            >
              <Clock size={16} />
              אני באמצע עבודה — הזכר לי בעוד 12 שעות
            </button>
          )}
        </div>

        <p
          className="desc"
          style={{ textAlign: 'center', marginTop: 18, fontSize: '0.82rem' }}
        >
          העדכון מתקין את הגרסה החדשה ומפעיל את NF-Blaze מחדש. הפרויקטים וההגדרות שלך נשמרים.
        </p>
      </div>
    </div>
  )
}
