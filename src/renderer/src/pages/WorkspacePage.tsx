import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiProvider, ChatMessage, ChatsIndex, FileNode, ProjectMeta, ProjectIndexInfo, ProjectPlan, WorkModeSelection, WorkMode, PreviewElementSelection, SnapshotSummary } from '@shared/types'
import { AI_PROVIDERS, getProvider, providerHasKey, QUICK_PROMPTS } from '@shared/types'
import FileTree from '../components/FileTree'
import MarkdownMessage from '../components/MarkdownMessage'
import CodeEditor from '../components/CodeEditor'
import {
  ArrowUpRight,
  Code2,
  Eraser,
  Eye,
  FolderOpen,
  MousePointer2,
  Package,
  PlugZap,
  RefreshCw,
  Rocket,
  Save,
  Check,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  GitCompare,
  History,
  LayoutDashboard,
  Monitor,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import IntegrationsPanel from '../components/IntegrationsPanel'
import ContextUsageMeter from '../components/ContextUsageMeter'
import ClarifyCard from '../components/ClarifyCard'
import ChangesDiffModal from '../components/ChangesDiffModal'
import { DEVICE_PRESETS, getDevicePreset } from '../lib/devices'
import type { ContextUsage } from '@shared/context'

function workModeLabel(mode?: WorkMode, source?: 'manual' | 'auto'): string {
  const name = mode === 'ASK' ? 'שאלה' : mode === 'PLAN' ? 'תכנון' : mode === 'BUILD' ? 'ביצוע' : ''
  if (!name) return ''
  return source === 'auto' ? `אוטומטי · ${name}` : name
}

interface Props {
  project: ProjectMeta
  onProjectUpdate: (p: ProjectMeta) => void
  /** חזרה למסך הפרויקט (שם, GitHub, Supabase) */
  onOpenOverview?: () => void
  settings: {
    hasOpenaiKey: boolean
    hasAnthropicKey: boolean
    hasGeminiKey: boolean
    hasOpenrouterKey?: boolean
  } | null
}

type PreviewMode = 'preview' | 'code' | 'security' | 'tests'

interface SecurityScanState {
  running: boolean
  scannedAt: string | null
  report: {
    ok: boolean
    blocked: boolean
    findings: Array<{
      id: string
      severity: 'block' | 'warn'
      title: string
      found: string
      why: string
      fixHint?: string
      path?: string
    }>
    summaryHebrew: string
  } | null
  error: string
}
type BottomTab = 'terminal' | 'console' | 'problems'

/** תקרת שורות בפאנלי טרמינל/קונסול — הצטברות אינסופית תוקעת את ה-UI */
const MAX_PANEL_LINES = 400

/** Debounced stop so React Strict Mode remount does not kill a warm preview */
const pendingPreviewStops = new Map<string, ReturnType<typeof setTimeout>>()

function cancelPendingPreviewStop(projectId: string): void {
  const t = pendingPreviewStops.get(projectId)
  if (!t) return
  clearTimeout(t)
  pendingPreviewStops.delete(projectId)
}

function schedulePreviewStop(projectId: string): void {
  cancelPendingPreviewStop(projectId)
  const t = setTimeout(() => {
    pendingPreviewStops.delete(projectId)
    void window.nfblaze.stopLivePreview(projectId)
  }, 800)
  pendingPreviewStops.set(projectId, t)
}

export default function WorkspacePage({ project, onProjectUpdate, onOpenOverview, settings }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [provider, setProvider] = useState<AiProvider>(project.provider)
  const [model, setModel] = useState(project.model)
  const [tree, setTree] = useState<FileNode[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(project.lastPreviewFile || null)
  const [fileContent, setFileContent] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<PreviewMode>('preview')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [liveStatus, setLiveStatus] = useState('')
  const [liveText, setLiveText] = useState('')
  // טוקנים נערמים ב-ref ונחשפים בהדרגה (מכונת כתיבה) — שפיכת כל הצבר במכה
  // אחת נראתה רובוטית, ועדכון state לכל טוקן בנפרד גרם לתקיעות UI
  const liveTextRef = useRef('')
  const liveShownRef = useRef(0)
  const liveTickTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  // ההודעה הסופית כבר נטענה לרשימה — הבועה החיה מוסתרת באותו רנדר (בלי פריים כפול)
  const [liveReplaced, setLiveReplaced] = useState(false)
  const [liveFiles, setLiveFiles] = useState<string[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<SnapshotSummary[]>([])
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [diffSnapshotId, setDiffSnapshotId] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<string[]>([])
  const [shellBusy, setShellBusy] = useState(false)
  // פאנל תחתון — טרמינל אינטראקטיבי / קונסול / בעיות
  const [bottomTab, setBottomTab] = useState<BottomTab>('console')
  const [bottomCollapsed, setBottomCollapsed] = useState(false)
  const [shellLines, setShellLines] = useState<string[]>([])
  const [shellInput, setShellInput] = useState('')
  const shellRef = useRef<HTMLDivElement | null>(null)
  const shellInputRef = useRef<HTMLInputElement | null>(null)
  // טיימר «עובד כבר X» — שהמשתמש יראה שהסוכן חי גם בכתיבת קבצים ארוכים
  const [workElapsed, setWorkElapsed] = useState(0)
  useEffect(() => {
    if (!sending) {
      setWorkElapsed(0)
      return
    }
    const start = Date.now()
    const t = setInterval(() => setWorkElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [sending])

  // ריבוי צ'אטים לפרויקט
  const [chats, setChats] = useState<ChatsIndex | null>(null)
  const [chatOpsBusy, setChatOpsBusy] = useState(false)
  // טאב אבטחה + טאב בדיקות
  const [secScan, setSecScan] = useState<SecurityScanState>({
    running: false,
    scannedAt: null,
    report: null,
    error: ''
  })
  const [testsLines, setTestsLines] = useState<string[]>([])
  const [testsRunning, setTestsRunning] = useState(false)
  const [testsResult, setTestsResult] = useState<'pass' | 'fail' | null>(null)
  const testsRef = useRef<HTMLDivElement | null>(null)
  // תצוגת מכשירים — desktop / דגם טלפון / טאבלט
  const [deviceId, setDeviceId] = useState('desktop')
  const [landscape, setLandscape] = useState(false)
  const [deviceScale, setDeviceScale] = useState(1)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [showIntegrations, setShowIntegrations] = useState(false)
  const [vercelUrl, setVercelUrl] = useState<string | null>(null)
  const [redeployBusy, setRedeployBusy] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [pickedElements, setPickedElements] = useState<PreviewElementSelection[]>([])
  // refs עבור מאזין ה-message (נרשם פעם אחת) — בלי זה נתפס state ישן
  const pickedElementsRef = useRef<PreviewElementSelection[]>([])
  const selectModeRef = useRef(false)
  const [livePreviewBusy, setLivePreviewBusy] = useState(false)
  const [previewPhase, setPreviewPhase] = useState<
    'idle' | 'installing' | 'starting' | 'ready' | 'fallback' | 'error' | 'crashed'
  >('idle')
  const [previewStatusMsg, setPreviewStatusMsg] = useState('')
  const [previewServeMode, setPreviewServeMode] = useState<'live' | 'fallback' | 'static' | null>(
    null
  )
  const [previewErrorText, setPreviewErrorText] = useState('')
  const [previewLogTail, setPreviewLogTail] = useState<string[]>([])
  /** Runtime errors reported from inside the preview iframe (window.onerror) */
  const [runtimeErrors, setRuntimeErrors] = useState<{ message: string; source: string }[]>([])
  /** תוכנית בנייה בשלבים — נטענת מ-.nf-blaze/plan.json ומתעדכנת אחרי כל סבב */
  const [plan, setPlan] = useState<ProjectPlan | null>(null)
  /** Vite / package.json scripts.dev — live server, never static nfblaze HTML */
  const [isDevProject, setIsDevProject] = useState(false)
  const livePreviewUrlRef = useRef<string | null>(null)
  /**
   * הכתובת שאפשר לפתוח בדפדפן חיצוני. תצוגה סטטית רצה על סכימת `nfblaze://`
   * הפנימית, ש-`openExternal` דוחה (הוא מאשר http/https בלבד) — ולכן היא
   * מסוננת כאן ולא בנקודת הלחיצה.
   */
  const externalPreviewUrl =
    previewUrl && /^https?:\/\//i.test(previewUrl) ? previewUrl : null
  const [projectCheck, setProjectCheck] = useState<{
    status: 'idle' | 'checking' | 'passed' | 'failed' | 'timeout' | 'cancelled'
    kind?: 'tsc' | 'build'
    errorCount?: number
    message?: string
  }>({ status: 'idle' })
  const [browserQa, setBrowserQa] = useState<{
    phase: 'idle' | 'start' | 'action' | 'passed' | 'failed' | 'skipped' | 'error'
    attempt?: number
    message?: string
    action?: string
    url?: string
  }>({ phase: 'idle' })
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [projectIndex, setProjectIndex] = useState<ProjectIndexInfo | null>(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [workModeSel, setWorkModeSel] = useState<WorkModeSelection>('auto')
  const [lastResolvedMode, setLastResolvedMode] = useState<WorkMode | null>(null)
  const [pendingBuildPrompt, setPendingBuildPrompt] = useState<string | null>(null)
  const [modeBlockedWrites, setModeBlockedWrites] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const openFileRef = useRef<(path: string) => Promise<void>>(async () => undefined)
  const lastPreviewPhaseRef = useRef<string | null>(null)

  const models = useMemo(() => getProvider(provider).models, [provider])

  /** מונה בעיות לפאנל התחתון — שגיאות ריצה + שגיאת קומפילציה/קריסה */
  const problemsCount =
    runtimeErrors.length +
    (previewErrorText && (previewPhase === 'error' || previewPhase === 'crashed') ? 1 : 0)

  // גלילה אוטומטית לתחתית הטרמינל האינטראקטיבי
  useEffect(() => {
    shellRef.current?.scrollTo({ top: shellRef.current.scrollHeight })
  }, [shellLines])

  // פוקוס אוטומטי לשורת הפקודה כשפותחים את הטרמינל וכשפקודה מסתיימת
  useEffect(() => {
    if (bottomTab === 'terminal' && !bottomCollapsed && !shellBusy) {
      shellInputRef.current?.focus()
    }
  }, [bottomTab, bottomCollapsed, shellBusy])

  // חישוב סקייל למסגרת המכשיר — נכנס כולו לשטח התצוגה
  useEffect(() => {
    if (deviceId === 'desktop') {
      setDeviceScale(1)
      return
    }
    const el = stageRef.current
    const preset = getDevicePreset(deviceId)
    if (!el || !preset) return
    const w = (landscape ? preset.height : preset.width) + 20
    const h = (landscape ? preset.width : preset.height) + 20
    const compute = (): void => {
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const scale = Math.min(1, (rect.width - 40) / w, (rect.height - 40) / h)
      setDeviceScale(scale > 0.1 ? scale : 0.1)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [deviceId, landscape, previewUrl, mode])

  const hasKey = useCallback((p: AiProvider) => providerHasKey(settings, p), [settings])

  const refreshTree = useCallback(async () => {
    const t = await window.nfblaze.getFileTree(project.id)
    setTree(t)
  }, [project.id])

  const loadChat = useCallback(async () => {
    const chat = await window.nfblaze.getChat(project.id)
    setMessages(chat.messages)
  }, [project.id])

  const stopLiveTicker = useCallback(() => {
    if (liveTickTimer.current) {
      clearInterval(liveTickTimer.current)
      liveTickTimer.current = null
    }
  }, [])

  const ensureLiveTicker = useCallback(() => {
    if (liveTickTimer.current) return
    liveTickTimer.current = setInterval(() => {
      const target = liveTextRef.current
      if (liveShownRef.current >= target.length) {
        stopLiveTicker()
        return
      }
      // מדביק את הפיגור בהדרגה — מהיר כשמאחור, עדין כשקרוב
      const backlog = target.length - liveShownRef.current
      const step = Math.max(2, Math.ceil(backlog / 10))
      liveShownRef.current = Math.min(target.length, liveShownRef.current + step)
      setLiveText(target.slice(0, liveShownRef.current))
    }, 50)
  }, [stopLiveTicker])

  useEffect(() => stopLiveTicker, [stopLiveTicker])

  const refreshVercelMeta = useCallback(async () => {
    try {
      const i = await window.nfblaze.getIntegrations(project.id)
      setVercelUrl(i.vercel?.url || null)
    } catch {
      setVercelUrl(null)
    }
  }, [project.id])

  const refreshUndo = useCallback(async () => {
    setCanUndo(await window.nfblaze.canUndo(project.id))
  }, [project.id])

  const refreshPlan = useCallback(async () => {
    try {
      setPlan(await window.nfblaze.getProjectPlan(project.id))
    } catch {
      /* plan is optional */
    }
  }, [project.id])

  useEffect(() => {
    refreshTree().catch(console.error)
    loadChat().catch(console.error)
    refreshUndo().catch(console.error)
    refreshVercelMeta().catch(console.error)
    refreshPlan().catch(console.error)
  }, [refreshTree, loadChat, refreshUndo, refreshVercelMeta, refreshPlan])

  useEffect(() => {
    let cancelled = false
    setIndexBusy(true)
    window.nfblaze
      .ensureProjectIndex(project.id)
      .then((info) => {
        if (!cancelled) setProjectIndex(info)
      })
      .catch((err) => {
        if (!cancelled) {
          setProjectIndex({
            ready: false,
            rootDir: '',
            scannedAt: '',
            filesSampled: 0,
            fromCache: false,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      })
      .finally(() => {
        if (!cancelled) setIndexBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  async function refreshProjectIndexManual(): Promise<void> {
    setIndexBusy(true)
    try {
      const info = await window.nfblaze.refreshProjectIndex(project.id)
      setProjectIndex(info)
    } catch (err) {
      setProjectIndex({
        ready: false,
        rootDir: '',
        scannedAt: '',
        filesSampled: 0,
        fromCache: false,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setIndexBusy(false)
    }
  }

  useEffect(() => {
    // בזמן סטרימינג הגלילה מיידית — גלילה «חלקה» שמופעלת מחדש כל ~80ms
    // אף פעם לא משיגה את הטקסט ונראית כקפיצות
    bottomRef.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth' })
  }, [messages, sending, liveText, liveStatus, liveFiles])

  useEffect(() => {
    pickedElementsRef.current = pickedElements
  }, [pickedElements])
  useEffect(() => {
    selectModeRef.current = selectMode
  }, [selectMode])

  useEffect(() => {
    function onMessage(ev: MessageEvent): void {
      const data = ev.data
      if (!data || typeof data !== 'object') return
      // התצוגה נטענה מחדש (HMR / שינוי של הסוכן) — משחזרים מצב בחירה והדגשות
      if (data.type === 'nf-blaze:select-ready') {
        const win = iframeRef.current?.contentWindow
        if (!win) return
        try {
          win.postMessage(
            { type: 'nf-blaze:set-select-mode', enabled: selectModeRef.current },
            '*'
          )
          const selectors = pickedElementsRef.current
            .map((el) => el.selector)
            .filter((s): s is string => Boolean(s))
          if (selectors.length) {
            win.postMessage({ type: 'nf-blaze:apply-selection', selectors }, '*')
          }
        } catch {
          /* ignore */
        }
      }
      // בחירה מרובה — הלקוח שולח את הרשימה המלאה בכל שינוי; מצב הבחירה נשאר פעיל
      if (data.type === 'nf-blaze:selection-changed' && Array.isArray(data.elements)) {
        setPickedElements(
          (data.elements as Record<string, unknown>[])
            .filter((el) => el && (el.file || el.selector))
            .map((el) => ({
              file: String(el.file || ''),
              line: Number(el.line) || 0,
              component: el.component ? String(el.component) : undefined,
              tag: el.tag ? String(el.tag) : undefined,
              selector: el.selector ? String(el.selector) : undefined,
              text: el.text ? String(el.text) : undefined
            }))
        )
      }
      // תאימות לפרויקטים עם plugin ישן (בחירה בודדת)
      if (data.type === 'nf-blaze:element-selected' && (data.file || data.selector)) {
        setPickedElements([
          {
            file: String(data.file || ''),
            line: Number(data.line) || 0,
            component: data.component ? String(data.component) : undefined,
            tag: data.tag ? String(data.tag) : undefined,
            selector: data.selector ? String(data.selector) : undefined,
            text: data.text ? String(data.text) : undefined
          }
        ])
        setSelectMode(false)
      }
      if (data.type === 'nf-blaze:runtime-error' && data.message) {
        const msg = String(data.message).slice(0, 2000)
        const src = data.source ? String(data.source) : ''
        setRuntimeErrors((prev) => {
          if (prev.some((e) => e.message === msg)) return prev
          return [...prev.slice(-3), { message: msg, source: src }]
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    try {
      win.postMessage({ type: 'nf-blaze:set-select-mode', enabled: selectMode }, '*')
    } catch {
      /* cross-origin until ready */
    }
  }, [selectMode, previewKey, previewUrl])

  async function ensureVitePreview(opts?: { restart?: boolean }): Promise<boolean> {
    try {
      const needsDev = await window.nfblaze.isViteProject(project.id)
      setIsDevProject(needsDev)
      if (!needsDev) return false
      setLivePreviewBusy(true)
      setPreviewErrorText('')
      setPreviewPhase('starting')
      setPreviewStatusMsg(opts?.restart ? 'מפעיל מחדש תצוגה…' : 'מרים שרת')
      setMode('preview')
      const result = opts?.restart
        ? await window.nfblaze.restartLivePreview(project.id)
        : await window.nfblaze.ensureLivePreview(project.id)
      livePreviewUrlRef.current = result.url
      setPreviewUrl(result.url)
      setPreviewKey((k) => k + 1)
      setPreviewServeMode(result.mode || 'live')
      setPreviewPhase(result.mode === 'fallback' ? 'fallback' : 'ready')
      setPreviewStatusMsg(result.message || (result.mode === 'fallback' ? 'מצב גיבוי' : 'מוכן'))
      setMode('preview')
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPreviewErrorText(msg)
      setPreviewPhase('error')
      setPreviewStatusMsg('התצוגה נכשלה')
      setPreviewUrl(null)
      livePreviewUrlRef.current = null
      setError(msg)
      return false
    } finally {
      setLivePreviewBusy(false)
    }
  }

  useEffect(() => {
    const unsub = window.nfblaze.onPreviewLiveEvent((ev) => {
      if (ev.projectId !== project.id) return
      setPreviewPhase(ev.phase as typeof previewPhase)
      setPreviewStatusMsg(ev.message)
      if (ev.mode) setPreviewServeMode(ev.mode)
      if (ev.url) {
        livePreviewUrlRef.current = ev.url
        setPreviewUrl(ev.url)
        setMode('preview')
      }
      if (ev.url === null && (ev.phase === 'crashed' || ev.phase === 'error')) {
        livePreviewUrlRef.current = null
        setPreviewUrl(null)
      }
      if (ev.errorText) setPreviewErrorText(ev.errorText)
      // Persistent "dev server console" in the terminal panel, so the user always
      // has somewhere to see the running process, not just the
      // few lines shown above the preview while it's starting up.
      if (ev.phase !== lastPreviewPhaseRef.current) {
        lastPreviewPhaseRef.current = ev.phase
        const header =
          ev.phase === 'installing'
            ? '▶ מתקין תלויות (npm install)…'
            : ev.phase === 'starting'
              ? '▶ מרים שרת פיתוח (npm run dev)…'
              : ev.phase === 'ready'
                ? `✓ שרת פיתוח מוכן${ev.url ? ` — ${ev.url}` : ''}`
                : ev.phase === 'fallback'
                  ? '⚠ שרת הפיתוח לא עלה — עובר למצב גיבוי (בנייה סטטית, בלי עדכון חי)'
                  : ev.phase === 'crashed'
                    ? '✗ שרת הפיתוח קרס'
                    : ev.phase === 'error'
                      ? '✗ שגיאה בשרת הפיתוח'
                      : null
        if (header) setTerminalLines((lines) => [...lines, header])
      }
      if (ev.logLine) {
        setPreviewLogTail((lines) => [...lines.slice(-40), ev.logLine!])
        // תקרה — הצטברות אינסופית של פלט שרת גרמה לתקיעות UI אחרי שימוש ממושך
        setTerminalLines((lines) => [...lines.slice(-MAX_PANEL_LINES), ev.logLine!])
      }
      if (ev.phase === 'installing' || ev.phase === 'starting') {
        setLivePreviewBusy(true)
        setMode('preview')
      }
      if (ev.phase === 'ready' || ev.phase === 'fallback') {
        setLivePreviewBusy(false)
      }
      if (ev.phase === 'error' || ev.phase === 'crashed') {
        setLivePreviewBusy(false)
      }
    })
    return unsub
  }, [project.id])

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight })
  }, [terminalLines])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      window.nfblaze
        .estimateContext({
          projectId: project.id,
          model,
          activeFile: selectedFile,
          draftMessage: input
        })
        .then((u) => {
          if (!cancelled) {
            setContextUsage((prev) => ({
              ...u,
              compactedAt: prev?.compactedAt,
              compactNote: prev?.compactNote,
              compactCount: prev?.compactCount
            }))
          }
        })
        .catch(console.error)
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [project.id, model, selectedFile, messages, input, sending, tree])

  const openFile = useCallback(
    async (relativePath: string) => {
      if (dirty && selectedFile && selectedFile !== relativePath) {
        if (!confirm('יש שינויים שלא נשמרו. לעבור בלי לשמור?')) return
      }
      setSelectedFile(relativePath)
      setError('')
      try {
        const content = await window.nfblaze.readFile(project.id, relativePath)
        setFileContent(content)
        setDraftContent(content)
        setDirty(false)
        const lower = relativePath.toLowerCase().replace(/\\/g, '/')
        const isHtml = lower.endsWith('.html') || lower.endsWith('.htm')

        // Dev-server projects (Vite/React): never serve raw HTML via nfblaze:// —
        // that shell can't load /src/main.tsx. Keep the live preview URL.
        if (isDevProject) {
          const live = livePreviewUrlRef.current
          if (live) setPreviewUrl(live)
          // Source files → editor; HTML entry stays on live preview
          setMode(isHtml ? 'preview' : 'code')
          return
        }

        if (isHtml) {
          const url = await window.nfblaze.getPreviewUrl(project.id, relativePath)
          setPreviewUrl(`${url}?t=${Date.now()}`)
          setPreviewKey((k) => k + 1)
          setMode((m) => (m === 'code' ? 'code' : 'preview'))
        } else {
          setPreviewUrl(null)
          setMode('code')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        if (!isDevProject) setPreviewUrl(null)
      }
    },
    [project.id, dirty, selectedFile, isDevProject]
  )

  openFileRef.current = openFile

  async function saveFile(): Promise<void> {
    if (!selectedFile || !dirty) return
    setSaving(true)
    setError('')
    try {
      await window.nfblaze.writeFile(project.id, selectedFile, draftContent)
      setFileContent(draftContent)
      setDirty(false)
      const lower = selectedFile.toLowerCase()
      if ((lower.endsWith('.html') || lower.endsWith('.htm')) && !isDevProject) {
        const url = await window.nfblaze.getPreviewUrl(project.id, selectedFile)
        setPreviewUrl(`${url}?t=${Date.now()}`)
        setPreviewKey((k) => k + 1)
      }
      await refreshTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  /** Auto live preview on open — only when project id changes (not lastPreviewFile) */
  useEffect(() => {
    let cancelled = false
    const id = project.id
    cancelPendingPreviewStop(id)

    async function autoPreview(): Promise<void> {
      setPreviewPhase('idle')
      setPreviewErrorText('')
      setPreviewLogTail([])
      setPreviewServeMode(null)
      setTerminalLines([])
      lastPreviewPhaseRef.current = null
      // Reuse warm server from create — keep URL if already live.
      // חשוב לקרוא את הסטטוס המלא: URL חם יכול להיות גם מצב גיבוי סטטי,
      // ואז חייבים להציג את הבאנר ואת לוג ההרצה בטרמינל.
      try {
        const status = await window.nfblaze.getLivePreviewStatus(id)
        if (status.url && !cancelled) {
          livePreviewUrlRef.current = status.url
          setPreviewUrl(status.url)
          setPreviewServeMode(status.mode ?? 'live')
          setPreviewPhase(status.mode === 'fallback' ? 'fallback' : 'ready')
          setPreviewStatusMsg(status.mode === 'fallback' ? 'מצב גיבוי — בלי עדכון חי' : 'מוכן')
          if (status.log.length) setTerminalLines(status.log)
          setMode('preview')
          setIsDevProject(true)
          return
        }
      } catch {
        /* fall through */
      }

      livePreviewUrlRef.current = null
      const needsDev = await window.nfblaze.isViteProject(id)
      if (cancelled) return
      setIsDevProject(needsDev)
      if (needsDev) {
        setMode('preview')
        await ensureVitePreview()
        return
      }
      setPreviewServeMode('static')
      const candidate =
        project.lastPreviewFile ||
        (await window.nfblaze.findHtmlFile(id))
      if (!candidate || cancelled) return
      await openFileRef.current(candidate)
    }
    autoPreview().catch(console.error)
    return () => {
      cancelled = true
      schedulePreviewStop(id)
    }
    // Only remount preview lifecycle per project — not on lastPreviewFile updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  async function showBestHtmlPreview(preferred?: string | null): Promise<void> {
    const needsDev = await window.nfblaze.isViteProject(project.id)
    if (needsDev) {
      const ok = await ensureVitePreview()
      if (ok) return
    }
    const fromPreferred =
      preferred &&
      (preferred.toLowerCase().endsWith('.html') || preferred.toLowerCase().endsWith('.htm'))
        ? preferred
        : null
    const found = fromPreferred || (await window.nfblaze.findHtmlFile(project.id))
    if (found) {
      await openFile(found)
    }
  }

  function askAgentToFixPreview(): void {
    const detail = previewErrorText || previewStatusMsg || 'שגיאה לא ידועה בתצוגה המקדימה'
    const prompt = `יש שגיאה בתצוגה המקדימה. תקן אותה:\n\n${detail}`
    void send(prompt, 'BUILD')
  }

  /** הרצת פקודה בטרמינל האינטראקטיבי (npm / pnpm / yarn בלבד, בתוך הפרויקט) */
  async function runUserCommand(command: string, args: string[]) {
    setBottomCollapsed(false)
    setBottomTab('terminal')
    setShellBusy(true)
    setShellLines((l) => [...l.slice(-MAX_PANEL_LINES), `$ ${command} ${args.join(' ')}`])
    const unsub = window.nfblaze.onShellEvent((ev) => {
      setShellLines((l) => [...l.slice(-MAX_PANEL_LINES), ev.line])
    })
    try {
      const result = await window.nfblaze.runShell({
        projectId: project.id,
        command: command as 'npm',
        args
      })
      setShellLines((l) => [
        ...l,
        result.ok ? `✓ הסתיים (קוד ${result.code})` : `✗ נכשל (קוד ${result.code})`
      ])
      await refreshTree()
    } catch (err) {
      setShellLines((l) => [...l, `✗ ${err instanceof Error ? err.message : String(err)}`])
    } finally {
      unsub()
      setShellBusy(false)
    }
  }

  async function runNpm(args: string[]) {
    await runUserCommand('npm', args)
  }

  const LONG_RUNNING = new Set(['dev', 'start', 'preview', 'serve', 'watch'])

  /** שורת פקודה מהמשתמש בטרמינל — אימות לפני הרצה */
  function submitShellInput() {
    const raw = shellInput.trim()
    if (!raw) return
    if (shellBusy) {
      setShellLines((l) => [...l, '⏳ פקודה כבר רצה — המתן לסיום'])
      return
    }
    setShellInput('')
    const tokens = raw.split(/\s+/)
    const cmd = tokens[0]
    if (cmd !== 'npm' && cmd !== 'pnpm' && cmd !== 'yarn') {
      setShellLines((l) => [
        ...l,
        `$ ${raw}`,
        `✗ מטעמי אבטחה הטרמינל מריץ רק npm / pnpm / yarn בתוך תיקיית הפרויקט`
      ])
      return
    }
    const script = tokens[1] === 'run' ? tokens[2] : tokens[1]
    if (script && LONG_RUNNING.has(script)) {
      setShellLines((l) => [
        ...l,
        `$ ${raw}`,
        `✗ "${raw}" הוא תהליך ארוך-ריצה — התצוגה החיה כבר מריצה את שרת הפיתוח. השתמש ב«הפעל מחדש תצוגה»`
      ])
      return
    }
    void runUserCommand(cmd, tokens.slice(1))
  }

  const refreshChats = useCallback(async () => {
    try {
      setChats(await window.nfblaze.listChats(project.id))
    } catch {
      /* ignore */
    }
  }, [project.id])

  useEffect(() => {
    void refreshChats()
  }, [refreshChats])

  async function handleSwitchChat(chatId: string) {
    if (!chatId) return
    setChatOpsBusy(true)
    try {
      await window.nfblaze.switchChat(project.id, chatId)
      await refreshChats()
      await loadChat()
      await refreshUndo()
    } finally {
      setChatOpsBusy(false)
    }
  }

  async function handleNewChat() {
    setChatOpsBusy(true)
    try {
      await window.nfblaze.createChat(project.id)
      await refreshChats()
      await loadChat()
    } finally {
      setChatOpsBusy(false)
    }
  }

  async function handleSummarizeToNewChat() {
    setChatOpsBusy(true)
    try {
      const res = await window.nfblaze.summarizeToNewChat(project.id, provider, model)
      await refreshChats()
      await loadChat()
      setTerminalLines((l) => [
        ...l,
        res.summarized
          ? '✓ השיחה סוכמה ונפתח צ׳אט חדש עם ההקשר'
          : 'ℹ נפתח צ׳אט חדש (הסיכום נכשל — ההקשר יגיע מזיכרון הפרויקט)'
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChatOpsBusy(false)
    }
  }

  async function handleDeleteChat() {
    const current = chats?.chats.find((c) => c.id === chats.activeChatId)
    if (!confirm(`למחוק את הצ'אט «${current?.title || ''}»?`)) return
    setChatOpsBusy(true)
    try {
      await window.nfblaze.deleteChat(project.id, chats!.activeChatId)
      await refreshChats()
      await loadChat()
    } finally {
      setChatOpsBusy(false)
    }
  }

  async function runSecurityScan() {
    setSecScan((s) => ({ ...s, running: true, error: '' }))
    try {
      // סריקה מהירה נראית כמו «כלום לא קרה» — השהיה קצרצרה + חותמת זמן נותנות משוב אמיתי
      const [report] = await Promise.all([
        window.nfblaze.runSecurityScan(project.id),
        new Promise((r) => setTimeout(r, 450))
      ])
      setSecScan({
        running: false,
        scannedAt: new Date().toLocaleTimeString('he-IL'),
        report,
        error: ''
      })
    } catch (err) {
      setSecScan({
        running: false,
        scannedAt: new Date().toLocaleTimeString('he-IL'),
        report: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function runProjectTests() {
    if (testsRunning) return
    setTestsRunning(true)
    setTestsResult(null)
    setTestsLines([`$ npm test`])
    const unsub = window.nfblaze.onShellEvent((ev) => {
      setTestsLines((l) => [...l.slice(-MAX_PANEL_LINES), ev.line])
    })
    try {
      const result = await window.nfblaze.runShell({
        projectId: project.id,
        command: 'npm',
        args: ['test']
      })
      const missingScript = /missing script|Missing script/i.test(result.stderr || '')
      setTestsLines((l) => [
        ...l,
        missingScript
          ? 'ℹ לפרויקט אין סקריפט "test" ב-package.json — בקש מהסוכן להוסיף בדיקות (Vitest)'
          : result.ok
            ? '✓ כל הבדיקות עברו'
            : `✗ בדיקות נכשלו (קוד ${result.code})`
      ])
      setTestsResult(result.ok ? 'pass' : 'fail')
    } catch (err) {
      setTestsLines((l) => [...l, `✗ ${err instanceof Error ? err.message : String(err)}`])
      setTestsResult('fail')
    } finally {
      unsub()
      setTestsRunning(false)
    }
  }

  useEffect(() => {
    testsRef.current?.scrollTo({ top: testsRef.current.scrollHeight })
  }, [testsLines])

  async function toggleHistory() {
    if (!showHistory) {
      setHistory(await window.nfblaze.listSnapshots(project.id))
    }
    setShowHistory((v) => !v)
  }

  /** תווית לנקודת שחזור — קטע מהודעת המשתמש שהתחילה את הסבב */
  function snapshotLabel(s: SnapshotSummary): string {
    const msg = s.messageId ? messages.find((m) => m.id === s.messageId) : undefined
    if (msg?.content) {
      const text = msg.content.replace(/\s+/g, ' ').trim()
      return text.length > 70 ? `${text.slice(0, 70)}…` : text
    }
    return `${s.files.length} קבצים`
  }

  async function handleRestore(snapshotId: string) {
    if (restoreBusy || sending) return
    if (!confirm('לשחזר את הפרויקט למצב שלפני הנקודה הזו? שינויים מאוחרים יותר יבוטלו.')) return
    setRestoreBusy(true)
    try {
      const res = await window.nfblaze.restoreSnapshot(project.id, snapshotId)
      setError(res.ok ? '' : res.message)
      if (res.ok) {
        setTerminalLines((l) => [...l, `⏪ ${res.message}`])
        setHistory(await window.nfblaze.listSnapshots(project.id))
        await refreshTree()
        await refreshUndo()
        if (selectedFile) await openFile(selectedFile)
      }
    } finally {
      setRestoreBusy(false)
    }
  }

  /** אישור השינויים של סבב — נשמר על ההודעה */
  async function approveChanges(messageId: string) {
    await window.nfblaze.setChangesApproval(project.id, messageId, true)
    setMessages((ms) =>
      ms.map((m) => (m.id === messageId ? { ...m, changesApproved: true } : m))
    )
  }

  /** ביטול השינויים של סבב — משחזר את הקבצים ומסמן על ההודעה */
  async function rejectChanges(messageId: string, snapshotId: string) {
    if (restoreBusy || sending) return
    if (!confirm('לבטל את השינויים של הסבב הזה? הקבצים יחזרו למצב הקודם.')) return
    setRestoreBusy(true)
    try {
      const res = await window.nfblaze.restoreSnapshot(project.id, snapshotId)
      if (!res.ok) {
        setError(res.message)
        return
      }
      await window.nfblaze.setChangesApproval(project.id, messageId, false)
      setMessages((ms) =>
        ms.map((m) => (m.id === messageId ? { ...m, changesApproved: false } : m))
      )
      setTerminalLines((l) => [...l, `✗ השינויים בוטלו — ${res.message}`])
      await refreshTree()
      await refreshUndo()
      if (selectedFile) await openFile(selectedFile)
    } finally {
      setRestoreBusy(false)
    }
  }

  async function handleUndo() {
    if (!canUndo) return
    if (!confirm('לבטל את השינוי האחרון של ה-AI?')) return
    const res = await window.nfblaze.undoLast(project.id)
    setError(res.ok ? '' : res.message)
    if (res.ok) {
      setTerminalLines((l) => [...l, `↩ ${res.message}`])
      // סנכרון סרגל האישור — הסבב האחרון בוטל, שלא יציע «בטל שינויים» על snapshot שנמחק
      const lastPending = [...messages]
        .reverse()
        .find((m) => m.snapshotId && m.changesApproved === undefined)
      if (lastPending) {
        await window.nfblaze.setChangesApproval(project.id, lastPending.id, false)
        setMessages((ms) =>
          ms.map((m) => (m.id === lastPending.id ? { ...m, changesApproved: false } : m))
        )
      }
      await refreshTree()
      await refreshUndo()
      if (selectedFile) await openFile(selectedFile)
    } else {
      setError(res.message)
    }
  }

  async function send(overrideText?: string, modeOverride?: WorkModeSelection) {
    const text = (overrideText ?? input).trim()
    if (!text || sending) return
    if (!hasKey(provider)) {
      setError('אין מפתח API לספק שנבחר. עבור להגדרות והוסף מפתח.')
      return
    }
    const modeForRequest = modeOverride ?? workModeSel
    setSending(true)
    setError('')
    if (!overrideText) setInput('')
    setLiveStatus('מתחיל…')
    stopLiveTicker()
    liveTextRef.current = ''
    liveShownRef.current = 0
    setLiveText('')
    setLiveReplaced(false)
    setLiveFiles([])
    setPendingBuildPrompt(null)
    setModeBlockedWrites(false)
    setProjectCheck({ status: 'idle' })
    setBrowserQa({ phase: 'idle' })

    const optimistic: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      workMode:
        modeForRequest === 'ASK' || modeForRequest === 'PLAN' || modeForRequest === 'BUILD'
          ? modeForRequest
          : undefined
    }
    setMessages((m) => [...m, optimistic])
    const elementsForSend = pickedElements

    const unsubscribe = window.nfblaze.onChatStream((ev) => {
      if (ev.type === 'status') {
        setLiveStatus(ev.message)
      } else if (ev.type === 'token') {
        if (ev.replace) {
          liveTextRef.current = ev.text
          liveShownRef.current = Math.min(liveShownRef.current, ev.text.length)
        } else liveTextRef.current += ev.text
        ensureLiveTicker()
        setLiveStatus((s) => (s.startsWith('כותב') || s.startsWith('מריץ') ? s : 'כותב תשובה…'))
      } else if (ev.type === 'intent') {
        setLastResolvedMode(ev.mode)
        setLiveStatus(
          ev.source === 'manual' ? `מצב: ${ev.mode}` : `זוהה מצב: ${ev.mode}`
        )
      } else if (ev.type === 'file') {
        const label =
          ev.action === 'write'
            ? `כותב ${ev.path}`
            : ev.action === 'edit'
              ? `עורך ${ev.path}`
              : ev.action === 'mkdir'
                ? `יוצר תיקייה ${ev.path}`
                : `מוחק ${ev.path}`
        setLiveStatus(label)
        setLiveFiles((files) => (files.includes(ev.path) ? files : [...files, ev.path]))
      } else if (ev.type === 'shell') {
        // פלט פקודות שהסוכן מריץ — נכנס לקונסול בפאנל התחתון
        setBottomCollapsed(false)
        setBottomTab('console')
        setTerminalLines((l) => [...l.slice(-MAX_PANEL_LINES), ev.line])
      } else if (ev.type === 'scope') {
        const list = ev.allScoped?.length ? ev.allScoped : ev.files
        setLiveStatus(
          ev.expansion
            ? `היקף הורחב: ${ev.files.join(', ')}`
            : `היקף: ${list.join(', ')}`
        )
        setLiveFiles((files) => {
          const next = [...files]
          for (const f of list) {
            if (!next.includes(f)) next.push(f)
          }
          return next
        })
      } else if (ev.type === 'tool') {
        if (ev.phase === 'start') {
          setLiveStatus(ev.path ? `${ev.name}: ${ev.path}` : `כלי: ${ev.name}`)
        } else if (ev.isError) {
          setLiveStatus(`כשל ב-${ev.name}`)
        }
      } else if (ev.type === 'tsc_fix') {
        setLiveStatus(
          `tsc · ${ev.file} (${ev.errors.length} שגיאות, ניסיון ${ev.attempt})`
        )
      } else if (ev.type === 'completion_check') {
        setLiveStatus(
          ev.ok ? 'בדיקת סיום עברה' : ev.nudge || `חסר: ${ev.missing || 'תנאי סיום'}`
        )
      } else if (ev.type === 'project_check') {
        setProjectCheck({
          status: ev.status,
          kind: ev.kind,
          errorCount: ev.errorCount,
          message: ev.message
        })
        if (ev.message) setLiveStatus(ev.message)
      } else if (ev.type === 'context_compact') {
        const note = `כווץ · ${ev.beforePercent}% → ${ev.afterPercent}%`
        setLiveStatus(note)
        setContextUsage((prev) => {
          if (!prev) {
            return {
              modelId: model,
              contextWindow: ev.contextWindow,
              usedTokens: ev.afterTokens,
              percent: ev.afterPercent,
              buckets: [],
              compactedAt: new Date().toISOString(),
              compactNote: note,
              compactCount: 1
            }
          }
          return {
            ...prev,
            usedTokens: ev.afterTokens,
            percent: ev.afterPercent,
            contextWindow: ev.contextWindow,
            compactedAt: new Date().toISOString(),
            compactNote: note,
            compactCount: (prev.compactCount || 0) + 1
          }
        })
      } else if (ev.type === 'browser_qa') {
        setBrowserQa({
          phase: ev.phase,
          attempt: ev.attempt,
          message: ev.message,
          action: ev.action,
          url: ev.url
        })
        setLiveStatus(
          ev.action
            ? `דפדפן · ${ev.action}`
            : ev.message || 'בודק בדפדפן…'
        )
      } else if (ev.type === 'error') {
        setError(ev.message)
      }
    })

    try {
      const result = await window.nfblaze.sendChatStream({
        projectId: project.id,
        message: text,
        provider,
        model,
        activeFile: selectedFile || elementsForSend.find((e) => e.file)?.file || null,
        workMode: modeForRequest,
        selectedElements: elementsForSend.length ? elementsForSend : null
      })
      setPickedElements([])
      setSelectMode(false)
      // ניקוי ההדגשות גם בתוך התצוגה — לא רק הצ'יפים
      try {
        iframeRef.current?.contentWindow?.postMessage({ type: 'nf-blaze:clear-selection' }, '*')
      } catch {
        /* ignore */
      }
      setDirty(false)
      // החלפה חלקה: ההודעה הסופית נכנסת והבועה החיה מוסתרת באותו רנדר —
      // קודם הבועה נשארה על המסך לאורך כל הרענונים שאחרי הסבב וגרמה לקפיצה
      const chat = await window.nfblaze.getChat(project.id)
      setMessages(chat.messages)
      setLiveReplaced(true)
      await refreshTree()
      await refreshUndo()
      await refreshPlan()
      // «בצע את זה» רק כשיש באמת מה לבצע: תוכנית (PLAN) או שהסוכן ניסה לכתוב
      // ונחסם על ידי המצב. שאלה רגילה («מה אתה חושב על הפרויקט?») לא מציעה ביצוע.
      const actionable =
        result.workMode === 'PLAN' ||
        (result.workMode === 'ASK' && Boolean(result.modeBlockedWrites))
      if (actionable) {
        setPendingBuildPrompt(text)
        setLastResolvedMode(result.workMode ?? null)
        setModeBlockedWrites(Boolean(result.modeBlockedWrites))
      } else {
        setPendingBuildPrompt(null)
        setModeBlockedWrites(false)
      }
      // Reload open file if AI changed it
      if (selectedFile) {
        try {
          const content = await window.nfblaze.readFile(project.id, selectedFile)
          setFileContent(content)
          setDraftContent(content)
          setDirty(false)
        } catch {
          /* file may have been deleted */
        }
      }
      const updated = await window.nfblaze.getProject(project.id)
      if (updated) onProjectUpdate(updated)

      const preview =
        result.previewFile ||
        result.actionsApplied.find((a) => /\.html?$/i.test(a.path))?.path ||
        null
      if (previewServeMode === 'fallback' && result.actionsApplied?.length) {
        // במצב גיבוי אין HMR — בלי בנייה מחדש המשתמש ימשיך לראות תצוגה ישנה,
        // וההפעלה מחדש גם נותנת לשרת הפיתוח הזדמנות נוספת לעלות
        await ensureVitePreview({ restart: true })
      } else {
        await showBestHtmlPreview(preview)
      }
      if (result.actionsApplied?.length) {
        try {
          const info = await window.nfblaze.getProjectIndex(project.id)
          setProjectIndex(info)
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      await loadChat()
      setLiveReplaced(true)
    } finally {
      unsubscribe()
      stopLiveTicker()
      liveTextRef.current = ''
      liveShownRef.current = 0
      setSending(false)
      setLiveStatus('')
      setLiveText('')
      setLiveFiles([])
    }
  }

  function executePendingBuild(): void {
    if (!pendingBuildPrompt || sending) return
    const prompt = pendingBuildPrompt
    setPendingBuildPrompt(null)
    setModeBlockedWrites(false)
    setWorkModeSel('BUILD')
    void send(prompt, 'BUILD')
  }

  return (
    <div className="workspace">
      <section className="panel panel-chat">
        <div className="panel-head">
          <div>
            <h3>צ׳אט · {project.name}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <select
                className="select"
                style={{ fontSize: '0.74rem', padding: '2px 8px', maxWidth: 200 }}
                value={chats?.activeChatId || ''}
                disabled={sending || chatOpsBusy}
                title="מעבר בין צ'אטים של הפרויקט"
                onChange={(e) => void handleSwitchChat(e.target.value)}
              >
                {(chats?.chats ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                style={{ padding: 4 }}
                title="צ'אט חדש"
                disabled={sending || chatOpsBusy}
                onClick={() => void handleNewChat()}
              >
                <Plus size={13} />
              </button>
              <button
                className="btn btn-ghost"
                style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                title="מסכם את השיחה עם מודל מהיר ופותח צ'אט חדש עם ההקשר"
                disabled={sending || chatOpsBusy || messages.length === 0}
                onClick={() => void handleSummarizeToNewChat()}
              >
                <Sparkles size={13} />
                {chatOpsBusy ? 'מסכם…' : 'סכם לצ׳אט חדש'}
              </button>
              {(chats?.chats.length ?? 0) > 1 && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: 4 }}
                  title="מחק את הצ'אט הנוכחי"
                  disabled={sending || chatOpsBusy}
                  onClick={() => void handleDeleteChat()}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {projectCheck.status !== 'idle' && (
              <div
                className={`project-check-badge project-check-${projectCheck.status}`}
                title={projectCheck.message || ''}
              >
                {projectCheck.status === 'checking' && (
                  <>
                    <span className="live-pulse" />
                    בודק {projectCheck.kind === 'build' ? 'build' : 'tsc'}…
                  </>
                )}
                {projectCheck.status === 'passed' && (
                  <>עבר {projectCheck.kind === 'build' ? 'build' : 'tsc'}</>
                )}
                {projectCheck.status === 'failed' && (
                  <>
                    נכשל {projectCheck.kind === 'build' ? 'build' : 'tsc'}
                    {typeof projectCheck.errorCount === 'number'
                      ? ` · ${projectCheck.errorCount} שגיאות`
                      : ''}
                  </>
                )}
                {projectCheck.status === 'timeout' && <>בדיקה בוטלה אחרי 90 שניות — אזהרה</>}
                {projectCheck.status === 'cancelled' && <>בדיקה בוטלה</>}
              </div>
            )}
            {browserQa.phase !== 'idle' && (
              <div
                className={`browser-qa-badge browser-qa-${browserQa.phase}`}
                title={browserQa.url || browserQa.message || ''}
              >
                {(browserQa.phase === 'start' || browserQa.phase === 'action') && (
                  <>
                    <span className="live-pulse" />
                    דפדפן
                    {browserQa.attempt ? ` · ${browserQa.attempt}/2` : ''}
                    {browserQa.action
                      ? ` · ${browserQa.action}`
                      : browserQa.message
                        ? ` · ${browserQa.message}`
                        : ' פועל…'}
                  </>
                )}
                {browserQa.phase === 'passed' && <>בדיקת דפדפן עברה</>}
                {browserQa.phase === 'failed' && (
                  <>בדיקת דפדפן — נמצאו בעיות</>
                )}
                {browserQa.phase === 'error' && <>בדיקת דפדפן נכשלה</>}
                {browserQa.phase === 'skipped' && <>בדיקת דפדפן דולגה</>}
              </div>
            )}
            <div
              className="index-status"
              title={projectIndex?.summary || projectIndex?.error || ''}
              style={{
                fontSize: '0.75rem',
                color: projectIndex?.ready ? 'var(--muted)' : 'var(--danger)',
                marginTop: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              {indexBusy ? (
                <span>בונה אינדקס קונבנציות…</span>
              ) : projectIndex?.ready ? (
                <span>
                  אינדקס {projectIndex.fromCache ? 'נטען' : 'נבנה'} · {projectIndex.filesSampled}{' '}
                  קבצים
                  {projectIndex.scannedAt
                    ? ` · ${new Date(projectIndex.scannedAt).toLocaleString('he-IL')}`
                    : ''}
                </span>
              ) : (
                <span>אינדקס לא זמין{projectIndex?.error ? `: ${projectIndex.error}` : ''}</span>
              )}
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 6px', minHeight: 0 }}
                title="רענון ידני של אינדקס הקונבנציות"
                disabled={indexBusy || sending}
                onClick={() => refreshProjectIndexManual()}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
          <div className="panel-head-actions">
            {vercelUrl && (
              <button
                className="btn btn-ghost"
                title="פרסם עדכון ל-Vercel"
                disabled={redeployBusy || sending}
                onClick={async () => {
                  setRedeployBusy(true)
                  setError('')
                  try {
                    const res = await window.nfblaze.redeployVercel(project.id)
                    await refreshVercelMeta()
                    if (!res.ok) {
                      if (res.securityBlocked) {
                        setError(
                          res.securitySummaryHebrew ||
                            res.message ||
                            'הפרסום נחסם בגלל אבטחה'
                        )
                      } else {
                        setError(res.buildLogHebrew || res.message)
                      }
                      setShowIntegrations(true)
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                    setShowIntegrations(true)
                  } finally {
                    setRedeployBusy(false)
                  }
                }}
              >
                <Rocket size={15} />
                <span style={{ fontSize: '0.75rem' }}>פרסם עדכון</span>
              </button>
            )}
            {onOpenOverview && (
              <button
                className="btn btn-ghost"
                title="מסך הפרויקט — שם, GitHub, Supabase"
                onClick={onOpenOverview}
              >
                <LayoutDashboard size={15} />
              </button>
            )}
            <button
              className="btn btn-ghost"
              title="חיבורים — GitHub / Supabase / Vercel"
              onClick={() => setShowIntegrations(true)}
            >
              <PlugZap size={15} />
            </button>
            <button
              className="btn btn-ghost"
              title="בטל שינוי אחרון"
              disabled={!canUndo || sending}
              onClick={handleUndo}
            >
              <Undo2 size={15} />
            </button>
            <button
              className="btn btn-ghost"
              title="היסטוריית גרסאות — שחזור לכל נקודה"
              onClick={() => void toggleHistory()}
            >
              <History size={15} />
            </button>
            <button
              className="btn btn-ghost"
              title="נקה שיחה"
              onClick={async () => {
                if (confirm('לנקות את כל השיחה בפרויקט זה?')) {
                  await window.nfblaze.clearChat(project.id)
                  await loadChat()
                }
              }}
            >
              <Eraser size={15} />
            </button>
          </div>
        </div>

        {showHistory && (
          <div
            style={{
              margin: '0 12px 8px',
              border: '1px solid var(--border, #333)',
              borderRadius: 8,
              padding: '8px 10px',
              maxHeight: 220,
              overflowY: 'auto',
              fontSize: '0.82rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <strong>היסטוריית גרסאות</strong>
              <span style={{ opacity: 0.6, marginInlineStart: 8 }}>
                שחזור מחזיר את הקבצים למצב שלפני הנקודה שנבחרה
              </span>
              <button
                className="btn btn-ghost"
                style={{ marginInlineStart: 'auto' }}
                onClick={() => setShowHistory(false)}
              >
                <X size={13} />
              </button>
            </div>
            {history.length === 0 && (
              <div style={{ opacity: 0.7 }}>אין עדיין נקודות שחזור — הן נוצרות בכל סבב שהסוכן משנה קבצים.</div>
            )}
            {history.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  borderTop: '1px solid var(--border, #2a2a2a)'
                }}
              >
                <span style={{ opacity: 0.55, whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                  {new Date(s.createdAt).toLocaleString('he-IL', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={s.files.join(', ')}
                >
                  {snapshotLabel(s)}
                  <span style={{ opacity: 0.5 }}> · {s.files.length} קבצים</span>
                </span>
                <button
                  className="btn"
                  disabled={restoreBusy || sending}
                  onClick={() => void handleRestore(s.id)}
                >
                  שחזר לכאן
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="chat-messages">
          {messages.length === 0 && !sending && (
            <div className="preview-empty" style={{ minHeight: 160, background: 'transparent' }}>
              <Sparkles size={28} color="var(--accent)" style={{ marginBottom: 12 }} />
              <div style={{ fontWeight: 600, marginBottom: 6 }}>מה נבנה היום?</div>
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} className="quick-chip" onClick={() => send(p)} disabled={sending}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, idx) => {
            const clarifyAnswered =
              Boolean(m.clarify) &&
              messages.slice(idx + 1).some((x) => x.role === 'user')
            // אישור/ביטול רק על הסבב האחרון — ביטול סבב ישן היה מבטל גם את החדשים שאחריו
            const isLastSnapshotMsg =
              Boolean(m.snapshotId) &&
              !messages.slice(idx + 1).some((x) => x.snapshotId)
            return (
            <div
              key={m.id}
              className={`msg msg-${m.role} ${m.error ? 'msg-error' : ''} ${m.aborted ? 'msg-aborted' : ''}`}
            >
              {m.role === 'assistant' && m.workMode && (
                <div className="msg-mode-badge" title={m.workModeSource === 'auto' ? 'זוהה אוטומטית' : 'בחירה ידנית'}>
                  {workModeLabel(m.workMode, m.workModeSource)}
                </div>
              )}
              <div className="msg-bubble">
                {m.role === 'assistant' ? <MarkdownMessage content={m.content} /> : m.content}
              </div>
              {m.role === 'assistant' && m.clarify && !clarifyAnswered && (
                <ClarifyCard
                  clarify={m.clarify}
                  disabled={sending}
                  onSubmit={(answersText) => {
                    void send(answersText, 'PLAN')
                  }}
                />
              )}
              {m.filesChanged && m.filesChanged.length > 0 && (
                <div className="msg-files">
                  {m.filesChanged.map((f) => {
                    const stat = m.changeStats?.[f]
                    return (
                      <button
                        key={f}
                        className="file-chip"
                        style={{ border: 'none', cursor: 'pointer' }}
                        onClick={() => openFile(f)}
                        title={f}
                      >
                        <span dir="ltr">{f}</span>
                        {stat && (
                          <span dir="ltr" style={{ marginInlineStart: 6, whiteSpace: 'nowrap' }}>
                            <span className="stat-add">+{stat.added}</span>{' '}
                            <span className="stat-del">-{stat.removed}</span>
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              {m.regressions && m.regressions.length > 0 && (
                <div className="regression-card">
                  <div className="regression-title">
                    <TriangleAlert size={14} />
                    אחרי השינוי הזה נשבר משהו שעבד קודם
                  </div>
                  <ul className="regression-list">
                    {m.regressions.map((r, i) => (
                      <li key={`${r.kind}-${r.route ?? i}`}>
                        {r.kind === 'route' ? (
                          <>
                            <span dir="ltr">{r.route}</span> — {r.detail}
                          </>
                        ) : (
                          <>
                            שגיאת קונסול חדשה: <span dir="ltr">{r.detail}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="regression-hint">
                    אפשר לבקש תיקון, או «בטל שינויים» כדי לחזור למצב הקודם.
                  </div>
                </div>
              )}
              {m.snapshotId && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 8,
                    flexWrap: 'wrap'
                  }}
                >
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.78rem' }}
                    title="תצוגה מקדימה של כל שינוי — לפני מול אחרי"
                    onClick={() => setDiffSnapshotId(m.snapshotId!)}
                  >
                    <GitCompare size={13} />
                    הצג שינויים
                  </button>
                  {m.changesApproved === undefined && isLastSnapshotMsg && !sending && (
                    <>
                      <span style={{ fontSize: '0.78rem', opacity: 0.75 }}>
                        לשמור את השינויים?
                      </span>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: '0.78rem', padding: '2px 10px' }}
                        disabled={restoreBusy}
                        onClick={() => void approveChanges(m.id)}
                      >
                        <Check size={13} />
                        אשר
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ fontSize: '0.78rem', padding: '2px 10px' }}
                        disabled={restoreBusy}
                        onClick={() => void rejectChanges(m.id, m.snapshotId!)}
                      >
                        <X size={13} />
                        בטל שינויים
                      </button>
                    </>
                  )}
                  {m.changesApproved === true && (
                    <span
                      style={{ fontSize: '0.76rem', color: 'var(--success, #4caf50)' }}
                      title={
                        m.autoApproved
                          ? 'שינוי קטן ונקי, אחרי רצף אישורים — אפשר לבטל מהיסטוריית הגרסאות'
                          : undefined
                      }
                    >
                      ✓ {m.autoApproved ? 'אושר אוטומטית' : 'השינויים אושרו'}
                    </span>
                  )}
                  {m.changesApproved === false && (
                    <span style={{ fontSize: '0.76rem', opacity: 0.7 }}>
                      ✗ השינויים בוטלו
                    </span>
                  )}
                </div>
              )}
            </div>
            )
          })}
          {sending && !liveReplaced && (
            <div className="msg msg-assistant msg-live">
              {lastResolvedMode && (
                <div className="msg-mode-badge">
                  {workModeLabel(lastResolvedMode)}
                </div>
              )}
              <div className="msg-bubble">
                {liveStatus && (
                  <div className="live-status" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="live-pulse" />
                    <span style={{ flex: 1, minWidth: 0 }}>{liveStatus}</span>
                    <span
                      style={{ opacity: 0.55, fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                      title="זמן עבודה על הבקשה"
                    >
                      {Math.floor(workElapsed / 60)}:{String(workElapsed % 60).padStart(2, '0')}
                    </span>
                  </div>
                )}
                {liveText ? (
                  <div className="live-text">
                    <MarkdownMessage content={liveText} />
                    <span className="live-caret" />
                  </div>
                ) : (
                  <div className="typing" style={{ marginTop: 8 }}>
                    <span />
                    <span />
                    <span />
                  </div>
                )}
                {liveFiles.length > 0 && (
                  <div className="msg-files" style={{ marginTop: 10 }}>
                    {liveFiles.map((f) => (
                      <span key={f} className="file-chip">
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-composer">
          {!hasKey(provider) && (
            <div style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>
              חסר מפתח API ל-{AI_PROVIDERS.find((p) => p.id === provider)?.label}. הוסף בהגדרות.
            </div>
          )}
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '0.82rem' }} role="alert">
              {error}
            </div>
          )}
          {pickedElements.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {pickedElements.map((el, idx) => (
                <div
                  key={`${idx}-${el.selector || el.file}`}
                  className="element-chip"
                  title={el.file ? `${el.file}:${el.line}` : el.selector || ''}
                >
                  <span
                    style={{
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      background: '#2a9d8f',
                      color: '#fff',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px'
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span>
                    {el.component || el.tag || 'אלמנט'}
                    {el.text ? ` «${el.text.slice(0, 24)}${el.text.length > 24 ? '…' : ''}»` : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: 2, minHeight: 0 }}
                    title="הסר מהבחירה"
                    onClick={() => {
                      try {
                        iframeRef.current?.contentWindow?.postMessage(
                          { type: 'nf-blaze:deselect-index', index: idx },
                          '*'
                        )
                      } catch {
                        /* ignore */
                      }
                      // עדכון מיידי גם אם ה-iframe לא ענה (plugin ישן)
                      setPickedElements((els) => els.filter((_, i) => i !== idx))
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {pickedElements.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => {
                    setPickedElements([])
                    try {
                      iframeRef.current?.contentWindow?.postMessage(
                        { type: 'nf-blaze:clear-selection' },
                        '*'
                      )
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  נקה הכל
                </button>
              )}
            </div>
          )}
          {pendingBuildPrompt && !sending && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                flexWrap: 'wrap'
              }}
            >
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                {modeBlockedWrites
                  ? lastResolvedMode === 'PLAN'
                    ? 'הסוכן הציע שינוי אבל אנחנו במצב תכנון. עבור למצב ביצוע כדי לבצע.'
                    : 'הסוכן הציע שינוי אבל אנחנו במצב שאלה. עבור למצב ביצוע כדי לבצע.'
                  : `מצב ${lastResolvedMode || 'ASK/PLAN'} — ללא שינויי קבצים.`}
              </span>
              <button type="button" className="btn btn-primary" onClick={() => executePendingBuild()}>
                {modeBlockedWrites ? 'עבור לביצוע והרץ' : 'בצע את זה'}
              </button>
            </div>
          )}
          {plan && plan.stages.length > 0 && (
            <div className="plan-strip" title={plan.goal}>
              <span className="plan-strip-label">
                תוכנית · {plan.stages.filter((s) => s.status === 'done').length}/
                {plan.stages.length}
              </span>
              <div className="plan-strip-stages">
                {plan.stages.map((s) => (
                  <span
                    key={s.id}
                    className={`plan-stage plan-stage-${s.status}`}
                    title={s.notes ? `${s.title} — ${s.notes}` : s.title}
                  >
                    {s.status === 'done' ? '✓' : s.status === 'in_progress' ? '◐' : '○'} {s.title}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="model-row">
            <select
              className="select"
              value={workModeSel}
              onChange={(e) => setWorkModeSel(e.target.value as WorkModeSelection)}
              title="מצב עבודה — גובר על זיהוי אוטומטי"
              disabled={sending}
            >
              <option value="auto">אוטומטי</option>
              <option value="ASK">שאלה</option>
              <option value="PLAN">תכנון</option>
              <option value="BUILD">ביצוע</option>
            </select>
            <select
              className="select"
              value={provider}
              onChange={(e) => {
                const p = e.target.value as AiProvider
                setProvider(p)
                const def = getProvider(p).models.find((m) => m.recommended)?.id
                setModel(def || getProvider(p).models[0].id)
              }}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="composer-row">
            <textarea
              className="textarea"
              placeholder="תאר מה לבנות או לשנות… (Enter לשליחה, Shift+Enter לשורה חדשה)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              disabled={sending}
            />
            {sending ? (
              <button
                className="btn btn-danger"
                title="עצור"
                onClick={() => window.nfblaze.abortChat(project.id)}
              >
                <Square size={16} />
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => send()} disabled={!input.trim()}>
                <Send size={16} />
              </button>
            )}
          </div>
          <ContextUsageMeter usage={contextUsage} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head preview-toolbar">
          <div className="seg-tabs">
            <button
              className={`seg-tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
              disabled={!previewUrl && !isDevProject && previewPhase === 'idle'}
            >
              <Eye size={13} />
              תצוגה
            </button>
            <button
              className={`seg-tab ${mode === 'code' ? 'active' : ''}`}
              onClick={() => setMode('code')}
              disabled={!selectedFile}
            >
              <Code2 size={13} />
              קוד
            </button>
            <button
              className={`seg-tab ${mode === 'security' ? 'active' : ''}`}
              onClick={() => {
                setMode('security')
                if (!secScan.report && !secScan.running) void runSecurityScan()
              }}
              title="סריקת אבטחה — סודות בקוד, RLS, טבלאות פתוחות"
            >
              <ShieldCheck size={13} />
              אבטחה
              {secScan.report && !secScan.report.ok && (
                <span className="bp-badge">
                  {secScan.report.findings.length}
                </span>
              )}
            </button>
            <button
              className={`seg-tab ${mode === 'tests' ? 'active' : ''}`}
              onClick={() => setMode('tests')}
              title="הרצת בדיקות הפרויקט (npm test)"
            >
              <FlaskConical size={13} />
              בדיקות
              {testsResult === 'fail' && <span className="bp-badge">!</span>}
            </button>
          </div>

          <div className="address-bar" dir="ltr">
            <button
              className="btn btn-ghost"
              style={{ padding: 3, minHeight: 0 }}
              title={mode === 'preview' ? 'הפעל מחדש תצוגה' : 'רענון קובץ'}
              disabled={mode === 'preview' ? livePreviewBusy || sending : !selectedFile}
              onClick={() => {
                if (mode === 'code') {
                  if (selectedFile) void openFile(selectedFile)
                  return
                }
                void (async () => {
                  const needsDev = await window.nfblaze.isViteProject(project.id)
                  if (needsDev) {
                    await ensureVitePreview({ restart: true })
                    return
                  }
                  await showBestHtmlPreview()
                })()
              }}
            >
              <RefreshCw size={13} className={livePreviewBusy ? 'spin' : undefined} />
            </button>
            <span
              className="address-url"
              title={mode === 'preview' ? previewUrl || '' : selectedFile || ''}
            >
              {mode === 'preview'
                ? previewUrl || 'התצוגה עדיין לא רצה'
                : mode === 'code'
                  ? selectedFile || '—'
                  : mode === 'security'
                    ? 'סריקת אבטחה'
                    : 'בדיקות הפרויקט'}
            </span>
            {dirty && mode === 'code' && (
              <span className="dirty-dot" title="לא נשמר">
                ●
              </span>
            )}
            {/*
             * פתיחת התצוגה בדפדפן החיצוני — נשען על openExternal, שמאשר
             * http/https בלבד. תצוגה סטטית (nfblaze://) לא נפתחת שם, ולכן
             * הכפתור מוסתר במצב הזה במקום להיכשל בשקט.
             */}
            {mode === 'preview' && (
              <button
                className="address-open"
                disabled={livePreviewBusy}
                title={
                  externalPreviewUrl
                    ? 'פתח את התצוגה בדפדפן'
                    : 'הפעל את התצוגה ופתח אותה בדפדפן'
                }
                aria-label="פתח את התצוגה בדפדפן"
                onClick={() =>
                  void (async () => {
                    let url = externalPreviewUrl
                    if (!url) {
                      // התצוגה עוד לא רצה — מרימים אותה ואז פותחים.
                      // ה-ref מתעדכן סינכרונית בתוך ensureVitePreview, בניגוד
                      // ל-state שעדיין לא התרנדר בסגירה הזו.
                      const ok = await ensureVitePreview()
                      if (!ok) return
                      const fresh = livePreviewUrlRef.current
                      if (!fresh || !/^https?:\/\//i.test(fresh)) return
                      url = fresh
                    }
                    await window.nfblaze.openExternal(url)
                  })()
                }
              >
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`btn btn-ghost ${selectMode ? 'btn-primary' : ''}`}
              onClick={async () => {
                if (!previewUrl) {
                  const ok = await ensureVitePreview()
                  if (!ok && !previewUrl) return
                }
                setSelectMode((v) => !v)
              }}
              disabled={!previewUrl && livePreviewBusy}
              title="בחר אלמנטים בתצוגה להוראה לסוכן — אפשר כמה שרוצים"
            >
              <MousePointer2 size={15} />
              {pickedElements.length > 0 && (
                <span className="bp-badge" style={{ background: '#2a9d8f' }}>
                  {pickedElements.length}
                </span>
              )}
            </button>
            {mode === 'code' && (
              <button
                className="btn btn-primary"
                disabled={!dirty || saving || !selectedFile}
                onClick={() => saveFile()}
                title="שמירה (Ctrl+S)"
              >
                <Save size={15} />
                {saving ? '…' : 'שמור'}
              </button>
            )}
            <button
              className="btn btn-ghost"
              title="פתח תיקייה"
              onClick={() => window.nfblaze.openPath(project.folderPath)}
            >
              <FolderOpen size={15} />
            </button>
          </div>
        </div>
        {mode === 'preview' ? (
          <div className="preview-wrap">
            <div className="preview-device-bar">
              <button
                className={`btn btn-ghost ${deviceId === 'desktop' ? 'btn-primary' : ''}`}
                title="תצוגת מחשב"
                onClick={() => setDeviceId('desktop')}
              >
                <Monitor size={14} />
                <span style={{ fontSize: '0.72rem' }}>מחשב</span>
              </button>
              <Smartphone size={14} style={{ opacity: 0.6 }} />
              <select
                className="select"
                style={{ fontSize: '0.75rem', padding: '3px 8px', maxWidth: 190 }}
                value={deviceId === 'desktop' ? '' : deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value || 'desktop')
                }}
                title="בחר דגם מכשיר"
              >
                <option value="">בחר מכשיר…</option>
                <optgroup label="טלפונים">
                  {DEVICE_PRESETS.filter((d) => d.kind === 'phone').map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="טאבלטים">
                  {DEVICE_PRESETS.filter((d) => d.kind === 'tablet').map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              {deviceId !== 'desktop' && (
                <>
                  <button
                    className="btn btn-ghost"
                    title="סובב מכשיר"
                    onClick={() => setLandscape((v) => !v)}
                  >
                    <RotateCcw size={14} />
                  </button>
                  {(() => {
                    const p = getDevicePreset(deviceId)
                    if (!p) return null
                    const w = landscape ? p.height : p.width
                    const h = landscape ? p.width : p.height
                    return (
                      <span className="device-dims">
                        {w}×{h}
                        {deviceScale < 1 ? ` · ${Math.round(deviceScale * 100)}%` : ''}
                      </span>
                    )
                  })()}
                </>
              )}
            </div>
            {previewServeMode === 'fallback' && (
              <div className="preview-select-banner preview-fallback-banner">
                מצב גיבוי — תצוגה סטטית בלי עדכון חי. אפשר להפעיל מחדש תצוגה לנסות שרת פיתוח.
              </div>
            )}
            {runtimeErrors.length > 0 && (
              <div className="preview-select-banner preview-runtime-error-banner">
                <span className="preview-runtime-error-text" dir="ltr">
                  ⚠ {runtimeErrors[runtimeErrors.length - 1].message.split('\n')[0].slice(0, 160)}
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={sending}
                  onClick={() => {
                    const detail = runtimeErrors
                      .map((e) => (e.source ? `${e.source}\n${e.message}` : e.message))
                      .join('\n\n')
                    setRuntimeErrors([])
                    void send(
                      `יש שגיאת ריצה (runtime) בתצוגה המקדימה. אתר את הגורם ותקן:\n\n${detail}`,
                      'BUILD'
                    )
                  }}
                >
                  תן לסוכן לתקן
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRuntimeErrors([])}
                  title="התעלם"
                >
                  ✕
                </button>
              </div>
            )}
            {selectMode && previewUrl && (
              <div className="preview-select-banner">
                מצב בחירה פעיל — לחיצה מוסיפה אלמנט, לחיצה חוזרת מסירה. אפשר לבחור כמה
                שרוצים{pickedElements.length ? ` (נבחרו ${pickedElements.length})` : ''} — סיום
                בלחיצה על כפתור הבחירה
              </div>
            )}
            {(previewPhase === 'installing' ||
              previewPhase === 'starting' ||
              livePreviewBusy) &&
              !previewUrl && (
              <div className="preview-status-panel">
                <div className="preview-status-title">
                  <span className="live-pulse" />
                  {previewPhase === 'installing'
                    ? 'מתקין תלויות'
                    : previewPhase === 'starting'
                      ? 'מרים שרת'
                      : previewStatusMsg || 'מכין תצוגה…'}
                </div>
                <div className="preview-status-sub">
                  {previewPhase === 'installing'
                    ? 'ההתקנה הראשונה עשויה לקחת עשרות שניות — אל תסגור את החלון.'
                    : 'ממתין ששרת הפיתוח יהיה מוכן…'}
                </div>
                {previewLogTail.length > 0 && (
                  <pre className="preview-status-log" dir="ltr">
                    {previewLogTail.slice(-12).join('\n')}
                  </pre>
                )}
              </div>
            )}
            {(previewPhase === 'error' || previewPhase === 'crashed') && !previewUrl && (
              <div className="preview-status-panel preview-status-error">
                <div className="preview-status-title">
                  {previewPhase === 'crashed' ? 'שרת הפיתוח קרס' : 'התצוגה נכשלה'}
                </div>
                <pre className="preview-status-log" dir="ltr">
                  {previewErrorText || previewStatusMsg || 'שגיאה לא ידועה'}
                </pre>
                <div className="preview-status-actions">
                  <button
                    className="btn btn-primary"
                    disabled={sending}
                    onClick={() => askAgentToFixPreview()}
                  >
                    תן לסוכן לתקן
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={livePreviewBusy}
                    onClick={() => void ensureVitePreview({ restart: true })}
                  >
                    הפעל מחדש תצוגה
                  </button>
                </div>
              </div>
            )}
            {previewUrl && (
              <>
                {previewErrorText && previewPhase === 'error' && (
                  <div className="preview-error-overlay">
                    <div className="preview-status-title">שגיאת קומפילציה בתצוגה</div>
                    <pre className="preview-status-log" dir="ltr">
                      {previewErrorText}
                    </pre>
                    <div className="preview-status-actions">
                      <button
                        className="btn btn-primary"
                        disabled={sending}
                        onClick={() => askAgentToFixPreview()}
                      >
                        תן לסוכן לתקן
                      </button>
                    </div>
                  </div>
                )}
                {livePreviewBusy && previewPhase !== 'ready' && previewPhase !== 'fallback' && (
                  <div className="preview-select-banner">
                    {previewStatusMsg || 'מעלה תצוגה…'}
                  </div>
                )}
                <div
                  className={`device-stage ${deviceId === 'desktop' ? 'desktop' : ''}`}
                  ref={stageRef}
                >
                  {(() => {
                    const preset = deviceId !== 'desktop' ? getDevicePreset(deviceId) : null
                    const w = preset ? (landscape ? preset.height : preset.width) : undefined
                    const h = preset ? (landscape ? preset.width : preset.height) : undefined
                    return (
                      <div
                        className={`device-frame ${preset?.kind === 'tablet' ? 'tablet' : ''}`}
                        style={
                          preset
                            ? { width: w, height: h, zoom: deviceScale }
                            : undefined
                        }
                      >
                        <iframe
                          ref={iframeRef}
                          key={previewKey}
                          className="preview-frame"
                          src={previewUrl}
                          title="תצוגה מקדימה"
                          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                          allow="accelerometer; clipboard-write"
                          onLoad={() => {
                            setRuntimeErrors([])
                            try {
                              iframeRef.current?.contentWindow?.postMessage(
                                { type: 'nf-blaze:set-select-mode', enabled: selectMode },
                                '*'
                              )
                            } catch {
                              /* ignore */
                            }
                          }}
                        />
                      </div>
                    )
                  })()}
                </div>
              </>
            )}
            {!previewUrl &&
              !livePreviewBusy &&
              previewPhase !== 'error' &&
              previewPhase !== 'crashed' &&
              previewPhase !== 'installing' &&
              previewPhase !== 'starting' && (
                <div className="preview-empty">
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8 }}>
                    תצוגה ועורך קוד
                  </div>
                  <div style={{ maxWidth: 360, lineHeight: 1.5 }}>
                    בחר קובץ מהעץ כדי לערוך אותו, או בקש מה-AI לבנות — ואז תראה תצוגה חיה.
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 16 }}
                    onClick={() => showBestHtmlPreview()}
                  >
                    טען תצוגה מקדימה
                  </button>
                </div>
              )}
          </div>
        ) : mode === 'security' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
              <strong>סריקת אבטחה</strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                סודות בקוד · env בקבצי build · RLS מתירני · טבלאות Supabase פתוחות
              </span>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginInlineStart: 'auto' }}
                disabled={secScan.running}
                onClick={() => void runSecurityScan()}
              >
                {secScan.running ? (
                  <>
                    <RefreshCw size={13} className="spin" /> סורק…
                  </>
                ) : (
                  'סרוק עכשיו'
                )}
              </button>
            </div>
            {secScan.scannedAt && !secScan.running && (
              <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginBottom: 10 }}>
                סריקה אחרונה: {secScan.scannedAt}
              </div>
            )}
            {secScan.error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{secScan.error}</div>
            )}
            {secScan.report && secScan.report.ok && (
              <div
                style={{
                  border: '1px solid var(--success)',
                  borderRadius: 10,
                  padding: 16,
                  color: 'var(--success)',
                  fontSize: '0.9rem'
                }}
              >
                ✓ לא נמצאו בעיות אבטחה — הפרויקט נקי לפרסום.
              </div>
            )}
            {secScan.report &&
              secScan.report.findings.map((f) => (
                <div
                  key={f.id}
                  style={{
                    border: `1px solid ${f.severity === 'block' ? 'var(--danger)' : 'var(--border-strong)'}`,
                    borderRadius: 10,
                    padding: '12px 14px',
                    marginBottom: 10
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <TriangleAlert
                      size={15}
                      style={{
                        color: f.severity === 'block' ? 'var(--danger)' : 'var(--warning, #e8a04a)'
                      }}
                    />
                    <strong style={{ fontSize: '0.88rem' }}>{f.title}</strong>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: f.severity === 'block' ? 'var(--danger)' : 'var(--text-dim)'
                      }}
                    >
                      {f.severity === 'block' ? 'חסימה' : 'אזהרה'}
                    </span>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginInlineStart: 'auto' }}
                      disabled={sending}
                      onClick={() =>
                        void send(
                          `סריקת האבטחה מצאה בעיה — תקן אותה:\n\n${f.title}\nנמצא: ${f.found}\nלמה מסוכן: ${f.why}${f.path ? `\nקובץ: ${f.path}` : ''}${f.fixHint ? `\nהצעת תיקון:\n${f.fixHint}` : ''}`,
                          'BUILD'
                        )
                      }
                    >
                      תן לסוכן לתקן
                    </button>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{f.found}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 4 }}>
                    {f.why}
                    {f.path ? ` · ${f.path}` : ''}
                  </div>
                </div>
              ))}
            {!secScan.report && secScan.running && (
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>סורק את הפרויקט…</div>
            )}
          </div>
        ) : mode === 'tests' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0' }}
            >
              <FlaskConical size={18} style={{ color: 'var(--accent)' }} />
              <strong>בדיקות הפרויקט</strong>
              {testsResult === 'pass' && (
                <span style={{ color: 'var(--success)', fontSize: '0.82rem' }}>✓ עברו</span>
              )}
              {testsResult === 'fail' && (
                <span style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>✗ נכשלו</span>
              )}
              <button
                className="btn btn-primary btn-sm"
                style={{ marginInlineStart: 'auto' }}
                disabled={testsRunning}
                onClick={() => void runProjectTests()}
              >
                {testsRunning ? 'מריץ…' : 'הרץ בדיקות (npm test)'}
              </button>
              {testsResult === 'fail' && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={sending}
                  onClick={() =>
                    void send(
                      `הבדיקות של הפרויקט נכשלו. הרץ אותן, אתר את הכשלים ותקן:\n\n${testsLines.slice(-60).join('\n')}`,
                      'BUILD'
                    )
                  }
                >
                  תן לסוכן לתקן
                </button>
              )}
            </div>
            <div className="terminal-out" ref={testsRef} style={{ flex: 1, margin: 12 }}>
              {testsLines.length === 0 ? (
                <div style={{ color: 'var(--text-dim)' }}>
                  מריץ את סקריפט ה-test של הפרויקט (Vitest וכו׳) ומציג את הפלט כאן.
                </div>
              ) : (
                testsLines.map((line, i) => (
                  <div key={`${i}-${line.slice(0, 24)}`} className="terminal-line">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : mode === 'code' && selectedFile ? (
          <CodeEditor
            path={selectedFile}
            value={draftContent}
            onChange={(v) => {
              setDraftContent(v)
              setDirty(v !== fileContent)
            }}
            onSave={() => {
              void saveFile()
            }}
          />
        ) : (
          <div className="preview-empty">
            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8 }}>
              תצוגה ועורך קוד
            </div>
            <div style={{ maxWidth: 360, lineHeight: 1.5 }}>
              בחר קובץ מהעץ כדי לערוך אותו (כמו ב-Cursor), או בקש מה-AI לבנות — ואז תראה תצוגה חיה.
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => showBestHtmlPreview()}
            >
              טען תצוגה מקדימה
            </button>
          </div>
        )}
      </section>

      <section className="panel panel-files">
        <div className="panel-head">
          <h3>קבצים</h3>
        </div>
        <div className="file-tree">
          {tree.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              התיקייה ריקה — בקש מה-AI להתחיל לבנות.
            </div>
          ) : (
            <FileTree nodes={tree} selected={selectedFile} onSelect={(path) => openFile(path)} />
          )}
        </div>
      </section>

      <section className={`bottom-panel ${bottomCollapsed ? 'collapsed' : ''}`}>
        <div className="bp-tabs">
          <button
            className={`bp-tab ${bottomTab === 'terminal' && !bottomCollapsed ? 'active' : ''}`}
            onClick={() => {
              setBottomTab('terminal')
              setBottomCollapsed(false)
            }}
          >
            <Terminal size={13} />
            טרמינל
          </button>
          <button
            className={`bp-tab ${bottomTab === 'console' && !bottomCollapsed ? 'active' : ''}`}
            onClick={() => {
              setBottomTab('console')
              setBottomCollapsed(false)
            }}
            title="פלט שרת הפיתוח והפקודות שהסוכן מריץ"
          >
            קונסול
            {isDevProject &&
              (previewPhase === 'installing' ||
                previewPhase === 'starting' ||
                (previewPhase === 'ready' && previewServeMode === 'live')) && (
                <span className="live-pulse" title="שרת הפיתוח פעיל" />
              )}
          </button>
          <button
            className={`bp-tab ${bottomTab === 'problems' && !bottomCollapsed ? 'active' : ''}`}
            onClick={() => {
              setBottomTab('problems')
              setBottomCollapsed(false)
            }}
            title="שגיאות ריצה וקומפילציה מהתצוגה"
          >
            <TriangleAlert size={13} />
            בעיות
            {problemsCount > 0 && <span className="bp-badge">{problemsCount}</span>}
          </button>
          <button
            className="btn btn-ghost"
            style={{ marginInlineStart: 'auto', padding: '2px 6px' }}
            title={bottomCollapsed ? 'הרחב פאנל' : 'כווץ פאנל'}
            onClick={() => setBottomCollapsed((v) => !v)}
          >
            {bottomCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        <div className="bp-body">
          {bottomTab === 'terminal' && (
            <>
              <div className="terminal-actions" style={{ flexShrink: 0 }}>
                <button
                  className="btn btn-ghost"
                  disabled={shellBusy}
                  onClick={() => runNpm(['install'])}
                >
                  <Package size={14} />
                  npm install
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={shellBusy}
                  onClick={() => runNpm(['run', 'build'])}
                >
                  npm run build
                </button>
                <button className="btn btn-ghost" onClick={() => setShellLines([])}>
                  נקה
                </button>
              </div>
              <div
                className="terminal-out"
                ref={shellRef}
                style={{ flex: 1, cursor: 'text' }}
                onClick={() => shellInputRef.current?.focus()}
              >
                {shellLines.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)' }}>
                    טרמינל מאובטח — הקלד פקודת npm / pnpm / yarn (למשל: npm install dayjs)
                  </div>
                ) : (
                  shellLines.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 24)}`} className="terminal-line">
                      {line}
                    </div>
                  ))
                )}
              </div>
              <div
                className="bp-shell-input-row"
                onClick={() => shellInputRef.current?.focus()}
              >
                <span className="bp-shell-prompt">{shellBusy ? '…' : '$'}</span>
                <input
                  ref={shellInputRef}
                  className="bp-shell-input"
                  placeholder="npm install <package> · npm run build · yarn add ..."
                  value={shellInput}
                  autoFocus
                  onChange={(e) => setShellInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitShellInput()
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  dir="ltr"
                />
              </div>
            </>
          )}

          {bottomTab === 'console' && (
            <>
              <div className="terminal-actions" style={{ flexShrink: 0 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                  שרת הפיתוח + פקודות שהסוכן מריץ
                </span>
                <button
                  className="btn btn-ghost"
                  style={{ marginInlineStart: 'auto' }}
                  onClick={() => setTerminalLines([])}
                >
                  נקה
                </button>
              </div>
              <div className="terminal-out" ref={terminalRef} style={{ flex: 1 }}>
                {terminalLines.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)' }}>
                    כאן מוזרם פלט שרת הפיתוח (npm run dev) וכל פקודה שהסוכן מריץ.
                  </div>
                ) : (
                  terminalLines.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 24)}`} className="terminal-line">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {bottomTab === 'problems' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {problemsCount === 0 ? (
                <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                  ✓ אין בעיות — שגיאות ריצה וקומפילציה מהתצוגה יופיעו כאן.
                </div>
              ) : (
                <>
                  {previewErrorText &&
                    (previewPhase === 'error' || previewPhase === 'crashed') && (
                      <div className="bp-problem">
                        <TriangleAlert
                          size={15}
                          style={{ color: 'var(--danger, #d33)', flexShrink: 0, marginTop: 2 }}
                        />
                        <div className="bp-problem-msg">{previewErrorText.slice(0, 800)}</div>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={sending}
                          onClick={() => askAgentToFixPreview()}
                        >
                          תן לסוכן לתקן
                        </button>
                      </div>
                    )}
                  {runtimeErrors.map((e, i) => (
                    <div className="bp-problem" key={`${i}-${e.message.slice(0, 24)}`}>
                      <TriangleAlert
                        size={15}
                        style={{ color: 'var(--warning, #e8a04a)', flexShrink: 0, marginTop: 2 }}
                      />
                      <div className="bp-problem-msg">
                        {e.source ? `${e.source}\n` : ''}
                        {e.message.slice(0, 600)}
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={sending}
                        onClick={() => {
                          const detail = e.source ? `${e.source}\n${e.message}` : e.message
                          setRuntimeErrors((prev) => prev.filter((x) => x !== e))
                          void send(
                            `יש שגיאת ריצה (runtime) בתצוגה המקדימה. אתר את הגורם ותקן:\n\n${detail}`,
                            'BUILD'
                          )
                        }}
                      >
                        תן לסוכן לתקן
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="התעלם"
                        onClick={() => setRuntimeErrors((prev) => prev.filter((x) => x !== e))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {diffSnapshotId && (
        <ChangesDiffModal
          projectId={project.id}
          snapshotId={diffSnapshotId}
          onClose={() => setDiffSnapshotId(null)}
        />
      )}
      {showIntegrations && (
        <IntegrationsPanel
          projectId={project.id}
          projectName={project.name}
          onClose={() => {
            setShowIntegrations(false)
            refreshVercelMeta().catch(() => undefined)
          }}
          onAgentFix={(message) => {
            void send(message, 'BUILD')
          }}
        />
      )}
    </div>
  )
}
