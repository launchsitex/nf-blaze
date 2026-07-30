import { useEffect, useState } from 'react'
import type { AiProvider, AgentEngine } from '@shared/types'
import { AI_PROVIDERS, getDefaultModel, providerHasKey } from '@shared/types'
import { ExternalLink, Github, Globe, KeyRound, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import type { RuntimeEnvInfo } from '../components/RuntimeGate'
import McpServersCard from '../components/McpServersCard'
import LicenseCard from '../components/LicenseCard'

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
}

function keyFlag(s: SettingsState | null, provider: AiProvider): boolean {
  return providerHasKey(s, provider)
}

export default function SettingsPage({
  settings,
  onSaved,
  runtimeEnv,
  runtimeChecking,
  onRecheckRuntime
}: Props) {
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
        מפתחות API נשמרים מוצפנים במחשב שלך בלבד (Electron safeStorage). אין שרת חיצוני ואין
        מסד נתונים בענן.
      </p>

      {localFlags && localFlags.encryptionAvailable === false && (
        <div
          className="settings-card"
          style={{ borderColor: 'var(--danger, #d33)', display: 'flex', gap: 10, alignItems: 'flex-start' }}
        >
          <TriangleAlert size={20} style={{ flexShrink: 0, marginTop: 2, color: 'var(--danger, #d33)' }} />
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
              <div>Node {runtimeEnv.node.version || '—'} (min {runtimeEnv.minNode})</div>
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

      <div className="settings-card">
        <h3>מנוע סוכן</h3>
        <p className="desc">
          חדש (ברירת מחדל) = לולאת כלים עם הגנות: אימות לפני כתיבה, תיקון TypeScript אוטומטי, בדיקת
          השלמה, תוכנית בנייה וזיכרון פרויקט. ישן = פורמט nfblaze הקודם.
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
          <button className="btn btn-primary" style={{ alignSelf: 'start' }} onClick={saveDefaults}>
            שמור ברירות מחדל
          </button>
        </div>
      </div>

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
          <button className="btn btn-primary" style={{ alignSelf: 'start' }} onClick={saveDefaults}>
            שמור ברירות מחדל
          </button>
        </div>
      </div>

      {AI_PROVIDERS.map((p) => (
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

      <LicenseCard />

      <McpServersCard />

      <div className="settings-card">
        <h3>
          <Github size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
          GitHub (חשבון)
        </h3>
        <p className="desc">
          Personal Access Token גלובלי לחיבור ריפוזים מתוך הפרויקטים. אפשר גם לחבר מתוך כפתור
          החיבורים בכל פרויקט.
        </p>
        <div className="key-status">
          <span className={`dot ${localFlags?.hasGithubToken ? 'on' : ''}`} />
          {localFlags?.hasGithubToken ? 'טוקן GitHub מוגדר' : 'לא הוגדר טוקן'}
          <a
            href="https://github.com/settings/tokens?type=beta"
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
              window.open('https://github.com/settings/tokens?type=beta', '_blank')
            }}
          >
            צור token <ExternalLink size={12} />
          </a>
        </div>
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

      <div className="settings-card">
        <h3>
          <Globe size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
          Vercel — החשבון שלך (מסלול ב׳)
        </h3>
        <p className="desc">
          Personal Access Token מ-Vercel לפרסום ישיר לחשבון שלך. נשמר מוצפן ב־safeStorage.
        </p>
        <div className="key-status">
          <span className={`dot ${localFlags?.hasVercelToken ? 'on' : ''}`} />
          {localFlags?.hasVercelToken ? 'טוקן Vercel מוגדר' : 'לא הוגדר טוקן'}
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

      {status && (
        <div style={{ color: 'var(--success)', marginTop: 8, fontSize: '0.9rem' }}>{status}</div>
      )}
    </div>
  )
}
