import { useEffect, useState } from 'react'
import type { AiProvider, AgentEngine } from '@shared/types'
import { AI_PROVIDERS, getDefaultModel, providerHasKey } from '@shared/types'
import {
  Database,
  ExternalLink,
  Github,
  Globe,
  KeyRound,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wrench
} from 'lucide-react'
import type { RuntimeEnvInfo } from '../components/RuntimeGate'
import type { LicenseStatus } from '@shared/license'
import McpServersCard from '../components/McpServersCard'
import LicenseCard from '../components/LicenseCard'
import OAuthConnectButton from '../components/OAuthConnectButton'

/** קיבוץ ההגדרות לפי מה שמחפשים ביחד, לא לפי סדר שבו נוספו */
type SettingsTab = 'models' | 'connections' | 'system' | 'license'

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Sparkles }> = [
  { id: 'models', label: 'מודלים ומפתחות', icon: Sparkles },
  { id: 'connections', label: 'חיבורים', icon: PlugZap },
  { id: 'system', label: 'מערכת', icon: Wrench },
  { id: 'license', label: 'רישיון', icon: ShieldCheck }
]

interface SettingsState {
  defaultProvider: AiProvider
  defaultModel: string
  agentEngine?: AgentEngine
  vercelTeamId?: string
  vercelPlatformTeamId?: string
  hasOpenaiKey: boolean
  hasAnthropicKey: boolean
  hasGeminiKey: boolean
  hasOpenrouterKey?: boolean
  hasGithubToken?: boolean
  hasVercelToken?: boolean
  hasVercelPlatformToken?: boolean
  encryptionAvailable?: boolean
}

interface Props {
  settings: SettingsState | null
  onSaved: () => Promise<void>
  runtimeEnv?: RuntimeEnvInfo | null
  runtimeChecking?: boolean
  onRecheckRuntime?: () => void
  /** מדווח ל-App על שינוי סטטוס רישיון, כדי שהגייט יגיב מיד */
  onLicenseChange?: (status: LicenseStatus) => void
}

function keyFlag(s: SettingsState | null, provider: AiProvider): boolean {
  return providerHasKey(s, provider)
}

export default function SettingsPage({
  settings,
  onSaved,
  runtimeEnv,
  runtimeChecking,
  onRecheckRuntime,
  onLicenseChange
}: Props) {
  const [tab, setTab] = useState<SettingsTab>('models')
  const [provider, setProvider] = useState<AiProvider>(settings?.defaultProvider ?? 'anthropic')
  const [model, setModel] = useState(settings?.defaultModel ?? getDefaultModel('anthropic'))
  const [agentEngine, setAgentEngine] = useState<AgentEngine>(settings?.agentEngine ?? 'legacy')
  const [keys, setKeys] = useState<Record<AiProvider, string>>({
    openai: '',
    anthropic: '',
    gemini: '',
    openrouter: '',
    ollama: '',
    lmstudio: ''
  })
  const [status, setStatus] = useState('')
  const [localFlags, setLocalFlags] = useState(settings)
  const [githubToken, setGithubToken] = useState('')
  /** חשבון Supabase ברמת האפליקציה — נטען פעם אחת בכניסה לטאב «חיבורים» */
  const [sbAccount, setSbAccount] = useState<{ connected: boolean; orgName?: string }>({
    connected: false
  })
  const [vercelToken, setVercelToken] = useState('')
  const [vercelTeamId, setVercelTeamId] = useState(settings?.vercelTeamId || '')
  const [platformToken, setPlatformToken] = useState('')
  const [platformTeamId, setPlatformTeamId] = useState(settings?.vercelPlatformTeamId || '')

  useEffect(() => {
    setLocalFlags(settings)
    if (settings) {
      setProvider(settings.defaultProvider)
      setModel(settings.defaultModel)
      setAgentEngine(settings.agentEngine ?? 'legacy')
      setVercelTeamId(settings.vercelTeamId || '')
      setPlatformTeamId(settings.vercelPlatformTeamId || '')
    }
  }, [settings])

  // מצב חשבון ה-Supabase נקרא מהתהליך הראשי (טוקן מוצפן) ולא מההגדרות,
  // ולכן הוא דורש קריאה משלו ולא מגיע עם `settings`
  useEffect(() => {
    window.nfblaze
      .supabaseAccountStatus()
      .then(setSbAccount)
      .catch(() => undefined)
  }, [])

  async function saveDefaults() {
    await window.nfblaze.setSettings({
      defaultProvider: provider,
      defaultModel: model,
      agentEngine
    })
    setStatus('ברירות המחדל נשמרו')
    await onSaved()
  }

  async function saveKey(p: AiProvider) {
    const value = keys[p].trim()
    if (!value) {
      setStatus('הזן מפתח לפני שמירה')
      return
    }
    const flags = await window.nfblaze.setApiKey(p, value)
    setKeys((k) => ({ ...k, [p]: '' }))
    setLocalFlags((prev) =>
      prev
        ? {
            ...prev,
            hasOpenaiKey: flags.hasOpenaiKey,
            hasAnthropicKey: flags.hasAnthropicKey,
            hasGeminiKey: flags.hasGeminiKey,
            hasOpenrouterKey: flags.hasOpenrouterKey
          }
        : prev
    )
    setStatus(`מפתח ${AI_PROVIDERS.find((x) => x.id === p)?.label} נשמר בצורה מוצפנת במחשב`)
    await onSaved()
  }

  async function removeKey(p: AiProvider) {
    if (!confirm('למחוק את מפתח ה-API מהמחשב?')) return
    const flags = await window.nfblaze.clearApiKey(p)
    setLocalFlags((prev) =>
      prev
        ? {
            ...prev,
            hasOpenaiKey: flags.hasOpenaiKey,
            hasAnthropicKey: flags.hasAnthropicKey,
            hasGeminiKey: flags.hasGeminiKey,
            hasOpenrouterKey: flags.hasOpenrouterKey
          }
        : prev
    )
    setStatus('המפתח נמחק')
    await onSaved()
  }

  return (
    <div className="settings-page">
      <h1>הגדרות</h1>
      <p className="sub">
        מפתחות API נשמרים מוצפנים במחשב שלך בלבד (Electron safeStorage). אין שרת חיצוני ואין מסד
        נתונים בענן.
      </p>

      {localFlags && localFlags.encryptionAvailable === false && (
        <div
          className="settings-card"
          style={{
            borderColor: 'var(--danger, #d33)',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start'
          }}
        >
          <TriangleAlert
            size={20}
            style={{ flexShrink: 0, marginTop: 2, color: 'var(--danger, #d33)' }}
          />
          <div>
            <strong>אין הצפנת מערכת הפעלה זמינה במחשב הזה</strong>
            <p className="desc" style={{ marginTop: 4 }}>
              המפתחות והטוקנים יישמרו כטקסט גלוי על הדיסק במקום מוצפנים. כל מי שיש לו גישה לקבצי
              המשתמש במחשב הזה יוכל לקרוא אותם. מומלץ לוודא ש-Keychain/Credential Manager/keyring
              פעילים במערכת ההפעלה לפני שמירת מפתחות רגישים.
            </p>
          </div>
        </div>
      )}

      <div className="seg-tabs settings-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`seg-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'system' && (
        <div className="settings-card">
          <h3>סביבת Node / npm</h3>
          <p className="desc">
            נדרש לבניית פרויקטים, התקנת תלויות ותצוגה חיה. אפשר גם לצרף Node לתיקיית{' '}
            <code dir="ltr">resources/runtime</code> בחבילת ההתקנה.
          </p>
          {runtimeEnv ? (
            <>
              <div className="key-status">
                <span className={`dot ${runtimeEnv.ok ? 'on' : ''}`} />
                {runtimeEnv.messageHe}
              </div>
              <div className="runtime-settings-meta" dir="ltr">
                <div>
                  מקור: {runtimeEnv.source === 'bundled' ? 'bundled' : runtimeEnv.source}
                  {runtimeEnv.bundledDir ? ` · ${runtimeEnv.bundledDir}` : ''}
                </div>
                <div>
                  Node {runtimeEnv.node.version || '—'} (min {runtimeEnv.minNode})
                </div>
                <div>npm {runtimeEnv.npm.version || '—'}</div>
                <div style={{ opacity: 0.7, fontSize: '0.75rem' }}>
                  נבדק: {new Date(runtimeEnv.checkedAt).toLocaleString('he-IL')}
                </div>
              </div>
              {!runtimeEnv.ok && runtimeEnv.instructionHe && (
                <p className="desc" style={{ marginTop: 8 }}>
                  {runtimeEnv.instructionHe}
                </p>
              )}
              <div className="folder-row" style={{ marginTop: 10 }}>
                <button
                  className="btn btn-ghost"
                  disabled={runtimeChecking}
                  onClick={() => onRecheckRuntime?.()}
                >
                  <RefreshCw size={16} />
                  {runtimeChecking ? 'בודק…' : 'בדיקה מחדש'}
                </button>
                {!runtimeEnv.ok && (
                  <button
                    className="btn btn-primary"
                    onClick={() => void window.nfblaze.openExternal(runtimeEnv.downloadUrl)}
                  >
                    <ExternalLink size={16} />
                    הורדת Node.js
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="desc">טוען סטטוס סביבה…</p>
          )}
        </div>
      )}

      {tab === 'system' && (
        <div className="settings-card">
          <h3>מנוע סוכן</h3>
          <p className="desc">
            חדש (ברירת מחדל) = לולאת כלים עם הגנות: אימות לפני כתיבה, תיקון TypeScript אוטומטי,
            בדיקת השלמה, תוכנית בנייה וזיכרון פרויקט. ישן = פורמט nfblaze הקודם.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>מנוע</label>
              <select
                className="select"
                value={agentEngine}
                onChange={(e) => setAgentEngine(e.target.value as AgentEngine)}
              >
                <option value="new">חדש (מומלץ)</option>
                <option value="legacy">ישן</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              style={{ alignSelf: 'start' }}
              onClick={saveDefaults}
            >
              שמור ברירות מחדל
            </button>
          </div>
        </div>
      )}

      {tab === 'models' && (
        <div className="settings-card">
          <h3>ברירת מחדל למודלים</h3>
          <p className="desc">יחול על פרויקטים חדשים. בכל פרויקט אפשר לשנות בנפרד.</p>
          <div className="form-grid">
            <div className="field">
              <label>ספק</label>
              <select
                className="select"
                value={provider}
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
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                {AI_PROVIDERS.find((p) => p.id === provider)?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary"
              style={{ alignSelf: 'start' }}
              onClick={saveDefaults}
            >
              שמור ברירות מחדל
            </button>
          </div>
        </div>
      )}

      {tab === 'models' &&
        AI_PROVIDERS.map((p) => (
          <div className="settings-card" key={p.id}>
            <h3>{p.label}</h3>
            <p className="desc">{p.description}</p>
            <div className="key-status">
              <span className={`dot ${keyFlag(localFlags, p.id) ? 'on' : ''}`} />
              {p.requiresKey === false
                ? 'לא נדרש מפתח — רץ מקומית'
                : keyFlag(localFlags, p.id)
                  ? 'מפתח מוגדר'
                  : 'לא הוגדר מפתח'}
              <a
                href={p.keyUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  marginInlineStart: 'auto',
                  color: 'var(--accent-hot)',
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  textDecoration: 'none'
                }}
                onClick={(e) => {
                  e.preventDefault()
                  window.open(p.keyUrl, '_blank')
                }}
              >
                {p.requiresKey === false ? 'הורד והתקן' : 'קבל מפתח'} <ExternalLink size={12} />
              </a>
            </div>
            {p.requiresKey !== false && (
              <div className="folder-row">
                <input
                  className="input"
                  type="password"
                  placeholder={p.keyPlaceholder}
                  value={keys[p.id]}
                  onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                  autoComplete="off"
                  style={{ direction: 'ltr', textAlign: 'left' }}
                />
                <button className="btn btn-primary" onClick={() => saveKey(p.id)}>
                  <KeyRound size={16} />
                  שמור
                </button>
                {keyFlag(localFlags, p.id) && (
                  <button className="btn btn-danger" onClick={() => removeKey(p.id)}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

      {tab === 'license' && <LicenseCard onChange={onLicenseChange} />}

      {tab === 'connections' && <McpServersCard />}

      {tab === 'connections' && (
        <div className="settings-card">
          <h3>
            <Github size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
            GitHub (חשבון)
          </h3>
          <p className="desc">
            חיבור החשבון תקף לכל הפרויקטים. אפשר לחבר גם מכפתור «חיבורים» בתוך פרויקט.
          </p>
          <div className="key-status">
            <span className={`dot ${localFlags?.hasGithubToken ? 'on' : ''}`} />
            {localFlags?.hasGithubToken ? 'חשבון GitHub מחובר' : 'לא מחובר'}
            <a
              href="https://github.com/settings/applications"
              style={{
                marginInlineStart: 'auto',
                color: 'var(--accent-hot)',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                textDecoration: 'none'
              }}
              onClick={(e) => {
                e.preventDefault()
                window.open('https://github.com/settings/applications', '_blank')
              }}
            >
              נהל הרשאות <ExternalLink size={12} />
            </a>
          </div>
          {!localFlags?.hasGithubToken && (
            <div style={{ marginBottom: 12 }}>
              <OAuthConnectButton
                provider="github"
                onConnected={(res) => {
                  setLocalFlags((p) => (p ? { ...p, hasGithubToken: true } : p))
                  setStatus(res.message)
                  void onSaved()
                }}
                onError={(m) => m && setStatus(m)}
              />
            </div>
          )}
          <p className="desc" style={{ marginBottom: 6, fontSize: '0.78rem' }}>
            חיבור ידני עם Personal Access Token (למי שאישור אפליקציות חסום אצלו):
          </p>
          <div className="folder-row">
            <input
              className="input"
              type="password"
              placeholder="github_pat_… או ghp_…"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              autoComplete="off"
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!githubToken.trim()) {
                  setStatus('הזן טוקן')
                  return
                }
                try {
                  const res = await window.nfblaze.setGithubToken(githubToken.trim())
                  setGithubToken('')
                  setLocalFlags((p) => (p ? { ...p, hasGithubToken: true } : p))
                  setStatus(`GitHub חובר: @${res.user.login}`)
                  await onSaved()
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              <KeyRound size={16} />
              שמור
            </button>
            {localFlags?.hasGithubToken && (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await window.nfblaze.clearGithubToken()
                  setLocalFlags((p) => (p ? { ...p, hasGithubToken: false } : p))
                  setStatus('טוקן GitHub נמחק')
                  await onSaved()
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {/*
       * Supabase ברמת החשבון. החיבור עצמו קיים מ-1.63.0 אבל הכרטיס נוסף
       * רק לפאנל של הפרויקט — כאן הוא היה חסר, בעוד GitHub ו-Vercel כן
       * הופיעו. חיבור פעם אחת כאן חוסך בחירת פרויקט ומפתחות בכל פרויקט חדש.
       */}
      {tab === 'connections' && (
        <div className="settings-card">
          <h3>
            <Database size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
            Supabase (חשבון)
          </h3>
          <p className="desc">
            חיבור החשבון תקף לכל הפרויקטים. אחרי החיבור בוחרים פרויקט מרשימה בתוך
            הפרויקט, והכתובת והמפתחות נמשכים אוטומטית — בלי להעתיק כלום.
          </p>
          <div className="key-status">
            <span className={`dot ${sbAccount.connected ? 'on' : ''}`} />
            {sbAccount.connected
              ? `חשבון Supabase מחובר${sbAccount.orgName ? ` · ${sbAccount.orgName}` : ''}`
              : 'לא מחובר'}
            <a
              href="https://supabase.com/dashboard/account/tokens"
              style={{
                marginInlineStart: 'auto',
                color: 'var(--accent-hot)',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                textDecoration: 'none'
              }}
              onClick={(e) => {
                e.preventDefault()
                void window.nfblaze.openExternal(
                  'https://supabase.com/dashboard/account/tokens'
                )
              }}
            >
              נהל הרשאות <ExternalLink size={12} />
            </a>
          </div>
          {!sbAccount.connected ? (
            <OAuthConnectButton
              provider="supabase"
              onConnected={async (res) => {
                setStatus(res.message)
                try {
                  setSbAccount(await window.nfblaze.supabaseAccountStatus())
                } catch {
                  setSbAccount({ connected: true })
                }
              }}
              onError={(m) => m && setStatus(m)}
            />
          ) : (
            <button
              className="btn btn-danger"
              onClick={async () => {
                await window.nfblaze.disconnectSupabaseAccount()
                setSbAccount({ connected: false })
                setStatus('חשבון Supabase נותק')
              }}
            >
              <Trash2 size={16} />
              נתק חשבון
            </button>
          )}
          <p className="desc" style={{ marginTop: 10, fontSize: '0.78rem' }}>
            לחיבור מסד ספציפי עם כתובת ומפתחות ידניים — «חיבורים» בתוך הפרויקט.
          </p>
        </div>
      )}

      {tab === 'connections' && (
        <div className="settings-card">
          <h3>
            <Globe size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
            Vercel — החשבון שלך (מסלול ב׳)
          </h3>
          <p className="desc">
            חיבור החשבון לפרסום ישיר לחשבון שלך. נשמר מוצפן ב־safeStorage.
          </p>
          <div className="key-status">
            <span className={`dot ${localFlags?.hasVercelToken ? 'on' : ''}`} />
            {localFlags?.hasVercelToken ? 'חשבון Vercel מחובר' : 'לא מחובר'}
            <a
              href="https://vercel.com/account/tokens"
              style={{
                marginInlineStart: 'auto',
                color: 'var(--accent-hot)',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                textDecoration: 'none'
              }}
              onClick={(e) => {
                e.preventDefault()
                window.open('https://vercel.com/account/tokens', '_blank')
              }}
            >
              צור token <ExternalLink size={12} />
            </a>
          </div>
          {!localFlags?.hasVercelToken && (
            <div style={{ marginBottom: 12 }}>
              <OAuthConnectButton
                provider="vercel"
                onConnected={(res) => {
                  setLocalFlags((p) => (p ? { ...p, hasVercelToken: true } : p))
                  setStatus(res.message)
                  void onSaved()
                }}
                onError={(m) => m && setStatus(m)}
              />
            </div>
          )}
          <p className="desc" style={{ marginBottom: 6, fontSize: '0.78rem' }}>
            חיבור ידני עם Personal Access Token:
          </p>
          <div className="folder-row">
            <input
              className="input"
              type="password"
              placeholder="vercel_…"
              value={vercelToken}
              onChange={(e) => setVercelToken(e.target.value)}
              autoComplete="off"
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!vercelToken.trim()) {
                  setStatus('הזן טוקן Vercel')
                  return
                }
                try {
                  const res = await window.nfblaze.setVercelToken(vercelToken.trim())
                  setVercelToken('')
                  setLocalFlags((p) => (p ? { ...p, hasVercelToken: true } : p))
                  setStatus(`Vercel חובר: @${res.user.username}`)
                  await onSaved()
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              <KeyRound size={16} />
              שמור
            </button>
            {localFlags?.hasVercelToken && (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await window.nfblaze.clearVercelToken()
                  setLocalFlags((p) => (p ? { ...p, hasVercelToken: false } : p))
                  setStatus('טוקן Vercel נמחק')
                  await onSaved()
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Team ID (אופציונלי — אם מפרסמים לצוות)</label>
            <div className="folder-row">
              <input
                className="input"
                placeholder="team_…"
                value={vercelTeamId}
                onChange={(e) => setVercelTeamId(e.target.value)}
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
              <button
                className="btn"
                onClick={async () => {
                  await window.nfblaze.setSettings({ vercelTeamId: vercelTeamId.trim() })
                  setStatus('Team ID נשמר')
                  await onSaved()
                }}
              >
                שמור Team
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'connections' && (
        <div className="settings-card">
          <h3>
            <Globe size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
            Vercel מארח — פרסום מיידי (מסלול א׳)
          </h3>
          <p className="desc">
            טוקן + Team ID של צוות המארח מאפשרים «פרסום עכשיו בלי חשבון» עם קישור Claim. אפשר גם
            להגדיר דרך משתני סביבה NF_BLAZE_VERCEL_TOKEN ו־NF_BLAZE_VERCEL_TEAM_ID.
          </p>
          <div className="key-status">
            <span className={`dot ${localFlags?.hasVercelPlatformToken ? 'on' : ''}`} />
            {localFlags?.hasVercelPlatformToken ? 'טוקן מארח מוגדר' : 'לא הוגדר טוקן מארח'}
          </div>
          <div className="field">
            <label>Team ID מארח</label>
            <input
              className="input"
              placeholder="team_…"
              value={platformTeamId}
              onChange={(e) => setPlatformTeamId(e.target.value)}
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
          </div>
          <div className="folder-row">
            <input
              className="input"
              type="password"
              placeholder="טוקן מארח…"
              value={platformToken}
              onChange={(e) => setPlatformToken(e.target.value)}
              autoComplete="off"
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!platformToken.trim() || !platformTeamId.trim()) {
                  setStatus('הזן טוקן מארח ו-Team ID')
                  return
                }
                try {
                  await window.nfblaze.setVercelPlatform({
                    token: platformToken.trim(),
                    teamId: platformTeamId.trim()
                  })
                  setPlatformToken('')
                  setLocalFlags((p) => (p ? { ...p, hasVercelPlatformToken: true } : p))
                  setStatus('טוקן מארח נשמר')
                  await onSaved()
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              <KeyRound size={16} />
              שמור מארח
            </button>
            {localFlags?.hasVercelPlatformToken && (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await window.nfblaze.clearVercelPlatform()
                  setPlatformTeamId('')
                  setLocalFlags((p) => (p ? { ...p, hasVercelPlatformToken: false } : p))
                  setStatus('טוקן מארח נמחק')
                  await onSaved()
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {status && (
        <div style={{ color: 'var(--success)', marginTop: 8, fontSize: '0.9rem' }}>{status}</div>
      )}
    </div>
  )
}
