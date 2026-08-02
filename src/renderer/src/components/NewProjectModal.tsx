import { useEffect, useState } from 'react'
import type { AiProvider, ProjectMeta, ProjectTemplateId, ProjectTemplateInfo } from '@shared/types'
import { AI_PROVIDERS, getDefaultModel, getProvider } from '@shared/types'
import { FolderSearch, Github, X } from 'lucide-react'
import type { GithubRepoInfo } from '@shared/types'
import OAuthConnectButton from './OAuthConnectButton'

type ProjectMode = 'create' | 'import' | 'github'

interface Props {
  defaultProvider: AiProvider
  defaultModel: string
  onClose: () => void
  onCreated: (p: ProjectMeta) => void
}

export default function NewProjectModal({
  defaultProvider,
  defaultModel,
  onClose,
  onCreated
}: Props) {
  const [mode, setMode] = useState<ProjectMode>('create')
  const [repoUrl, setRepoUrl] = useState('')
  const [myRepos, setMyRepos] = useState<GithubRepoInfo[]>([])
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [provider, setProvider] = useState<AiProvider>(defaultProvider)
  const [model, setModel] = useState(defaultModel)
  const [templateId, setTemplateId] = useState<ProjectTemplateId>('web-app')
  const [templates, setTemplates] = useState<ProjectTemplateInfo[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')

  const models = getProvider(provider).models

  useEffect(() => {
    window.nfblaze
      .listTemplates()
      .then((list) => {
        setTemplates(list)
        if (list.length && !list.some((t) => t.id === templateId)) {
          setTemplateId(list[0].id)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // רשימת הריפוזיטוריז נטענת רק כשנכנסים לטאב — לא מעכבת פתיחת החלון
  useEffect(() => {
    if (mode !== 'github' || githubConnected !== null) return
    window.nfblaze
      .listGithubRepos()
      .then((list) => {
        setMyRepos(list)
        setGithubConnected(true)
      })
      .catch(() => setGithubConnected(false))
  }, [mode, githubConnected])

  async function pickFolder() {
    const path = await window.nfblaze.pickFolder()
    if (path) setFolderPath(path)
  }

  async function submit() {
    setError('')
    // בשכפול מ-GitHub שם הפרויקט אופציונלי — נגזר משם הריפו
    if (mode !== 'github' && !name.trim()) {
      setError('יש להזין שם לפרויקט')
      return
    }
    if (mode === 'github' && !repoUrl.trim()) {
      setError('יש להזין כתובת ריפוזיטורי או לבחור מהרשימה')
      return
    }
    if (!folderPath) {
      setError(
        mode === 'import'
          ? 'יש לבחור את תיקיית הפרויקט הקיים'
          : 'יש לבחור תיקייה במחשב שבה יישמר הפרויקט'
      )
      return
    }
    if (mode === 'create' && !templateId) {
      setError('יש לבחור תבנית התחלה')
      return
    }
    setBusy(true)
    setBusyLabel(
      mode === 'github'
        ? 'משכפל מ-GitHub, מתקין תלויות ומכין תצוגה חיה…'
        : mode === 'import'
          ? 'בודק את הפרויקט, מתקין תלויות אם צריך ומכין תצוגה חיה…'
          : 'מעתיק תבנית, מתקין תלויות ומכין תצוגה חיה…'
    )
    try {
      const project =
        mode === 'github'
          ? await window.nfblaze.importProjectFromGithub({
              repoUrl: repoUrl.trim(),
              name: name.trim() || undefined,
              description: description.trim(),
              folderPath,
              provider,
              model
            })
          : mode === 'import'
            ? await window.nfblaze.importProject({
                name: name.trim(),
                description: description.trim(),
                folderPath,
                provider,
                model
              })
            : await window.nfblaze.createProject({
                name: name.trim(),
                description: description.trim(),
                folderPath,
                provider,
                model,
                templateId
              })
      onCreated(project)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h2>
              {mode === 'github'
                ? 'ייבוא מ-GitHub'
                : mode === 'import'
                  ? 'ייבוא פרויקט קיים'
                  : 'פרויקט חדש'}
            </h2>
            <p className="sub">
              {mode === 'github'
                ? 'הדביקו כתובת ריפוזיטורי ובחרו תיקייה ריקה — הריפו משוכפל, התלויות מותקנות והתצוגה החיה עולה.'
                : mode === 'import'
                  ? 'בחרו תיקייה עם פרויקט Node/JavaScript קיים (React, Vite, Next...) — הסוכן ימשיך לעבוד עליו בלי לגעת בקבצים.'
                  : 'בחרו תבנית ותיקייה ריקה — מועתקים קבצי הבסיס, מותקנות תלויות, ותצוגה חיה מוכנה מיד עם הפתיחה.'}
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="סגור" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="form-grid">
          <div className="field">
            <div className="template-pick" style={{ marginBottom: 4 }}>
              <button
                type="button"
                className={`template-card ${mode === 'create' ? 'active' : ''}`}
                disabled={busy}
                onClick={() => setMode('create')}
              >
                <strong>פרויקט חדש מתבנית</strong>
                <span>תיקייה ריקה + קבצי בסיס</span>
              </button>
              <button
                type="button"
                className={`template-card ${mode === 'import' ? 'active' : ''}`}
                disabled={busy}
                onClick={() => setMode('import')}
              >
                <strong>ייבוא פרויקט קיים</strong>
                <span>המשך עבודה על קוד שכבר יש לך</span>
              </button>
              <button
                type="button"
                className={`template-card ${mode === 'github' ? 'active' : ''}`}
                disabled={busy}
                onClick={() => setMode('github')}
              >
                <strong>
                  <Github size={14} style={{ verticalAlign: 'middle', marginInlineEnd: 6 }} />
                  ייבוא מ-GitHub
                </strong>
                <span>שכפול ריפוזיטורי ישירות לתיקייה</span>
              </button>
            </div>
          </div>

          {mode === 'github' && (
            <div className="field">
              <label>ריפוזיטורי</label>
              <input
                className="input"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo  או  owner/repo"
                style={{ direction: 'ltr', textAlign: 'left' }}
                disabled={busy}
              />
              {githubConnected === false && (
                <div style={{ marginTop: 10 }}>
                  <p className="desc" style={{ marginBottom: 8 }}>
                    ריפו ציבורי עובד גם בלי חיבור. חבר חשבון כדי לבחור מרשימת הריפוזיטוריז שלך
                    (כולל פרטיים):
                  </p>
                  <OAuthConnectButton
                    provider="github"
                    disabled={busy}
                    onConnected={async () => {
                      // אחרי החיבור הרשימה נטענת מיד — בשביל זה נכנסים לכאן
                      try {
                        setMyRepos(await window.nfblaze.listGithubRepos())
                        setGithubConnected(true)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e))
                      }
                    }}
                    onError={(m) => m && setError(m)}
                  />
                </div>
              )}
              {myRepos.length > 0 && (
                <select
                  className="select"
                  style={{ marginTop: 8, direction: 'ltr', textAlign: 'left' }}
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const repo = myRepos.find((r) => r.cloneUrl === e.target.value)
                    if (!repo) return
                    setRepoUrl(repo.cloneUrl)
                    if (!name.trim()) setName(repo.name)
                  }}
                >
                  <option value="">— או בחר מהריפוזיטוריז שלך —</option>
                  {myRepos.map((r) => (
                    <option key={r.fullName} value={r.cloneUrl}>
                      {r.fullName}
                      {r.private ? ' (פרטי)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {mode === 'create' && (
            <div className="field">
              <label>תבנית התחלה</label>
              <div className="template-pick">
                {(templates.length
                  ? templates
                  : [
                      {
                        id: 'web-app' as const,
                        nameHe: 'אתר / אפליקציה',
                        descriptionHe: 'Vite + React + TS + Tailwind + shadcn',
                        hasSupabase: false
                      },
                      {
                        id: 'data-app' as const,
                        nameHe: 'אפליקציה עם נתונים',
                        descriptionHe: 'אותו בסיס + Supabase',
                        hasSupabase: true
                      }
                    ]
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`template-card ${templateId === t.id ? 'active' : ''}`}
                    disabled={busy}
                    onClick={() => setTemplateId(t.id)}
                  >
                    <strong>{t.nameHe}</strong>
                    <span>{t.descriptionHe}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>{mode === 'github' ? 'שם הפרויקט (ריק = שם הריפו)' : 'שם הפרויקט'}</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === 'github' ? 'נגזר אוטומטית מהריפו' : 'לדוגמה: מערכת CRM ללקוחות'}
              autoFocus={mode !== 'github'}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label>תיאור (אופציונלי)</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="מה בונים?"
              disabled={busy}
            />
          </div>

          <div className="field">
            <label>
              {mode === 'import'
                ? 'תיקיית הפרויקט הקיים'
                : mode === 'github'
                  ? 'תיקיית יעד לשכפול (ריקה)'
                  : 'תיקיית הפרויקט במחשב (ריקה)'}
            </label>
            <div className="folder-row">
              <input
                className="input"
                value={folderPath}
                readOnly
                placeholder={mode === 'import' ? 'בחר תיקייה עם package.json…' : 'בחר תיקייה ריקה…'}
                style={{ direction: 'ltr', textAlign: 'left' }}
                disabled={busy}
              />
              <button className="btn" type="button" onClick={pickFolder} disabled={busy}>
                <FolderSearch size={16} />
                בחירה
              </button>
            </div>
          </div>

          <div className="field">
            <label>ספק AI</label>
            <select
              className="select"
              value={provider}
              disabled={busy}
              onChange={(e) => {
                const p = e.target.value as AiProvider
                setProvider(p)
                setModel(getDefaultModel(p))
              }}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>מודל</label>
            <select
              className="select"
              value={model}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.recommended ? ' ★' : ''} — {m.description}
                </option>
              ))}
            </select>
          </div>

          {busyLabel && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>{busyLabel}</div>
          )}
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '0.88rem' }} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? 'מכין פרויקט…' : mode === 'import' ? 'ייבא פרויקט' : 'צור פרויקט'}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
