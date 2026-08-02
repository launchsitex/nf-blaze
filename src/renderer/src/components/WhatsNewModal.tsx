import type { ReleaseNote } from '@shared/release_notes'
import { Sparkles, X } from 'lucide-react'

/**
 * «מה חדש» — מוצג פעם אחת אחרי עדכון גרסה.
 *
 * התוכן מגיע מ-`src/shared/release_notes.ts`, שהוא הגרסה המסוננת של
 * ה-CHANGELOG. אין להציג כאן תיאורי באגים, פרצות או מבנה פנימי.
 */
interface Props {
  notes: ReleaseNote[]
  onClose: () => void
}

export default function WhatsNewModal({ notes, onClose }: Props) {
  if (!notes.length) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 580 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div
            style={{
              width: 46,
              height: 46,
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              borderRadius: 13,
              background: 'var(--accent-soft)',
              border: '1px solid rgba(232,160,74,0.3)',
              color: 'var(--accent-hot)'
            }}
          >
            <Sparkles size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 id="whats-new-title" style={{ margin: 0 }}>
              מה חדש ב-NF-Blaze
            </h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              עודכנת לגרסה {notes[0]!.version}
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </div>

        <div style={{ marginTop: 20, maxHeight: '58vh', overflowY: 'auto' }}>
          {notes.map((note) => (
            <div key={note.version} style={{ marginBottom: 26 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  marginBottom: 10,
                  flexWrap: 'wrap'
                }}
              >
                <span
                  className="badge"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent-hot)' }}
                >
                  {note.version}
                </span>
                <strong style={{ fontSize: '1.02rem' }}>{note.headline}</strong>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{note.date}</span>
              </div>

              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 9 }}>
                {note.items.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      position: 'relative',
                      paddingInlineStart: 20,
                      color: 'var(--text-muted)',
                      fontSize: '0.93rem',
                      lineHeight: 1.7
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        insetInlineStart: 0,
                        top: '0.62em',
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        background: 'var(--accent)',
                        opacity: 0.8,
                        transform: 'rotate(45deg)'
                      }}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', minHeight: 46, marginTop: 6 }}
          onClick={onClose}
        >
          יאללה, בוא נתחיל
        </button>
      </div>
    </div>
  )
}
