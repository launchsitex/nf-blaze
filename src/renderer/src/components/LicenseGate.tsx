import { useState } from 'react'
import type { LicenseStatus } from '@shared/license'
import { KeyRound, ShieldCheck, Wifi, RefreshCw, Laptop } from 'lucide-react'

interface Props {
  status: LicenseStatus
  onActivated: (status: LicenseStatus) => void
}

/** מסך חסימה כשאין רישיון תקף — הזנת מפתח */
export default function LicenseGate({ status, onActivated }: Props) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function activate() {
    const value = key.trim()
    if (!value) {
      setError('הדביקו את מפתח הרישיון')
      return
    }
    setBusy(true)
    setError('')
    try {
      const next = await window.nfblaze.activateLicense(value)
      if (next.ok) {
        onActivated(next)
      } else {
        setError(next.messageHe)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // מצב «נדרש אימות מקוון» — למשתמש יש מפתח תקף, חסר רק חיבור לרשת.
  // מסך ייעודי עם «בדוק שוב» במקום הזנת מפתח (שהייתה מבלבלת כאן).
  if (status.state === 'needs_revalidation') {
    return <RevalidateGate status={status} onActivated={onActivated} />
  }

  // המפתח תקף אבל כבר בשימוש במספר המחשבים המרבי. הזנת מפתח מחדש לא תעזור
  // כאן, ולכן מסך נפרד שמסביר מה לעשות בפועל.
  if (status.state === 'seat_exceeded') {
    return <SeatGate status={status} onActivated={onActivated} />
  }

  return (
    <div className="preview-empty" style={{ padding: 40 }}>
      <div
        className="settings-card"
        style={{ maxWidth: 560, width: '100%', textAlign: 'start', margin: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <ShieldCheck size={22} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>נדרש מפתח רישיון</h2>
        </div>
        <p className="desc" style={{ marginTop: 0 }}>
          {status.messageHe}
        </p>

        <div className="field" style={{ marginTop: 16 }}>
          <label>מפתח רישיון</label>
          <textarea
            className="input"
            rows={3}
            placeholder="NFB1.…"
            value={key}
            autoFocus
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void activate()
            }}
            style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'Consolas, monospace', fontSize: '0.78rem', resize: 'vertical' }}
          />
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 8 }} role="alert">
            {error}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ marginTop: 14, width: '100%', justifyContent: 'center', padding: '10px 0' }}
          disabled={busy}
          onClick={() => void activate()}
        >
          <KeyRound size={16} />
          {busy ? 'מפעיל…' : 'הפעל רישיון'}
        </button>

        <p className="desc" style={{ marginTop: 14, fontSize: '0.78rem' }}>
          אין לכם מפתח? פנו אלינו לקבלת רישיון. המפתח נשמר מוצפן במחשב ומשויך למחשב הזה בלבד.
        </p>
      </div>
    </div>
  )
}

/** מסך «נדרש אימות מקוון» — יש מפתח תקף, צריך רק חיבור לרשת */
function RevalidateGate({ status, onActivated }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function retry() {
    setBusy(true)
    setError('')
    try {
      const next = await window.nfblaze.revalidateLicense()
      if (next.ok) {
        onActivated(next)
      } else if (next.state === 'needs_revalidation') {
        setError('עדיין אין חיבור לשרת. ודאו שהמחשב מחובר לאינטרנט ונסו שוב.')
      } else {
        setError(next.messageHe)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="preview-empty" style={{ padding: 40 }}>
      <div
        className="settings-card"
        style={{ maxWidth: 560, width: '100%', textAlign: 'start', margin: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Wifi size={22} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>נדרש אימות מקוון</h2>
        </div>
        <p className="desc" style={{ marginTop: 0 }}>
          {status.messageHe} המפתח נשאר שמור — אין צורך להזין אותו מחדש.
        </p>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 8 }} role="alert">
            {error}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ marginTop: 14, width: '100%', justifyContent: 'center', padding: '10px 0' }}
          disabled={busy}
          onClick={() => void retry()}
        >
          <RefreshCw size={16} />
          {busy ? 'בודק…' : 'בדוק שוב'}
        </button>
      </div>
    </div>
  )
}

/** מסך «חריגה ממספר המחשבים» — המפתח תקף אך כבר תפוס במכסה המלאה */
function SeatGate({ status, onActivated }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function retry() {
    setBusy(true)
    setError('')
    try {
      const next = await window.nfblaze.revalidateLicense()
      if (next.ok) onActivated(next)
      else if (next.state === 'seat_exceeded') {
        setError('המחשב הזה עדיין אינו משויך לרישיון. אחרי שחרור מחשב אחר, לחצו שוב.')
      } else setError(next.messageHe)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="preview-empty" style={{ padding: 40 }}>
      <div
        className="settings-card"
        style={{ maxWidth: 560, width: '100%', textAlign: 'start', margin: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Laptop size={22} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>הרישיון בשימוש במחשבים אחרים</h2>
        </div>
        <p className="desc" style={{ marginTop: 0 }}>
          {status.messageHe}
        </p>
        {status.seatsMax !== undefined && (
          <p className="desc" style={{ marginTop: 8, fontSize: '0.8rem' }}>
            בשימוש: {status.seatsUsed ?? status.seatsMax} מתוך {status.seatsMax}.
          </p>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 8 }} role="alert">
            {error}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ marginTop: 14, width: '100%', justifyContent: 'center', padding: '10px 0' }}
          disabled={busy}
          onClick={() => void retry()}
        >
          <RefreshCw size={16} />
          {busy ? 'בודק…' : 'בדוק שוב'}
        </button>
      </div>
    </div>
  )
}
