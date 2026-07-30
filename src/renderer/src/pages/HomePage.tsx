import type { ProjectMeta } from '@shared/types'
import { AI_PROVIDERS } from '@shared/types'
import { Plus, Trash2 } from 'lucide-react'

interface Props {
  projects: ProjectMeta[]
  onOpen: (p: ProjectMeta) => void
  onNew: () => void
  onDelete: (id: string) => void
}

function providerLabel(id: string): string {
  return AI_PROVIDERS.find((p) => p.id === id)?.label.split(' ')[0] ?? id
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  } catch {
    return iso
  }
}

export default function HomePage({ projects, onOpen, onNew, onDelete }: Props) {
  return (
    <div className="home">
      <div className="home-orb" aria-hidden="true" />
      <section className="home-hero">
        <h1>
          בנה מערכות ב-<span>NF-Blaze</span>
        </h1>
        <p>
          סביבת פיתוח עם AI שרצה מקומית אצלך — הקוד, המפתחות והפרויקטים נשארים על המחשב שלך.
          חבר מפתח API, בחר מודל, בחר תיקייה, ותאר בעברית מה לבנות. הסוכן כותב קבצים אמיתיים
          בפרויקט, עם תצוגה מקדימה חיה, סטרימינג, ביטול שינויים וטרמינל npm מאובטח — הכל במקום אחד.
        </p>
        {projects.length === 0 && (
          <ol className="onboarding-steps">
            <li>פתח הגדרות והוסף מפתח OpenAI / Claude / Gemini / OpenRouter — או בחר Ollama מקומי בלי מפתח</li>
            <li>צור פרויקט חדש — בחר תבנית, תיקייה ריקה, והמתן להתקנת תלויות</li>
            <li>תאר מה לבנות — הסוכן עובד לפי PROJECT_RULES של התבנית</li>
          </ol>
        )}
        <div className="home-actions">
          <button className="btn btn-primary" onClick={onNew}>
            <Plus size={18} />
            התחל פרויקט חדש
          </button>
        </div>
      </section>

      <section className="projects-section">
        <div className="section-head">
          <h2>הפרויקטים שלך</h2>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            {projects.length} פרויקטים
          </span>
        </div>

        {projects.length === 0 ? (
          <div className="empty-state">
            <p>עדיין אין פרויקטים. צור פרויקט ראשון ובחר תיקייה במחשב לשמירה.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onNew}>
              יצירת פרויקט
            </button>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <div key={p.id} style={{ position: 'relative' }}>
                <button className="project-card" onClick={() => onOpen(p)}>
                  <h3>{p.name}</h3>
                  <p>{p.description || 'ללא תיאור'}</p>
                  <div className="project-meta">
                    <span className="badge">{providerLabel(p.provider)}</span>
                    <span>{formatDate(p.updatedAt)}</span>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: '0.72rem',
                      color: 'var(--text-dim)',
                      direction: 'ltr',
                      textAlign: 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={p.folderPath}
                  >
                    {p.folderPath}
                  </div>
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ position: 'absolute', top: 8, left: 8, padding: 6 }}
                  title="מחק פרויקט מהרשימה"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`למחוק את "${p.name}" מהרשימה? (הקבצים בתיקייה לא יימחקו)`)) {
                      onDelete(p.id)
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
