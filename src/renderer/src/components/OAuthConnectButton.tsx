import { useState } from 'react'
import { Database, Github, Loader2, Triangle } from 'lucide-react'
import type { OAuthConnectResult, OAuthProviderId } from '@shared/types'

/**
 * «התחבר עם GitHub / Supabase / Vercel».
 *
 * לחיצה פותחת את דף האישור של הספק בדפדפן ומחזירה את החשבון שחובר.
 * המשתמש לא מעתיק טוקנים — זו הדרך שבה כל כלי מקצועי עושה את זה.
 */

const BRAND: Record<OAuthProviderId, { label: string; color: string; icon: typeof Github }> = {
  github: { label: 'GitHub', color: '#8b95a5', icon: Github },
  supabase: { label: 'Supabase', color: '#3ecf8e', icon: Database },
  vercel: { label: 'Vercel', color: '#c9d1d9', icon: Triangle }
}

interface Props {
  provider: OAuthProviderId
  /** טקסט חלופי לכפתור (ברירת מחדל: «התחבר עם X») */
  label?: string
  disabled?: boolean
  /** מותר להחזיר Promise — הכפתור נשאר במצב עבודה עד שהטיפול מסתיים */
  onConnected: (result: OAuthConnectResult) => void | Promise<void>
  onError: (message: string) => void
}

export default function OAuthConnectButton({
  provider,
  label,
  disabled,
  onConnected,
  onError
}: Props) {
  const [busy, setBusy] = useState(false)
  const brand = BRAND[provider]
  const Icon = brand.icon

  async function connect(): Promise<void> {
    setBusy(true)
    onError('')
    try {
      const res = await window.nfblaze.connectOAuth(provider)
      await onConnected(res)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        className="btn"
        disabled={busy || disabled}
        onClick={() => void connect()}
        style={{
          width: '100%',
          justifyContent: 'center',
          gap: 10,
          padding: '12px 18px',
          fontSize: '0.95rem',
          fontWeight: 600,
          borderColor: busy ? 'var(--border)' : `${brand.color}66`,
          background: busy ? undefined : `${brand.color}14`,
          color: busy ? undefined : brand.color
        }}
      >
        {busy ? <Loader2 size={18} className="spin" /> : <Icon size={18} />}
        {busy ? 'ממתין לאישור בדפדפן…' : label || `התחבר עם ${brand.label}`}
      </button>

      {busy ? (
        <p className="desc" style={{ marginTop: 8, textAlign: 'center' }}>
          אשר את הגישה בחלון הדפדפן שנפתח, וחזור לכאן.{' '}
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: '0.78rem' }}
            onClick={() => void window.nfblaze.cancelOAuth()}
          >
            ביטול
          </button>
        </p>
      ) : (
        <p className="desc" style={{ marginTop: 8, textAlign: 'center' }}>
          ייפתח דף אישור של {brand.label} בדפדפן. לא צריך להעתיק מפתחות.
        </p>
      )}
    </div>
  )
}
