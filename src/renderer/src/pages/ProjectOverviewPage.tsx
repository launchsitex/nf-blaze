import { useCallback, useEffect, useState } from 'react'
import type { ProjectIntegrations, ProjectMeta } from '@shared/types'
import {
  Check,
  ExternalLink,
  FolderOpen,
  Github,
  GitBranch,
  MessageSquare,
  Pencil,
  PlugZap,
  UploadCloud,
  X
} from 'lucide-react'
import IntegrationsPanel from '../components/IntegrationsPanel'

interface Props {
  project: ProjectMeta
  onOpenChat: () => void
  onProjectUpdate: (p: ProjectMeta) => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}

/** מסך פרויקט (בסגנון Dyad): שם, נתיב, GitHub עם ענף, Supabase — והכניסה לצ'אט */
export default function ProjectOverviewPage({ project, onOpenChat, onProjectUpdate }: Props) {
  const [integ, setInteg] = useState<ProjectIntegrations | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(project.name)
  const [showIntegrations, setShowIntegrations] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [status, setStatus] = useState('')

  const refresh = useCallback(async () => {
    try {
      const data = await window.nfblaze.getIntegrations(project.id)
      setInteg(data)
      if (data.github.connected && data.github.repoFullName) {
        window.nfblaze
          .listGithubBranches(project.id)
          .then(setBranches)
          .catch(() => setBranches(data.github.defaultBranch ? [data.github.defaultBranch] : []))
      } else {
        setBranches([])
      }
    } catch {
      /* integrations optional */
    }
  }, [project.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function saveName() {
    const name = nameDraft.trim()
    setEditingName(false)
    if (!name || name === project.name) {
      setNameDraft(project.name)
      return
    }
    const updated = await window.nfblaze.updateProject(project.id, { name })
    onProjectUpdate(updated)
    setStatus('שם הפרויקט עודכן')
  }

  async function syncToGithub() {
    setSyncBusy(true)
    setStatus('')
    try {
      const res = await window.nfblaze.pushGithub(project.id)
      setStatus(res.ok ? `✓ ${res.summary}` : `✗ ${res.summary}`)
    } catch (err) {
      setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncBusy(false)
    }
  }

  async function changeBranch(branch: string) {
    if (!branch) return
    const next = await window.nfblaze.setGithubBranch(project.id, branch)
    setInteg(next)
    setStatus(`ענף היעד: ${branch}`)
  }

  async function disconnectRepo() {
    if (!confirm('לנתק את הפרויקט מהריפו? (הקוד ב-GitHub לא נמחק)')) return
    setInteg(await window.nfblaze.disconnectGithub(project.id))
    setStatus('נותק מהריפו')
  }

  async function disconnectSupabase() {
    if (!confirm('לנתק את Supabase מהפרויקט? (קובצי .env לא נמחקים)')) return
    setInteg(await window.nfblaze.disconnectSupabase(project.id))
    setStatus('Supabase נותק')
  }

  const gh = integ?.github
  const sb = integ?.supabase
  const supabaseHost = sb?.projectUrl ? new URL(sb.projectUrl).hostname.split('.')[0] : ''

  return (
    <div className="home" style={{ padding: '32px 48px 64px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* כרטיס ראשי — שם, תאריכים, נתיב */}
        <div className="settings-card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {editingName ? (
              <>
                <input
                  className="input"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveName()
                    if (e.key === 'Escape') {
                      setEditingName(false)
                      setNameDraft(project.name)
                    }
                  }}
                  style={{ fontSize: '1.2rem', fontWeight: 700, maxWidth: 360 }}
                />
                <button className="btn btn-primary" onClick={() => void saveName()} title="שמור שם">
                  <Check size={15} />
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditingName(false)
                    setNameDraft(project.name)
                  }}
                  title="ביטול"
                >
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{project.name}</h2>
                <button
                  className="btn btn-ghost"
                  style={{ padding: 4 }}
                  title="שנה שם פרויקט"
                  onClick={() => {
                    setNameDraft(project.name)
                    setEditingName(true)
                  }}
                >
                  <Pencil size={15} />
                </button>
              </>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginTop: 14,
              fontSize: '0.82rem'
            }}
          >
            <div>
              <div style={{ color: 'var(--text-dim)', marginBottom: 2 }}>נוצר</div>
              <div>{formatDate(project.createdAt)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-dim)', marginBottom: 2 }}>עודכן לאחרונה</div>
              <div>{formatDate(project.updatedAt)}</div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 4 }}>
              תיקייה במחשב
            </div>
            <button
              className="btn btn-ghost"
              style={{ direction: 'ltr', fontFamily: 'Consolas, monospace', fontSize: '0.78rem' }}
              title="פתח את התיקייה בסייר הקבצים"
              onClick={() => window.nfblaze.openPath(project.folderPath)}
            >
              <FolderOpen size={14} />
              {project.folderPath}
            </button>
          </div>

          <button
            className="btn btn-primary"
            style={{ marginTop: 18, width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: '0.95rem' }}
            onClick={onOpenChat}
          >
            <MessageSquare size={17} />
            פתח בצ׳אט
          </button>
        </div>

        {/* GitHub */}
        <div className="settings-card" style={{ margin: 0 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Github size={17} />
            GitHub
          </h3>
          {gh?.connected && gh.repoFullName ? (
            <>
              <div className="key-status" style={{ marginTop: 8 }}>
                <span className="dot on" />
                מחובר לריפו:
                <a
                  href={`https://github.com/${gh.repoFullName}`}
                  style={{ color: 'var(--accent-hot)', textDecoration: 'none', direction: 'ltr' }}
                  onClick={(e) => {
                    e.preventDefault()
                    void window.nfblaze.openExternal(`https://github.com/${gh.repoFullName}`)
                  }}
                >
                  {gh.repoFullName} <ExternalLink size={11} />
                </a>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <GitBranch size={14} style={{ color: 'var(--text-dim)' }} />
                <select
                  className="select"
                  style={{ fontSize: '0.78rem', padding: '3px 10px', direction: 'ltr', maxWidth: 220 }}
                  value={gh.defaultBranch || 'main'}
                  onChange={(e) => void changeBranch(e.target.value)}
                  title="ענף היעד לסנכרון"
                >
                  {(branches.length ? branches : [gh.defaultBranch || 'main']).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  disabled={syncBusy}
                  onClick={() => void syncToGithub()}
                >
                  <UploadCloud size={15} />
                  {syncBusy ? 'מסנכרן…' : 'סנכרן ל-GitHub'}
                </button>
                <button className="btn btn-ghost" onClick={() => void disconnectRepo()}>
                  נתק מהריפו
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="desc">הפרויקט לא מחובר לריפו — חבר כדי לגבות ולסנכרן את הקוד.</p>
              <button className="btn btn-primary" onClick={() => setShowIntegrations(true)}>
                <Github size={15} />
                חבר ריפו GitHub
              </button>
            </>
          )}
        </div>

        {/* Supabase */}
        <div className="settings-card" style={{ margin: 0 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlugZap size={17} />
            Supabase
          </h3>
          {sb?.connected && sb.projectUrl ? (
            <>
              <div className="key-status" style={{ marginTop: 8 }}>
                <span className="dot on" />
                מחובר לפרויקט:
                <code dir="ltr" style={{ fontSize: '0.8rem' }}>{supabaseHost}</code>
                <a
                  href={sb.projectUrl}
                  style={{
                    marginInlineStart: 'auto',
                    color: 'var(--accent-hot)',
                    fontSize: '0.8rem',
                    textDecoration: 'none'
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    void window.nfblaze.openExternal('https://supabase.com/dashboard')
                  }}
                >
                  פתח Dashboard <ExternalLink size={11} />
                </a>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-danger" onClick={() => void disconnectSupabase()}>
                  נתק פרויקט
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="desc">
                חיבור Supabase נותן לסוכן מסד נתונים, אימות משתמשים ואחסון — מוכנים לעבודה.
              </p>
              <button className="btn btn-primary" onClick={() => setShowIntegrations(true)}>
                <PlugZap size={15} />
                חבר Supabase
              </button>
            </>
          )}
        </div>

        {status && (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{status}</div>
        )}
      </div>

      {showIntegrations && (
        <IntegrationsPanel
          projectId={project.id}
          projectName={project.name}
          onClose={() => {
            setShowIntegrations(false)
            void refresh()
          }}
          onAgentFix={() => {
            /* אין צ'אט פתוח במסך הזה */
          }}
        />
      )}
    </div>
  )
}
