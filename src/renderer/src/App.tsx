import { useEffect, useRef, useState } from 'react'
import type { AiProvider, ChatMessage, FileNode, ProjectMeta } from '@shared/types'
import { AI_PROVIDERS, getDefaultModel, getProvider } from '@shared/types'
import HomePage from './pages/HomePage'
import WorkspacePage from './pages/WorkspacePage'
import ProjectOverviewPage from './pages/ProjectOverviewPage'
import OnboardingModal from './components/OnboardingModal'
import LicenseGate from './components/LicenseGate'
import LicenseExpiryModal from './components/LicenseExpiryModal'
import UpdateGate from './components/UpdateGate'
import UpdateBanner from './components/UpdateBanner'
import WhatsNewModal from './components/WhatsNewModal'
import type { LicenseStatus } from '@shared/license'
import type { UpdateState } from '@shared/version'
import { compareVersions } from '@shared/version'
import { notesSince, type ReleaseNote } from '@shared/release_notes'
import SettingsPage from './pages/SettingsPage'
import NewProjectModal from './components/NewProjectModal'
import RuntimeGate, { type RuntimeEnvInfo } from './components/RuntimeGate'
import HelpModal from './components/HelpModal'
import FeedbackModal from './components/FeedbackModal'
import { Flame, FolderOpen, Settings, ArrowRight, CircleHelp, MessageSquare } from 'lucide-react'

type View = 'home' | 'project' | 'workspace' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [activeProject, setActiveProject] = useState<ProjectMeta | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [settings, setSettings] = useState<{
    defaultProvider: AiProvider
    defaultModel: string
    agentEngine?: 'legacy' | 'new'
    hasOpenaiKey: boolean
    hasAnthropicKey: boolean
    hasGeminiKey: boolean
    hasOpenrouterKey?: boolean
    onboardingSeen?: boolean
  } | null>(null)
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const [expiryWarn, setExpiryWarn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [runtimeEnv, setRuntimeEnv] = useState<RuntimeEnvInfo | null>(null)
  const [runtimeChecking, setRuntimeChecking] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [whatsNew, setWhatsNew] = useState<ReleaseNote[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  // האם המשתמש היה מורשה ברגע קודם — כדי לזהות תפוגה חיה ולרענן את המצב
  const wasLicensedRef = useRef(false)

  async function refreshRuntime(force = false): Promise<RuntimeEnvInfo> {
    setRuntimeChecking(true)
    try {
      const env = await window.nfblaze.getRuntimeEnv(force)
      setRuntimeEnv(env)
      return env
    } finally {
      setRuntimeChecking(false)
    }
  }

  async function refresh() {
    const [s, env] = await Promise.all([
      window.nfblaze.getSettings(),
      window.nfblaze.getRuntimeEnv(false)
    ])
    setSettings(s)
    setRuntimeEnv(env)
    // רשימת הפרויקטים חסומה בתהליך הראשי בלי רישיון — כשל כאן אינו שגיאה,
    // הוא המצב התקין של «אין רישיון», ואסור שישאיר את המסך ב«טוען…».
    try {
      setProjects(await window.nfblaze.listProjects())
    } catch {
      setProjects([])
    }
    setLoading(false)
  }

  /**
   * מחיל סטטוס רישיון טרי במקום אחד: מנהל את הפופ-אפ «נשאר יום אחד»,
   * ומזהה מעבר חי מ«מורשה» ל«לא מורשה» (תפוגה בזמן אמת או הסרת רישיון)
   * כדי לנקות מצב תלוי-רישיון. הגייט עצמו מונע מ-license.ok ב-render.
   */
  function applyLicense(next: LicenseStatus): void {
    setLicense(next)

    if (next.ok) {
      wasLicensedRef.current = true
      // אזהרת «12 שעות אחרונות» — פעם אחת לכל תאריך תפוגה (נשמר ב-localStorage
      // כדי לא לקפוץ בכל בדיקה חוזרת ולא בכל הפעלה מחדש של האפליקציה).
      if (next.warnExpirySoon && next.expiresAt) {
        if (localStorage.getItem(`nfb-expiry-warned:${next.expiresAt}`) !== '1') {
          setExpiryWarn(true)
        }
      } else if (!next.warnExpirySoon) {
        setExpiryWarn(false)
      }
    } else {
      setExpiryWarn(false)
      // היינו מורשים וכעת לא — תפוגה חיה או הסרה. מנקים מצב תלוי-רישיון
      // ומחזירים הביתה; הגייט יופיע אוטומטית.
      if (wasLicensedRef.current) {
        wasLicensedRef.current = false
        setProjects([])
        setActiveProject(null)
        setView('home')
      }
    }
  }

  async function recheckLicense(): Promise<void> {
    try {
      applyLicense(await window.nfblaze.getLicenseStatus())
    } catch {
      /* getLicenseStatus הוא ערוץ פנוי-רישיון; כשל פנימי לא אמור לחסום */
    }
  }

  useEffect(() => {
    // סטטוס הרישיון נטען ראשון — הוא מה שקובע אם בכלל מציגים את המערכת
    window.nfblaze
      .getLicenseStatus()
      .then(applyLicense)
      .catch(() => setLicense(null))
      .finally(() => {
        refresh().catch(() => setLoading(false))
      })
    // אימות מקוון בעלייה — מרענן עוגן זמן אמין ותופס ביטול מרחוק מיד
    window.nfblaze.revalidateLicense().then(applyLicense).catch(() => undefined)
    window.nfblaze.getAppVersion().then(setAppVersion).catch(console.error)
  }, [])

  useEffect(() => {
    // בדיקה חיה: תפוגה בזמן אמת חייבת להחזיר למסך הרישיון גם בלי פעולה של
    // המשתמש. המקור לאמת הוא התהליך הראשי (getLicenseStatus, עם הגנת שעון),
    // ושכבת ה-IPC ממילא חוסמת כל פעולה אחרי תפוגה — הבדיקה כאן היא ל-UX.
    const POLL_MS = 30_000
    const id = window.setInterval(() => void recheckLicense(), POLL_MS)

    /*
     * חזרה לחלון (או יציאה משינה) מריצה **אימות מקוון** ולא רק קריאת סטטוס.
     * מ-1.66.0 חלון החסד הוא 15 דקות, ומחשב שהיה במצב שינה חצי שעה יתעורר
     * אל מעבר לחלון — בלי זה המשתמש היה רואה את מסך «נדרש אימות מקוון»
     * למרות שיש לו רשת תקינה, ונאלץ ללחוץ «בדוק שוב» ידנית.
     * ה-throttle מונע פנייה לשרת בכל מזעור/שחזור של החלון.
     */
    let lastRevalidateAt = Date.now()
    const REVALIDATE_MIN_GAP_MS = 60_000
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRevalidateAt > REVALIDATE_MIN_GAP_MS) {
        lastRevalidateAt = Date.now()
        window.nfblaze.revalidateLicense().then(applyLicense).catch(() => void recheckLicense())
        return
      }
      void recheckLicense()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // מצב העדכון מגיע גם בדחיפה מהתהליך הראשי (התקדמות הורדה) וגם
    // בבדיקה יזומה בחזרה לחלון — כך גרסה חדשה נתפסת «חי» ולא בהמתנה.
    let alive = true
    window.nfblaze
      .updateStatus()
      .then((s) => alive && setUpdate(s))
      .catch(() => undefined)

    const off = window.nfblaze.onUpdateEvent((s) => alive && setUpdate(s))
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        window.nfblaze
          .updateCheck()
          .then((s) => alive && setUpdate(s))
          .catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      off()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    // «מה חדש» — פעם אחת אחרי שהגרסה התחלפה, ורק כשהמערכת פתוחה בפועל
    if (!appVersion || !license?.ok) return
    let alive = true
    window.nfblaze
      .getSeenVersion()
      .then((seen) => {
        if (!alive || seen === appVersion) return
        const notes = notesSince(seen || undefined, appVersion, compareVersions)
        if (notes.length) setWhatsNew(notes)
        return window.nfblaze.setSeenVersion(appVersion)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [appVersion, license?.ok])

  async function openProject(project: ProjectMeta) {
    if (runtimeEnv && !runtimeEnv.ok) return
    setActiveProject(project)
    setView('project')
    void window.nfblaze.ensureProjectIndex(project.id).catch(console.error)
  }

  async function handleCreated(project: ProjectMeta) {
    setShowNew(false)
    await refresh()
    setActiveProject(project)
    setView('workspace')
    void window.nfblaze.ensureProjectIndex(project.id).catch(console.error)
  }

  const runtimeBlocked = Boolean(runtimeEnv && !runtimeEnv.ok)
  const canBuild = !runtimeBlocked

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">NF</div>
          <div>
            <div className="brand-name">NF-Blaze</div>
            <div className="brand-tag">בונה מערכות מקומי · AI{appVersion ? ` · v${appVersion}` : ''}</div>
          </div>
        </div>
        <div className="topbar-actions">
          {update && <UpdateBanner state={update} />}
          {license?.ok && license.name && (
            <span
              className="welcome-name"
              title={
                license.expiresAt ? `רישיון בתוקף עד ${license.expiresAt}` : 'רישיון ללא הגבלת זמן'
              }
            >
              ברוך הבא {license.name}
            </span>
          )}
          {view === 'workspace' && (
            <button className="btn btn-ghost" onClick={() => setView('home')}>
              <ArrowRight size={16} />
              כל הפרויקטים
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setView('home')}>
            <FolderOpen size={16} />
            בית
          </button>
          {/* שניהם זמינים תמיד — גם לפני הפעלת רישיון. מי שתקוע בשער הרישיון
              צריך גם להבין מה המערכת עושה, וגם דרך לבקש רישיון או חידוש;
              בלי זה המצב שבו הוא הכי צריך אותנו הוא בדיוק המצב שבו הוא לא
              יכול לפנות. פנייה בלי מפתח חתום מסומנת בפורטל «לא מאומתת». */}
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setShowHelp(true)}
            title="מרכז העזרה — מידע על הגרסה ומדריך שימוש"
            aria-label="מרכז העזרה"
          >
            <CircleHelp size={17} />
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setShowFeedback(true)}
            title={
              license?.ok
                ? 'שליחת משוב או דיווח על תקלה'
                : 'משוב, דיווח על תקלה, או בקשת רישיון'
            }
          >
            <MessageSquare size={16} />
            משוב
          </button>
          <button className="btn btn-ghost" onClick={() => setView('settings')}>
            <Settings size={16} />
            הגדרות
          </button>
          <button
            className="btn btn-primary"
            disabled={!canBuild}
            title={canBuild ? undefined : 'יש להתקין Node.js לפני יצירת פרויקט'}
            onClick={() => canBuild && setShowNew(true)}
          >
            <Flame size={16} />
            פרויקט חדש
          </button>
        </div>
      </header>

      <main className="main-view">
        {/* עדכון חובה קודם לכל שאר המסכים — כולל מסך הרישיון */}
        {update?.required ? (
          <UpdateGate state={update} onSnoozed={setUpdate} />
        ) : loading ? (
          <div className="preview-empty">טוען…</div>
        ) : license && !license.ok ? (
          <LicenseGate
            status={license}
            onActivated={(next) => {
              applyLicense(next)
              // הפרויקטים לא נטענו כשהיינו חסומים — טוענים עכשיו, אחרת
              // המשתמש רואה רשימה ריקה עד להפעלה מחדש
              if (next.ok) void refresh().catch(console.error)
            }}
          />
        ) : runtimeBlocked && view !== 'settings' ? (
          <RuntimeGate
            env={runtimeEnv!}
            checking={runtimeChecking}
            onRecheck={() => void refreshRuntime(true)}
            onOpenSettings={() => setView('settings')}
          />
        ) : view === 'home' ? (
          <HomePage
            projects={projects}
            onOpen={openProject}
            onNew={() => canBuild && setShowNew(true)}
            onDelete={async (id) => {
              await window.nfblaze.deleteProject(id)
              await refresh()
            }}
          />
        ) : view === 'settings' ? (
          <SettingsPage
            settings={settings}
            onSaved={refresh}
            runtimeEnv={runtimeEnv}
            runtimeChecking={runtimeChecking}
            onRecheckRuntime={() => void refreshRuntime(true)}
            onLicenseChange={applyLicense}
          />
        ) : view === 'project' && activeProject ? (
          <ProjectOverviewPage
            project={activeProject}
            onOpenChat={() => setView('workspace')}
            onProjectUpdate={(p) => {
              setActiveProject(p)
              refresh()
            }}
          />
        ) : activeProject && canBuild ? (
          <WorkspacePage
            project={activeProject}
            onProjectUpdate={(p) => {
              setActiveProject(p)
              refresh()
            }}
            settings={settings}
            onOpenOverview={() => setView('project')}
          />
        ) : (
          <RuntimeGate
            env={runtimeEnv!}
            checking={runtimeChecking}
            onRecheck={() => void refreshRuntime(true)}
            onOpenSettings={() => setView('settings')}
          />
        )}
      </main>

      {whatsNew.length > 0 && !update?.required && (
        <WhatsNewModal notes={whatsNew} onClose={() => setWhatsNew([])} />
      )}

      {showHelp && (
        <HelpModal
          appVersion={appVersion}
          license={license}
          onOpenFeedback={() => setShowFeedback(true)}
          onClose={() => setShowHelp(false)}
        />
      )}

      {showFeedback && (
        <FeedbackModal
          appVersion={appVersion}
          license={license}
          onClose={() => setShowFeedback(false)}
        />
      )}

      {expiryWarn && license?.ok && (
        <LicenseExpiryModal
          status={license}
          onClose={() => {
            if (license.expiresAt) {
              localStorage.setItem(`nfb-expiry-warned:${license.expiresAt}`, '1')
            }
            setExpiryWarn(false)
          }}
        />
      )}

      {!loading && settings && settings.onboardingSeen === false && (
        <OnboardingModal
          onFinish={() => {
            void window.nfblaze
              .setSettings({ onboardingSeen: true })
              .then(() => refresh())
              .catch(console.error)
            setSettings((s) => (s ? { ...s, onboardingSeen: true } : s))
          }}
        />
      )}
      {showNew && canBuild && (
        <NewProjectModal
          defaultProvider={settings?.defaultProvider ?? 'anthropic'}
          defaultModel={settings?.defaultModel ?? getDefaultModel('anthropic')}
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

export type { ChatMessage, FileNode, ProjectMeta, AiProvider }
export { AI_PROVIDERS, getProvider, getDefaultModel }
