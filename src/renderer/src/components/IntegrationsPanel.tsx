import { useEffect, useState } from 'react'
import type {
  GithubRepoInfo,
  ProjectIntegrations,
  SupabaseProjectInfo,
  VercelDeployResult,
  VercelProjectInfo
} from '@shared/types'
import { DEFAULT_INTEGRATIONS, SECURITY_OVERRIDE_PHRASE } from '@shared/types'
import OAuthConnectButton from './OAuthConnectButton'

import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Database,
  ExternalLink,
  Github,
  Globe,
  Link2,
  Loader2,
  PlugZap,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Upload,
  Unplug,
  Wrench
} from 'lucide-react'

/**
 * הזנה ידנית של טוקנים נשארת זמינה — אבל מקופלת. המסלול הרגיל הוא
 * «התחבר עם…»; הידני נועד לחשבונות ארגוניים או לפתרון תקלות.
 */
function AdvancedSection({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen((v) => !v)}
        style={{ padding: '4px 8px', fontSize: '0.82rem', color: 'var(--text-muted)' }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
        {title}
      </button>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

/**
 * קישור ישיר לעמוד שבו משיגים את פרטי החיבור של הפלטפורמה.
 * בלי זה המשתמש נשאר עם «הזן טוקן» ובלי מושג מאיפה לוקחים אותו.
 */
function ConnectLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      className="connect-link"
      title={url}
      onClick={(e) => {
        e.preventDefault()
        void window.nfblaze.openExternal(url)
      }}
    >
      {label}
      <ExternalLink size={12} />
    </a>
  )
}

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
  /** Feed a build-failure prompt into the chat/agent loop */
  onAgentFix?: (message: string) => void
}

export default function IntegrationsPanel({ projectId, projectName, onClose, onAgentFix }: Props) {
  const [integ, setInteg] = useState<ProjectIntegrations>(DEFAULT_INTEGRATIONS)
  const [ghUser, setGhUser] = useState<string | null>(null)
  const [ghToken, setGhToken] = useState('')
  const [repos, setRepos] = useState<GithubRepoInfo[]>([])
  const [repoName, setRepoName] = useState(projectName.replace(/\s+/g, '-').toLowerCase())
  const [isPrivate, setIsPrivate] = useState(true)
  const [sbUrl, setSbUrl] = useState('')
  const [sbAnon, setSbAnon] = useState('')
  const [sbService, setSbService] = useState('')
  const [sbToken, setSbToken] = useState('')
  const [sbAccount, setSbAccount] = useState<{ connected: boolean; orgName?: string }>({
    connected: false
  })
  const [sbProjects, setSbProjects] = useState<SupabaseProjectInfo[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const [vercelUser, setVercelUser] = useState<string | null>(null)
  const [hasPlatform, setHasPlatform] = useState(false)
  const [hasUserToken, setHasUserToken] = useState(false)
  const [vercelProjects, setVercelProjects] = useState<VercelProjectInfo[]>([])
  const [vercelProjectName, setVercelProjectName] = useState(
    projectName.replace(/\s+/g, '-').toLowerCase()
  )
  const [lastDeploy, setLastDeploy] = useState<VercelDeployResult | null>(null)
  const [overrideChecked, setOverrideChecked] = useState(false)
  const [overridePhrase, setOverridePhrase] = useState('')

  function securityOverridePayload(): { confirmed: boolean; phrase: string } | undefined {
    if (!overrideChecked) return undefined
    if (overridePhrase.trim() !== SECURITY_OVERRIDE_PHRASE) return undefined
    return { confirmed: true, phrase: SECURITY_OVERRIDE_PHRASE }
  }

  function handleDeployResult(res: VercelDeployResult): void {
    setLastDeploy(res)
    if (res.securityBlocked) {
      setErr(res.message)
      return
    }
    if (!res.ok) {
      throw new Error(res.buildLogHebrew || res.message)
    }
    setMsg(res.message)
    setOverrideChecked(false)
    setOverridePhrase('')
  }

  async function refresh(): Promise<void> {
    const [i, status, vStatus, sbAcc] = await Promise.all([
      window.nfblaze.getIntegrations(projectId),
      window.nfblaze.githubStatus(),
      window.nfblaze.vercelStatus(),
      window.nfblaze.supabaseAccountStatus()
    ])
    setInteg(i)
    setGhUser(status.user?.login || null)
    if (i.supabase.projectUrl) setSbUrl(i.supabase.projectUrl)
    setVercelUser(vStatus.user?.username || null)
    setHasPlatform(vStatus.hasPlatformToken)
    setHasUserToken(vStatus.hasUserToken)
    setSbAccount(sbAcc)
    if (!sbAcc.connected) setSbProjects([])
    if (i.vercel.projectName) setVercelProjectName(i.vercel.projectName)
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [projectId])

  async function run(label: string, fn: () => Promise<void>): Promise<void> {
    setBusy(label)
    setErr('')
    setMsg('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  function openUrl(url: string): void {
    window.open(url, '_blank')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal integ-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h2>חיבורים · {projectName}</h2>
            <p className="sub">GitHub, Supabase ו-Vercel — מפתחות נשמרים מוצפנים במחשב.</p>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            סגור
          </button>
        </div>

        {/* Vercel */}
        <div className="settings-card" style={{ marginTop: 8 }}>
          <h3>
            <Globe size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
            פרסום ל-Vercel
          </h3>
          <p className="desc">
            שני מסלולים: פרסום מיידי בלי חשבון (עם קישור claim), או פרסום לחשבון שלך עם טוקן
            מההגדרות.
          </p>

          <div className="key-status">
            <span className={`dot ${integ.vercel.connected || integ.vercel.url ? 'on' : ''}`} />
            {integ.vercel.url ? (
              <>
                פורסם ·{' '}
                <a
                  href={integ.vercel.url}
                  style={{ color: 'var(--accent-hot)' }}
                  onClick={(e) => {
                    e.preventDefault()
                    openUrl(integ.vercel.url!)
                  }}
                >
                  {integ.vercel.url}
                </a>
              </>
            ) : (
              'עדיין לא פורסם'
            )}
            {integ.vercel.framework && (
              <span className="badge" style={{ marginInlineStart: 8 }}>
                {integ.vercel.framework}
              </span>
            )}
          </div>

          {(integ.vercel.url || integ.vercel.connected) && (
            <div className="folder-row" style={{ marginBottom: 10 }}>
              <button
                className="btn btn-primary"
                disabled={!!busy}
                onClick={() =>
                  run('redeploy', async () => {
                    const res = await window.nfblaze.redeployVercel(
                      projectId,
                      securityOverridePayload()
                    )
                    handleDeployResult(res)
                  })
                }
              >
                <Rocket size={16} />
                פרסם עדכון
              </button>
              {integ.vercel.url && (
                <button className="btn" onClick={() => openUrl(integ.vercel.url!)}>
                  <ExternalLink size={16} />
                  פתח אתר
                </button>
              )}
              <button
                className="btn btn-danger"
                disabled={!!busy}
                onClick={() =>
                  run('disconnect-vercel', async () => {
                    await window.nfblaze.disconnectVercel(projectId)
                    setLastDeploy(null)
                    setMsg('פרסום Vercel נותק מהפרויקט (האתר ב-Vercel לא נמחק)')
                  })
                }
              >
                <Unplug size={16} />
                נתק
              </button>
            </div>
          )}

          <div className="form-grid">
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.02)'
              }}
            >
              <strong style={{ display: 'block', marginBottom: 6 }}>מסלול א׳ — פרסום מיידי</strong>
              <p className="desc" style={{ marginBottom: 8 }}>
                בלי חשבון Vercel שלך. מקבלים כתובת חיה + קישור claim. Claim = העברת בעלות האתר
                לחשבון שלך ב-Vercel (חינם). כדאי ללחוץ כדי לנהל דומיין, עדכונים והגדרות בעצמך — אחרת
                האתר נשאר תחת החשבון המארח.
              </p>
              <button
                className="btn btn-primary"
                disabled={!!busy || !hasPlatform}
                title={
                  hasPlatform
                    ? 'פרסום מיידי'
                    : 'חסר טוקן מארח — הגדר בהגדרות או NF_BLAZE_VERCEL_TOKEN'
                }
                onClick={() =>
                  run('deploy-instant', async () => {
                    const res = await window.nfblaze.deployVercel({
                      projectId,
                      mode: 'instant',
                      securityOverride: securityOverridePayload()
                    })
                    handleDeployResult(res)
                  })
                }
              >
                <Rocket size={16} />
                פרסם עכשיו (בלי חשבון)
              </button>
              {!hasPlatform && (
                <p className="desc" style={{ marginTop: 8, color: 'var(--warning, #e6a23c)' }}>
                  פרסום מיידי דורש טוקן מארח (הגדרות → Vercel מארח, או משתני סביבה
                  NF_BLAZE_VERCEL_TOKEN / NF_BLAZE_VERCEL_TEAM_ID).
                </p>
              )}
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.02)'
              }}
            >
              <strong style={{ display: 'block', marginBottom: 6 }}>מסלול ב׳ — החשבון שלך</strong>
              {!hasUserToken ? (
                <div style={{ marginBottom: 10 }}>
                  <p className="desc" style={{ marginBottom: 10 }}>
                    חבר את חשבון Vercel שלך, ואז אפשר יהיה לפרסם לפרויקט חדש או קיים.
                  </p>
                  <OAuthConnectButton
                    provider="vercel"
                    disabled={!!busy}
                    onConnected={(res) => {
                      setMsg(res.message)
                      void refresh()
                    }}
                    onError={setErr}
                  />
                </div>
              ) : (
                <>
                  <p className="desc" style={{ marginBottom: 8 }}>
                    {vercelUser ? `מחובר כ־@${vercelUser}` : 'החשבון מחובר'}
                  </p>
                  <div className="key-status" style={{ marginBottom: 8 }}>
                    <ConnectLink
                      url="https://vercel.com/dashboard/integrations"
                      label="נהל הרשאות ב-Vercel"
                    />
                  </div>
                </>
              )}
              <div className="field">
                <label>שם פרויקט ב-Vercel</label>
                <input
                  className="input"
                  value={vercelProjectName}
                  onChange={(e) => setVercelProjectName(e.target.value)}
                  style={{ direction: 'ltr', textAlign: 'left' }}
                />
              </div>
              <div className="folder-row">
                <button
                  className="btn btn-primary"
                  disabled={!!busy || !hasUserToken}
                  onClick={() =>
                    run('deploy-new', async () => {
                      const res = await window.nfblaze.deployVercel({
                        projectId,
                        mode: 'account',
                        createNew: true,
                        projectName: vercelProjectName,
                        securityOverride: securityOverridePayload()
                      })
                      handleDeployResult(res)
                    })
                  }
                >
                  <Rocket size={16} />
                  צור פרויקט ופרסם
                </button>
                <button
                  className="btn"
                  disabled={!!busy || !hasUserToken}
                  onClick={() =>
                    run('list-vercel', async () => {
                      setVercelProjects(await window.nfblaze.listVercelProjects())
                    })
                  }
                >
                  <Link2 size={16} />
                  בחר פרויקט קיים
                </button>
              </div>
              {vercelProjects.length > 0 && (
                <select
                  className="select"
                  defaultValue=""
                  onChange={(e) => {
                    const p = vercelProjects.find((x) => x.id === e.target.value)
                    if (!p) return
                    run('deploy-existing', async () => {
                      const res = await window.nfblaze.deployVercel({
                        projectId,
                        mode: 'account',
                        createNew: false,
                        existingProjectId: p.id,
                        existingProjectName: p.name,
                        securityOverride: securityOverridePayload()
                      })
                      setVercelProjects([])
                      handleDeployResult(res)
                    })
                  }}
                >
                  <option value="" disabled>
                    בחר פרויקט Vercel…
                  </option>
                  {vercelProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.framework ? ` (${p.framework})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {lastDeploy?.securityBlocked && lastDeploy.securityFindings && (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 10,
                border: '1px solid rgba(220, 80, 80, 0.55)',
                background: 'rgba(220, 80, 80, 0.08)'
              }}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={18} />
                הפרסום נחסם — בעיית אבטחה
              </strong>
              <p className="desc" style={{ marginTop: 8 }}>
                {lastDeploy.securitySummaryHebrew || lastDeploy.message}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {lastDeploy.securityFindings.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      border: `1px solid ${
                        f.severity === 'block'
                          ? 'rgba(220, 80, 80, 0.4)'
                          : 'rgba(230, 162, 60, 0.45)'
                      }`,
                      background: 'rgba(0,0,0,0.2)'
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {f.severity === 'block' ? 'חסימה' : 'אזהרה חזקה'} · {f.title}
                    </div>
                    <div style={{ fontSize: '0.85rem', marginBottom: 4 }}>
                      <strong>מה נמצא:</strong> {f.found}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <strong>למה זה מסוכן:</strong> {f.why}
                    </div>
                    {f.fixHint && (
                      <pre
                        style={{
                          marginTop: 8,
                          maxHeight: 140,
                          overflow: 'auto',
                          direction: 'ltr',
                          textAlign: 'left',
                          fontSize: '0.75rem',
                          padding: 8,
                          borderRadius: 6,
                          background: 'rgba(0,0,0,0.35)',
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {f.fixHint}
                      </pre>
                    )}
                  </div>
                ))}
              </div>

              {onAgentFix && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  disabled={!!busy}
                  onClick={() => {
                    const prompt =
                      lastDeploy.securityAgentPrompt ||
                      lastDeploy.securitySummaryHebrew ||
                      lastDeploy.message
                    onClose()
                    onAgentFix(prompt)
                  }}
                >
                  <Wrench size={16} />
                  תן לסוכן לתקן
                </button>
              )}

              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px dashed rgba(230, 162, 60, 0.6)',
                  background: 'rgba(230, 162, 60, 0.08)'
                }}
              >
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={16} />
                  עקיפה ידנית (מסוכן)
                </strong>
                <p className="desc" style={{ marginTop: 6 }}>
                  עקיפה תפרסם למרות החסימה. רק אם אתה מבין את הסיכון ומקבל אחריות. יש לסמן ולאשר
                  במפורש את המשפט למטה — אחרת הפרסום יישאר חסום.
                </p>
                <label
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    marginTop: 8,
                    fontSize: '0.85rem'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={overrideChecked}
                    onChange={(e) => setOverrideChecked(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>אני מאשר במפורש שאני רוצה לפרסם למרות אזהרות האבטחה</span>
                </label>
                <div className="field" style={{ marginTop: 8 }}>
                  <label>הקלד לאישור:</label>
                  <div
                    className="desc"
                    style={{
                      marginBottom: 4,
                      direction: 'rtl',
                      fontWeight: 600,
                      color: 'var(--warning, #e6a23c)'
                    }}
                  >
                    {SECURITY_OVERRIDE_PHRASE}
                  </div>
                  <input
                    className="input"
                    value={overridePhrase}
                    onChange={(e) => setOverridePhrase(e.target.value)}
                    placeholder="העתק/הקלד את משפט האישור"
                    disabled={!overrideChecked}
                  />
                </div>
                <p className="desc" style={{ marginTop: 8 }}>
                  אחרי האישור — לחץ שוב על «פרסם» (העקיפה תישלח עם הבקשה).
                </p>
              </div>
            </div>
          )}

          {(lastDeploy?.claimUrl || integ.vercel.claimUrl) && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--accent-hot)',
                background: 'rgba(255,120,80,0.06)'
              }}
            >
              <strong>העברת בעלות (Claim)</strong>
              <p className="desc" style={{ margin: '6px 0 10px' }}>
                האתר כבר חי בכתובת הזמנית. לחיצה על Claim מעבירה אותו לחשבון Vercel שלך — שם תוכל
                לחבר דומיין, לראות לוגים, ולנהל עדכונים. בלי Claim האתר נשאר אצל המארח.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => openUrl((lastDeploy?.claimUrl || integ.vercel.claimUrl)!)}
              >
                <ExternalLink size={16} />
                פתח Claim והעבר בעלות
              </button>
            </div>
          )}

          {(lastDeploy?.buildLogHebrew || integ.vercel.lastErrorLog) && (
            <div style={{ marginTop: 12 }}>
              <pre
                style={{
                  maxHeight: 180,
                  overflow: 'auto',
                  direction: 'ltr',
                  textAlign: 'left',
                  fontSize: '0.78rem',
                  padding: 10,
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid var(--border)',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {lastDeploy?.buildLogHebrew || integ.vercel.lastErrorLog}
              </pre>
              {onAgentFix && (
                <button
                  className="btn"
                  style={{ marginTop: 8 }}
                  disabled={!!busy}
                  onClick={() => {
                    const log = lastDeploy?.buildLogHebrew || integ.vercel.lastErrorLog || ''
                    onClose()
                    onAgentFix(
                      [
                        'הפרסום ל-Vercel נכשל. תקן את הפרויקט לפי לוג הבנייה הבא.',
                        'אחרי התיקון אודיע שאפשר לפרסם שוב.',
                        '',
                        log
                      ].join('\n')
                    )
                  }}
                >
                  <Wrench size={16} />
                  תן לסוכן לתקן
                </button>
              )}
            </div>
          )}
        </div>

        {/* GitHub */}
        <div className="settings-card">
          <h3>
            <Github size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
            GitHub
          </h3>
          <p className="desc">
            חיבור בלחיצה אחת — NF-Blaze תיצור ריפו ותדחוף אליו קוד בשמך. ההרשאה ניתנת בדף
            האישור של GitHub וניתנת לביטול משם בכל רגע.
          </p>

          <div className="key-status">
            <span className={`dot ${ghUser ? 'on' : ''}`} />
            {ghUser ? `מחובר כ־@${ghUser}` : 'לא מחובר'}
            {integ.github.repoFullName && (
              <span className="badge" style={{ marginInlineStart: 8 }}>
                {integ.github.repoFullName}
              </span>
            )}
            {ghUser && (
              <ConnectLink
                url="https://github.com/settings/applications"
                label="נהל הרשאות ב-GitHub"
              />
            )}
          </div>

          {!ghUser ? (
            <>
              <OAuthConnectButton
                provider="github"
                disabled={!!busy}
                onConnected={async (res) => {
                  setMsg(res.message)
                  await refresh()
                  // הריפוזיטוריז נטענים מיד — החיבור נעשה כדי לבחור ריפו,
                  // אין סיבה לדרוש קליק נוסף בשביל הרשימה
                  try {
                    setRepos(await window.nfblaze.listGithubRepos())
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e))
                  }
                }}
                onError={setErr}
              />
              <AdvancedSection title="חיבור ידני עם טוקן (מתקדם)">
                <p className="desc" style={{ marginBottom: 8 }}>
                  לחשבונות שבהם אישור אפליקציות חסום. נדרש Fine-grained PAT עם הרשאות
                  Contents + Metadata. נשמר מוצפן ב-safeStorage.
                </p>
                <div className="key-status" style={{ marginBottom: 8 }}>
                  <ConnectLink url="https://github.com/settings/tokens?type=beta" label="צור token" />
                </div>
                <div className="folder-row">
                  <input
                    className="input"
                    type="password"
                    placeholder="github_pat_… או ghp_…"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    style={{ direction: 'ltr', textAlign: 'left' }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!!busy || !ghToken.trim()}
                    onClick={() =>
                      run('github-token', async () => {
                        const res = await window.nfblaze.setGithubToken(ghToken.trim())
                        setGhToken('')
                        setMsg(`GitHub חובר: @${res.user.login}`)
                      })
                    }
                  >
                    <PlugZap size={16} />
                    חבר
                  </button>
                </div>
              </AdvancedSection>
            </>
          ) : (
            <div className="form-grid">
              {!integ.github.connected && (
                <>
                  <div className="field">
                    <label>שם ריפו חדש</label>
                    <input
                      className="input"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      style={{ direction: 'ltr', textAlign: 'left' }}
                    />
                  </div>
                  <label
                    style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.88rem' }}
                  >
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                    />
                    ריפו פרטי
                  </label>
                  <div className="folder-row">
                    <button
                      className="btn btn-primary"
                      disabled={!!busy}
                      onClick={() =>
                        run('create-repo', async () => {
                          const repo = await window.nfblaze.createGithubRepo({
                            projectId,
                            name: repoName,
                            description: `NF-Blaze · ${projectName}`,
                            isPrivate
                          })
                          setMsg(`נוצר וקושר: ${repo.fullName}`)
                        })
                      }
                    >
                      <Github size={16} />
                      צור ריפו וקשר
                    </button>
                    <button
                      className="btn"
                      disabled={!!busy}
                      onClick={() =>
                        run('list-repos', async () => {
                          setRepos(await window.nfblaze.listGithubRepos())
                        })
                      }
                    >
                      <Link2 size={16} />
                      בחר ריפו קיים
                    </button>
                  </div>
                  {repos.length > 0 && (
                    <select
                      className="select"
                      defaultValue=""
                      onChange={(e) => {
                        const repo = repos.find((r) => r.fullName === e.target.value)
                        if (!repo) return
                        run('link-repo', async () => {
                          await window.nfblaze.linkGithubRepo({
                            projectId,
                            cloneUrl: repo.cloneUrl,
                            fullName: repo.fullName,
                            defaultBranch: repo.defaultBranch,
                            isPrivate: repo.private
                          })
                          setMsg(`קושר ל-${repo.fullName}`)
                          setRepos([])
                        })
                      }}
                    >
                      <option value="" disabled>
                        בחר ריפו…
                      </option>
                      {repos.map((r) => (
                        <option key={r.fullName} value={r.fullName}>
                          {r.fullName}
                          {r.private ? ' 🔒' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}

              {integ.github.connected && (
                <div className="folder-row">
                  <button
                    className="btn btn-primary"
                    disabled={!!busy}
                    onClick={() =>
                      run('push', async () => {
                        const res = await window.nfblaze.pushGithub(projectId)
                        setMsg(res.summary)
                      })
                    }
                  >
                    <Upload size={16} />
                    Push ל-GitHub
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={!!busy}
                    onClick={() =>
                      run('disconnect-gh', async () => {
                        await window.nfblaze.disconnectGithub(projectId)
                        setMsg('הריפו נותק מהפרויקט')
                      })
                    }
                  >
                    <Unplug size={16} />
                    נתק ריפו
                  </button>
                </div>
              )}

              <button
                className="btn btn-ghost"
                style={{ alignSelf: 'start' }}
                onClick={() =>
                  run('clear-token', async () => {
                    await window.nfblaze.clearGithubToken()
                    setMsg('חשבון GitHub נותק מהמחשב')
                  })
                }
              >
                <Unplug size={16} />
                נתק חשבון GitHub
              </button>
            </div>
          )}
        </div>

        {/* Supabase */}
        <div className="settings-card">
          <h3>
            <Database size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
            Supabase
          </h3>
          <p className="desc">
            התחבר פעם אחת ובחר פרויקט — הכתובת והמפתחות נמשכים אוטומטית, וגם הסוכן מקבל
            הרשאה להריץ SQL (יצירת טבלאות ו-RLS) בלי שתעתיק כלום.
          </p>

          <div className="key-status">
            <span className={`dot ${integ.supabase.connected ? 'on' : ''}`} />
            {integ.supabase.connected ? `מחובר · ${integ.supabase.projectUrl}` : 'לא מחובר'}
            {integ.supabase.hasAgentDbAccess && (
              <span className="badge" style={{ marginInlineStart: 8 }}>
                הסוכן מריץ SQL
              </span>
            )}
            {integ.supabase.projectUrl && (
              <ConnectLink url="https://supabase.com/dashboard/projects" label="פתח ב-Supabase" />
            )}
          </div>

          {!sbAccount.connected ? (
            <OAuthConnectButton
              provider="supabase"
              disabled={!!busy}
              onConnected={async (res) => {
                setMsg(res.message)
                await refresh()
                // אותה לוגיקה כמו ב-GitHub: מתחברים כדי לבחור פרויקט
                try {
                  const list = await window.nfblaze.listSupabaseProjects()
                  setSbProjects(list)
                  if (!list.length) setMsg('אין פרויקטים בחשבון — צור אחד ב-Supabase ורענן.')
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e))
                }
              }}
              onError={setErr}
            />
          ) : (
            <div>
              <div className="key-status" style={{ marginBottom: 10 }}>
                <span className="dot on" />
                חשבון מחובר{sbAccount.orgName ? ` · ${sbAccount.orgName}` : ''}
              </div>

              <div className="folder-row" style={{ marginBottom: 10 }}>
                <button
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={() =>
                    run('sb-list', async () => {
                      const list = await window.nfblaze.listSupabaseProjects()
                      setSbProjects(list)
                      if (!list.length) setMsg('אין פרויקטים בחשבון — צור אחד ב-Supabase ורענן.')
                    })
                  }
                >
                  <RefreshCw size={16} />
                  {sbProjects.length ? 'רענן רשימה' : 'בחר פרויקט'}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!!busy}
                  onClick={() =>
                    run('sb-account-disconnect', async () => {
                      await window.nfblaze.disconnectSupabaseAccount()
                      setSbProjects([])
                      setMsg('חשבון Supabase נותק מהמחשב')
                    })
                  }
                >
                  <Unplug size={16} />
                  נתק חשבון
                </button>
              </div>

              {sbProjects.length > 0 && (
                <select
                  className="select"
                  defaultValue=""
                  onChange={(e) => {
                    const ref = e.target.value
                    if (!ref) return
                    run('sb-link', async () => {
                      const res = await window.nfblaze.linkSupabaseProject({ projectId, ref })
                      setSbProjects([])
                      setMsg(res.message)
                    })
                  }}
                >
                  <option value="" disabled>
                    בחר פרויקט Supabase…
                  </option>
                  {sbProjects.map((p) => (
                    <option key={p.ref} value={p.ref}>
                      {p.name} ({p.ref})
                    </option>
                  ))}
                </select>
              )}

              {integ.supabase.connected && (
                <button
                  className="btn btn-danger"
                  style={{ marginTop: 10 }}
                  disabled={!!busy}
                  onClick={() =>
                    run('disconnect-sb', async () => {
                      await window.nfblaze.disconnectSupabase(projectId)
                      setMsg('Supabase נותק מהפרויקט')
                    })
                  }
                >
                  <Unplug size={16} />
                  נתק את הפרויקט
                </button>
              )}
            </div>
          )}

          <AdvancedSection title="חיבור ידני עם מפתחות (מתקדם)">
          <p className="desc" style={{ marginBottom: 10 }}>
            הזן Project URL + anon/publishable key. service_role אופציונלי ונשמר רק ב-.env.local
            (לא לקליינט).
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Project URL</label>
              <input
                className="input"
                placeholder="https://xxxx.supabase.co"
                value={sbUrl}
                onChange={(e) => setSbUrl(e.target.value)}
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
            </div>
            <div className="field">
              <label>anon / publishable key</label>
              <input
                className="input"
                type="password"
                placeholder="eyJ… או sb_publishable_…"
                value={sbAnon}
                onChange={(e) => setSbAnon(e.target.value)}
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
            </div>
            <div className="field">
              <label>service_role (אופציונלי — רק שרת)</label>
              <input
                className="input"
                type="password"
                placeholder="לא חובה"
                value={sbService}
                onChange={(e) => setSbService(e.target.value)}
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
            </div>
            <div className="field">
              <label>
                Personal Access Token — לגישת הסוכן להריץ SQL (אופציונלי){' '}
                {integ.supabase.hasAgentDbAccess ? '· ✓ פעיל' : ''}
              </label>
              <input
                className="input"
                type="password"
                placeholder="sbp_… (מתחיל ב-sbp_)"
                value={sbToken}
                onChange={(e) => setSbToken(e.target.value)}
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
              <p className="desc" style={{ marginTop: 4, fontSize: '0.75rem', lineHeight: 1.6 }}>
                ⚠️ <strong>זה לא מפתח ה-API של הפרויקט</strong> (anon / service_role / publishable /
                secret). זהו טוקן ברמת <strong>החשבון</strong>, שמתחיל ב-<code>sbp_</code>.
                <br />
                איפה יוצרים: בפינה העליונה של Supabase → <strong>Account</strong> (אווטאר) →{' '}
                <strong>Access Tokens</strong> → «Generate new token».{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    void window.nfblaze.openExternal('https://supabase.com/dashboard/account/tokens')
                  }}
                  style={{ color: 'var(--accent)' }}
                >
                  פתח את דף הטוקנים
                </a>
                <br />
                עם הטוקן הסוכן יריץ SQL ישירות (יצירת טבלאות, שינוי נתונים); בלעדיו רק יכתוב לך SQL
                להרצה ידנית. נשמר מוצפן במחשב בלבד.
              </p>
            </div>
            <div className="folder-row">
              <button
                className="btn"
                disabled={!!busy || !sbUrl.trim() || !sbAnon.trim()}
                onClick={() =>
                  run('test-sb', async () => {
                    const res = await window.nfblaze.testSupabase(sbUrl.trim(), sbAnon.trim())
                    if (!res.ok) throw new Error(res.message)
                    setMsg(res.message)
                  })
                }
              >
                בדוק חיבור
              </button>
              <button
                className="btn btn-primary"
                disabled={!!busy || !sbUrl.trim() || !sbAnon.trim()}
                onClick={() =>
                  run('connect-sb', async () => {
                    const res = await window.nfblaze.connectSupabase({
                      projectId,
                      projectUrl: sbUrl.trim(),
                      anonKey: sbAnon.trim(),
                      serviceRoleKey: sbService.trim() || undefined,
                      accessToken: sbToken.trim() || undefined,
                      writeEnvFiles: true,
                      scaffoldClient: true
                    })
                    setSbAnon('')
                    setSbService('')
                    setSbToken('')
                    setMsg(res.message)
                  })
                }
              >
                <PlugZap size={16} />
                חבר וכתוב .env
              </button>
              {integ.supabase.connected && (
                <button
                  className="btn btn-danger"
                  disabled={!!busy}
                  onClick={() =>
                    run('disconnect-sb', async () => {
                      await window.nfblaze.disconnectSupabase(projectId)
                      setMsg('Supabase נותק')
                    })
                  }
                >
                  <Unplug size={16} />
                  נתק
                </button>
              )}
            </div>
          </div>
          </AdvancedSection>
        </div>

        {busy && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}
          >
            <Loader2 size={16} className="spin" />
            מבצע… {busy}
          </div>
        )}
        {msg && <div style={{ color: 'var(--success)', fontSize: '0.9rem' }}>{msg}</div>}
        {err && (
          <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }} role="alert">
            {err}
          </div>
        )}
      </div>
    </div>
  )
}
