import { useEffect, useState } from 'react'
import {
  Bot,
  ExternalLink,
  Eye,
  FolderOpen,
  GitCompare,
  Info,
  MessageSquare,
  Plug,
  Rocket,
  ShieldCheck,
  Terminal,
  Wrench,
  X
} from 'lucide-react'
import { HELP_SHORTCUTS, HELP_TOPICS, type HelpIcon } from '@shared/help'
import type { LicenseStatus } from '@shared/license'

interface Props {
  appVersion: string
  license: LicenseStatus | null
  /** מעבר ישיר לטופס המשוב מתוך מרכז העזרה */
  onOpenFeedback: () => void
  onClose: () => void
}

/** קישורים חיצוניים — נפתחים בדפדפן של המשתמש, לא בתוך המערכת */
const LINKS: Array<{ label: string; url: string }> = [
  { label: 'אתר NF-Blaze', url: 'https://nf-blaze.dev/' },
  { label: 'מדריכי הפקת מפתח API', url: 'https://nf-blaze.dev/guides/' },
  { label: 'תנאי שימוש', url: 'https://nf-blaze.dev/terms.html' },
  { label: 'מדיניות פרטיות', url: 'https://nf-blaze.dev/privacy.html' },
  { label: 'הצהרת נגישות', url: 'https://nf-blaze.dev/accessibility.html' }
]

const ICONS: Record<HelpIcon, React.ReactNode> = {
  rocket: <Rocket size={16} />,
  bot: <Bot size={16} />,
  eye: <Eye size={16} />,
  diff: <GitCompare size={16} />,
  terminal: <Terminal size={16} />,
  plug: <Plug size={16} />,
  shield: <ShieldCheck size={16} />,
  wrench: <Wrench size={16} />
}

const ABOUT_ID = 'about'

/** תיאור מצב הרישיון בשורה אחת, בלי לחזור על הודעת השגיאה המלאה */
function licenseLine(license: LicenseStatus | null): string {
  if (!license) return 'טוען…'
  if (!license.ok) return license.messageHe
  if (!license.expiresAt) return 'פעיל · ללא הגבלת זמן'
  const days = license.daysLeft
  return typeof days === 'number'
    ? `פעיל · בתוקף עד ${license.expiresAt} (עוד ${days} ימים)`
    : `פעיל · בתוקף עד ${license.expiresAt}`
}

/**
 * מרכז העזרה — «אודות» עם פרטי הגרסה והרישיון, ומדריך שימוש מלא.
 * התוכן מגיע מ-`src/shared/help.ts`, שהוא הגרסה שמיועדת ללקוחות.
 */
export default function HelpModal({ appVersion, license, onOpenFeedback, onClose }: Props) {
  const [active, setActive] = useState<string>(ABOUT_ID)
  const [dataPath, setDataPath] = useState('')

  useEffect(() => {
    window.nfblaze
      .getDataPath()
      .then(setDataPath)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const topic = HELP_TOPICS.find((t) => t.id === active)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal help-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <header className="help-head">
          <div className="help-head-mark">
            <Info size={20} />
          </div>
          <div className="help-head-text">
            <h2 id="help-title">מרכז העזרה</h2>
            <p className="sub">כל מה שצריך כדי להפיק את המרב מ-NF-Blaze</p>
          </div>
          <span className="badge help-version">גרסה {appVersion || '—'}</span>
          <button className="btn btn-ghost" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </header>

        <div className="help-body">
          <nav className="help-nav" aria-label="נושאי העזרה">
            <button
              type="button"
              className={`help-nav-item${active === ABOUT_ID ? ' active' : ''}`}
              onClick={() => setActive(ABOUT_ID)}
            >
              <Info size={16} />
              אודות המערכת
            </button>
            <div className="help-nav-sep">מדריך שימוש</div>
            {HELP_TOPICS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`help-nav-item${active === t.id ? ' active' : ''}`}
                onClick={() => setActive(t.id)}
              >
                {ICONS[t.icon]}
                {t.title}
              </button>
            ))}
          </nav>

          <div className="help-content">
            {active === ABOUT_ID ? (
              <>
                <h3 className="help-content-title">אודות המערכת</h3>
                <p className="help-intro">
                  סביבת פיתוח עם AI שרצה על המחשב שלכם. הפרויקטים, ההיסטוריה והמפתחות נשארים
                  מקומיים.
                </p>

                <dl className="help-facts">
                  <div>
                    <dt>גרסה מותקנת</dt>
                    <dd>{appVersion || '—'}</dd>
                  </div>
                  <div>
                    <dt>רישיון</dt>
                    <dd>{licenseLine(license)}</dd>
                  </div>
                  {license?.name && (
                    <div>
                      <dt>רשום על שם</dt>
                      <dd>{license.name}</dd>
                    </div>
                  )}
                  <div>
                    <dt>עדכוני גרסה</dt>
                    <dd>מתעדכן אוטומטית — המערכת מודיעה כשיוצאת גרסה חדשה</dd>
                  </div>
                </dl>

                {dataPath && (
                  <div className="help-datapath">
                    <div>
                      <div className="help-datapath-label">תיקיית הנתונים של המערכת</div>
                      <code>{dataPath}</code>
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void window.nfblaze.openPath(dataPath)}
                    >
                      <FolderOpen size={15} />
                      פתח
                    </button>
                  </div>
                )}

                <h4 className="help-sub-title">קיצורי מקלדת</h4>
                <ul className="help-shortcuts">
                  {HELP_SHORTCUTS.map((s) => (
                    <li key={s.keys}>
                      <kbd>{s.keys}</kbd>
                      <span>{s.what}</span>
                    </li>
                  ))}
                </ul>

                <h4 className="help-sub-title">קישורים</h4>
                <div className="help-links">
                  {LINKS.map((l) => (
                    <button
                      key={l.url}
                      className="help-link"
                      onClick={() => void window.nfblaze.openExternal(l.url)}
                    >
                      <ExternalLink size={14} />
                      {l.label}
                    </button>
                  ))}
                </div>
              </>
            ) : topic ? (
              <>
                <h3 className="help-content-title">{topic.title}</h3>
                <p className="help-intro">{topic.intro}</p>
                <div className="help-items">
                  {topic.items.map((item) => (
                    <article key={item.title} className="help-item">
                      <h4>{item.title}</h4>
                      <p>{item.text}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <footer className="help-foot">
          <span>לא מצאתם תשובה, או נתקלתם בתקלה?</span>
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose()
              onOpenFeedback()
            }}
          >
            <MessageSquare size={15} />
            שליחת משוב
          </button>
        </footer>
      </div>
    </div>
  )
}
