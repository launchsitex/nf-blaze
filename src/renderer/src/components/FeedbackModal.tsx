import { useEffect, useState } from 'react'
import { Check, Loader2, MessageSquare, Send, X } from 'lucide-react'
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_NAME_MAX,
  FEEDBACK_TITLE_MAX,
  validateFeedbackInput,
  type FeedbackKind
} from '@shared/types'
import type { LicenseStatus } from '@shared/license'

interface Props {
  appVersion: string
  license: LicenseStatus | null
  onClose: () => void
}

/**
 * משוב ודיווח תקלות.
 *
 * **עם רישיון:** השיוך נעשה בשרת מתוך המפתח החתום — ולכן אין כאן שדה שם,
 * והמשתמש רואה מראש מה בדיוק נשלח יחד עם הטקסט שכתב.
 *
 * **בלי רישיון:** אפשר לשלוח (בעיקר «בקשת/חידוש רישיון» — מי שתקוע בשער
 * הרישיון אין לו דרך אחרת לפנות). אז שם ואימייל הם שדות חובה, כי אין מאיפה
 * לגזור אותם ובלעדיהם אין לאן להשיב.
 */
export default function FeedbackModal({ appVersion, license, onClose }: Props) {
  const licensed = Boolean(license?.ok)
  // בלי רישיון ברירת המחדל היא בקשת רישיון — זו הסיבה העיקרית שהוא כאן
  const [kind, setKind] = useState<FeedbackKind>(licensed ? 'bug' : 'license')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const selected = FEEDBACK_KINDS.find((k) => k.id === kind)!
  const draft = {
    kind,
    title,
    message,
    name: name.trim() || undefined,
    email: email.trim() || undefined
  }
  // אותה ולידציה שרצה בתהליך הראשי ובשרת — מקור אחד, בלי כפילות
  const canSend = !busy && validateFeedbackInput(draft, licensed) === null

  async function send(): Promise<void> {
    const invalid = validateFeedbackInput(draft, licensed)
    if (invalid) {
      setError(invalid)
      return
    }
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await window.nfblaze.submitFeedback({
        kind,
        title: title.trim(),
        message: message.trim(),
        name: name.trim() || undefined,
        email: email.trim() || undefined
      })
      if (res.ok) setSent(true)
      else setError(res.messageHe)
    } catch (err) {
      // לא בולעים שגיאה — המשתמש צריך לדעת שהפנייה לא נשלחה
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal"
          style={{ maxWidth: 460, textAlign: 'center' }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="feedback-sent-mark">
            <Check size={26} />
          </div>
          <h2 style={{ marginTop: 16 }}>הפנייה נשלחה</h2>
          <p className="sub">
            {kind === 'license'
              ? 'תודה. נחזור אליכם לכתובת שהשארתם.'
              : 'תודה. הפנייה הגיעה אלינו עם השם והגרסה, ואנחנו עוברים על כל אחת מהן.'}
          </p>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}
            onClick={onClose}
          >
            סגור
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal feedback-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
      >
        <div className="feedback-head">
          <div className="feedback-head-mark">
            <MessageSquare size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 id="feedback-title" style={{ margin: 0 }}>
              משוב ודיווח
            </h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              מה שתכתבו מגיע ישירות אלינו ונקרא.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label="סגור">
            <X size={18} />
          </button>
        </div>

        <div className="feedback-body">
          <div className="field">
            <label>סוג הפנייה</label>
            <div className="feedback-kinds" role="radiogroup" aria-label="סוג הפנייה">
              {FEEDBACK_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.id}
                  className={`feedback-kind${kind === k.id ? ' active' : ''}`}
                  onClick={() => setKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="feedback-hint">{selected.hint}</p>
          </div>

          <div className="field">
            <label htmlFor="feedback-subject">כותרת</label>
            <input
              id="feedback-subject"
              className="input"
              value={title}
              maxLength={FEEDBACK_TITLE_MAX}
              placeholder="בשורה אחת — במה מדובר"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="feedback-message">פירוט</label>
            <textarea
              id="feedback-message"
              className="textarea feedback-message"
              value={message}
              maxLength={FEEDBACK_MESSAGE_MAX}
              placeholder={
                kind === 'bug'
                  ? 'מה עשיתם, מה ציפיתם שיקרה, ומה קרה בפועל'
                  : 'ככל שתפרטו יותר, כך נוכל לעשות עם זה יותר'
              }
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="feedback-count">
              {message.length} / {FEEDBACK_MESSAGE_MAX}
            </div>
          </div>

          {!licensed && (
            <div className="field">
              <label htmlFor="feedback-name">שם מלא</label>
              <input
                id="feedback-name"
                className="input"
                value={name}
                maxLength={FEEDBACK_NAME_MAX}
                placeholder="השם שאליו יונפק הרישיון"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="feedback-email">
              {licensed ? 'אימייל לחזרה (לא חובה)' : 'אימייל לחזרה'}
            </label>
            <input
              id="feedback-email"
              className="input"
              type="email"
              dir="ltr"
              value={email}
              placeholder="name@example.com"
              onChange={(e) => setEmail(e.target.value)}
              style={{ textAlign: 'start' }}
            />
          </div>

          <div className="feedback-meta">
            {licensed ? (
              <>
                נשלח יחד עם הפנייה: <strong>{license?.name || 'בעל הרישיון'}</strong>
                {appVersion ? ` · גרסה ${appVersion}` : ''} · מערכת ההפעלה שלכם.
              </>
            ) : (
              <>
                אין רישיון פעיל במחשב הזה, ולכן הפנייה תגיע עם השם והאימייל שתזינו
                {appVersion ? ` · גרסה ${appVersion}` : ''} · מערכת ההפעלה שלכם.
                <br />
                אפשר לשלוח פנייה אחת כל 3 שעות.
              </>
            )}
            <br />
            לא נשלח מידע על הפרויקטים, הקוד או המפתחות שלכם.
          </div>

          {error && <div className="feedback-error">{error}</div>}
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" disabled={!canSend} onClick={() => void send()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            {busy ? 'שולח…' : 'שליחה'}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
