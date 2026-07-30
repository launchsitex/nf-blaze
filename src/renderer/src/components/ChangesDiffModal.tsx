import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { SnapshotFileDiff } from '@shared/types'
import { FilePlus2, FileX2, X } from 'lucide-react'
import { languageFromPath } from '../lib/language'

interface Props {
  projectId: string
  snapshotId: string
  onClose: () => void
}

/** מודאל «הצג שינויים» — diff לכל קובץ בסבב: לפני (snapshot) מול אחרי (נוכחי) */
export default function ChangesDiffModal({ projectId, snapshotId, onClose }: Props) {
  const [files, setFiles] = useState<SnapshotFileDiff[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.nfblaze
      .getSnapshotDiff(projectId, snapshotId)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setError(res.message || 'לא ניתן לטעון את השינויים')
        } else if (!res.files.length) {
          setError('אין הבדלים להצגה בסבב הזה')
        } else {
          setFiles(res.files)
          setSelected(res.files[0]!.path)
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [projectId, snapshotId])

  const current = files.find((f) => f.path === selected)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1100px, 94vw)', height: 'min(720px, 88vh)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>שינויים בסבב</h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              לפני (שמאל) מול אחרי (ימין) · {files.length} קבצים
            </p>
          </div>
          <button className="btn btn-ghost" style={{ marginInlineStart: 'auto' }} onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </div>

        {loading && <div style={{ padding: 20, opacity: 0.7 }}>טוען שינויים…</div>}
        {error && !loading && (
          <div style={{ padding: 20, color: 'var(--danger, #d33)' }}>{error}</div>
        )}

        {!loading && !error && (
          <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
            <div
              style={{
                width: 230,
                overflowY: 'auto',
                borderInlineEnd: '1px solid var(--border, #333)',
                paddingInlineEnd: 8,
                flexShrink: 0
              }}
            >
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`file-chip ${selected === f.path ? 'active' : ''}`}
                  onClick={() => setSelected(f.path)}
                  title={f.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    border: 'none',
                    cursor: 'pointer',
                    marginBottom: 4,
                    textAlign: 'start',
                    background: selected === f.path ? 'var(--bg-hover, #2a2a2a)' : 'transparent'
                  }}
                >
                  {f.before === null && <FilePlus2 size={13} style={{ color: 'var(--success, #4caf50)', flexShrink: 0 }} />}
                  {f.after === null && <FileX2 size={13} style={{ color: 'var(--danger, #d33)', flexShrink: 0 }} />}
                  <span
                    dir="ltr"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {f.path}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minWidth: 0 }} dir="ltr">
              {current && (
                <DiffEditor
                  height="100%"
                  theme="vs-dark"
                  language={languageFromPath(current.path)}
                  original={current.before ?? ''}
                  modified={current.after ?? ''}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    fontSize: 12.5,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
