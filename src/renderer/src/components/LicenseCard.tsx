import { useEffect, useState } from 'react'
import type { LicenseStatus } from '@shared/license'
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react'

interface Props {
  /**
   * מדווח ל-App על כל שינוי בסטטוס הרישיון (הפעלה/הסרה), כדי שהגייט יגיב
   * מיד. בלי זה, הסרת רישיון הייתה מעדכנת רק את הכרטיס והמשתמש היה נשאר
   * בתוך המערכת עד הפעלה מחדש.
   */
  onChange?: (status: LicenseStatus) => void
}

/** כרטיס רישיון בהגדרות — סטטוס, הפעלת מפתח, הסרה */
export default function LicenseCard({ onChange }: Props) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    window.nfblaze.getLicenseStatus().then(setStatus).catch(() => undefined)
  }, [])

  async function activate() {
    if (!key.trim()) {
      setMsg('הדביקו מפתח רישיון')
      return
    }
    setBusy(true)
    try {
      const next = await window.nfblaze.activateLicense(key.trim())
      setStatus(next)
      onChange?.(next)
      setMsg(next.ok ? '✓ הרישיון הופעל' : next.messageHe)
      if (next.ok) setKey('')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('להסיר את הרישיון מהמחשב הזה?')) return
    const next = await window.nfblaze.clearLicense()
    setStatus(next)
    onChange?.(next)
    setMsg('הרישיון הוסר')
  }

  const licensed = status?.state === 'licensed'

  return (
    <div className="settings-card">
      <h3>
        <ShieldCheck size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
        רישיון
      </h3>
      <div className="key-status">
        <span className={`dot ${status?.ok ? 'on' : ''}`} />
        {status?.messageHe || 'טוען…'}
      </div>

      {!licensed && (
        <>
          <p className="desc" style={{ marginTop: 10 }}>
            {'הזינו את מפתח הרישיון שקיבלתם.'}
          </p>
          <div className="folder-row">
            <input
              className="input"
              placeholder="NFB1.…"
              value={key}
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'Consolas, monospace', fontSize: '0.78rem' }}
            />
            <button className="btn btn-primary" disabled={busy} onClick={() => void activate()}>
              <KeyRound size={16} />
              {busy ? 'מפעיל…' : 'הפעל'}
            </button>
          </div>
        </>
      )}

      {licensed && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-danger" onClick={() => void remove()}>
            <Trash2 size={15} />
            הסר רישיון
          </button>
        </div>
      )}

      {msg && (
        <p className="desc" style={{ marginTop: 8 }}>
          {msg}
        </p>
      )}
    </div>
  )
}
