import type { LicenseStatus } from '@shared/license'
import { AlarmClock, X } from 'lucide-react'

interface Props {
  status: LicenseStatus
  onClose: () => void
}

/**
 * פופ-אפ אזהרה כשנשאר יום אחד לרישיון. מעוצב לפי שפת העיצוב של המערכת
 * (modal-backdrop / modal / accent). אינו חוסם את השימוש — רק מיידע.
 */
export default function LicenseExpiryModal({ status, onClose }: Props) {
  return (
    <div className="modal-backdrop" style={{ zIndex: 70 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 11,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <AlarmClock size={22} />
          </div>
          <button
            className="btn btn-ghost"
            style={{ marginInlineStart: 'auto' }}
            title="סגור"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <h2 style={{ margin: '10px 0 6px', fontSize: '1.2rem' }}>הרישיון פג בקרוב</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.6, fontSize: '0.9rem' }}>
          נותרו{' '}
          <strong style={{ color: 'var(--text)' }}>
            כ-{Math.max(1, Math.round(status.hoursLeft ?? 12))} שעות
          </strong>{' '}
          לתוקף הרישיון של NF-Blaze
          {status.expiresAt ? ` (פג ב-${status.expiresAt})` : ''}. כשהתוקף יסתיים
          המערכת תבקש מפתח רישיון חדש — כדי להמשיך לעבוד בלי הפרעה, כדאי לחדש את
          הרישיון כבר עכשיו.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 20 }}>
          <button
            className="btn btn-primary"
            style={{ padding: '9px 22px' }}
            onClick={onClose}
            autoFocus
          >
            הבנתי
          </button>
        </div>
      </div>
    </div>
  )
}
