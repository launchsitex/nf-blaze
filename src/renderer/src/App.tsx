import { useEffect, useState } from 'react'
import type { AiProvider, ChatMessage, FileNode, ProjectMeta } from '@shared/types'
import { AI_PROVIDERS, getDefaultModel, getProvider } from '@shared/types'
import HomePage from './pages/HomePage'
import WorkspacePage from './pages/WorkspacePage'
import ProjectOverviewPage from './pages/ProjectOverviewPage'
import OnboardingModal from './components/OnboardingModal'
import LicenseGate from './components/LicenseGate'
import type { LicenseStatus } from '@shared/license'
import SettingsPage from './pages/SettingsPage'
import NewProjectModal from './components/NewProjectModal'
import RuntimeGate, { type RuntimeEnvInfo } from './components/RuntimeGate'
import { Flame, FolderOpen, Settings, ArrowRight } from 'lucide-react'

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
  const [loading, setLoading] = useState(true)
  const [runtimeEnv, setRuntimeEnv] = useState<RuntimeEnvInfo | null>(null)
  const [runtimeChecking, setRuntimeChecking] = useState(false)
  const [appVersion, setAppVersion] = useState('')

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
    const [p, s, env] = await Promise.all([
      window.nfblaze.listProjects(),
      window.nfblaze.getSettings(),
      window.nfblaze.getRuntimeEnv(false)
    ])
    setProjects(p)
    setSettings(s)
    setRuntimeEnv(env)
    setLoading(false)
  }

  useEffect(() => {
    refresh().catch(console.error)
    window.nfblaze.getAppVersion().then(setAppVersion).catch(console.error)
    window.nfblaze.getLicenseStatus().then(setLicense).catch(console.error)
  }, [])

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
        {loading ? (
          <div className="preview-empty">טוען…</div>
        ) : license && !license.ok ? (
          <LicenseGate status={license} onActivated={setLicense} />
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
