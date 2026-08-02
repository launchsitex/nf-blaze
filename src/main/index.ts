import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { join, resolve, normalize } from 'path'
import { existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../shared/ipc'
import type {
  AiProvider,
  AppSettings,
  ProjectMeta,
  ShellRunRequest,
  WorkModeSelection
} from '../shared/types'
import { getDefaultModel } from '../shared/types'
import {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  loadChat,
  saveChat,
  clearChat,
  loadChatsIndex,
  createChat,
  switchChat,
  deleteChat,
  loadSettingsRaw,
  saveSettings,
  getDataRoot,
  loadProjectPlan,
  loadProjectMemory
} from './services/storage'
import {
  setApiKey,
  getApiKey,
  hasApiKey,
  clearApiKey,
  getKeyStatus,
  setGithubToken,
  clearGithubToken,
  getGithubToken
} from './services/secrets'
import { recordDecision } from './services/trust'
import { configureBundledBrowser } from './services/browser-env'
import { loadIntegrations } from './services/integrations/store'
import {
  validateGithubToken,
  listGithubRepos,
  createGithubRepo,
  linkGithubRepo,
  pushGithubProject,
  publishToGithub,
  disconnectGithub,
  listGithubBranches,
  setGithubBranch,
  cloneGithubRepo,
  repoNameFromUrl
} from './services/integrations/github'
import {
  connectSupabase,
  connectSupabaseProjectFromAccount,
  disconnectSupabase,
  testSupabaseConnection
} from './services/integrations/supabase'
import { connectProviderWithOAuth } from './services/integrations/oauth_connect'
import { cancelOAuthFlow } from './services/integrations/oauth'
import {
  clearSupabaseAccount,
  listSupabaseProjects,
  loadSupabaseAccount
} from './services/integrations/supabase_account'
import {
  validateVercelToken,
  listVercelProjects,
  deployToVercel,
  redeployVercel,
  disconnectVercel,
  fetchDeploymentBuildLog,
  setVercelUserToken,
  clearVercelUserToken,
  setVercelPlatformCredentials,
  clearVercelPlatformToken,
  vercelTokenStatus
} from './services/integrations/vercel'
import type {
  OAuthProviderId,
  SupabaseConnectInput,
  VercelDeployInput
} from '../shared/types'
import {
  buildFileTree,
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  resolveSafePath
} from './services/filesystem'
import { sendChatMessage, abortChat, estimateProjectContext } from './services/ai/agent'
import {
  undoLatestSnapshot,
  getLatestSnapshotId,
  listSnapshots,
  restoreToSnapshot,
  getSnapshotDiff
} from './services/snapshots'
import { runAllowlistedShell } from './services/shell'
import {
  openProjectIndex,
  refreshProjectIndexForProject,
  getProjectIndexInfo
} from './services/project_index'
import {
  listTemplates,
  copyTemplateToFolder,
  installTemplateDeps,
  writeTemplateMeta,
  getTemplateInfo,
  type TemplateId
} from './services/templates'
import type { ProjectTemplateId } from '../shared/types'
import {
  registerPreviewScheme,
  registerPreviewProtocol,
  buildPreviewUrl
} from './services/preview-protocol'
import {
  ensureLivePreview,
  restartLivePreview,
  stopLivePreview,
  stopAllLivePreviews,
  getLivePreviewUrl,
  getLivePreviewStatus,
  isViteProject,
  projectNeedsDevServer
} from './services/preview-live'
import type { PreviewLiveEvent } from './services/preview-live'
import { stopAllMcpServers } from '../../agent/mcp/manager'
import {
  startAutoUpdates,
  getUpdateState,
  checkNow,
  retryUpdate,
  installUpdate,
  snoozeUpdate,
  isUpdateRequired
} from './services/app_updates'
import {
  listMcpServers,
  saveMcpServer,
  removeMcpServer,
  testMcpServer,
  type McpServerEntry
} from './services/mcp_settings'
import { probeRuntimeEnv } from './services/runtime-env'
import { runPublishSecurityGate } from './services/security'
import { submitFeedback } from './services/feedback'
import type { FeedbackSubmitInput } from '../shared/types'
import { summarizeToNewChat } from './services/chat_summarize'
import {
  getLicenseStatus,
  activateLicense,
  clearLicense,
  revalidateOnline
} from './services/license'
import { LICENSE_REVALIDATE_INTERVAL_MS } from '../shared/license'
import type { PreviewElementSelection } from '../shared/types'

// Must run before app is ready
registerPreviewScheme()

let mainWindow: BrowserWindow | null = null

function findHtmlInTree(nodes: ReturnType<typeof buildFileTree>): string | null {
  const preferred = ['index.html', 'index.htm', 'home.html']
  const all: string[] = []
  function walk(list: typeof nodes): void {
    for (const n of list) {
      if (!n.isDirectory && /\.html?$/i.test(n.name)) all.push(n.relativePath)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  for (const p of preferred) {
    const hit = all.find((x) => x.replace(/\\/g, '/').toLowerCase() === p)
    if (hit) return hit
  }
  return all[0] || null
}

/** גובה סרגל האפליקציה — חייב להיות זהה ל-.topbar ב-CSS */
const TITLE_BAR_HEIGHT = 56

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'NF-Blaze',
    backgroundColor: '#0c0f14',
    // כותרת מערכת מוסתרת: כפתורי החלון נשארים מקוריים (Snap Layouts,
    // נגישות) אבל נצבעים בצבעי המערכת ויושבים בתוך סרגל האפליקציה.
    // רק ב-Windows — במערכות אחרות נשארת מסגרת רגילה.
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#0c0f14',
            symbolColor: '#e8e8ea',
            height: TITLE_BAR_HEIGHT
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // בגרסה ארוזה אין DevTools — חוסם עיון בקוד ה-renderer ובתעבורת ה-IPC
      devTools: !app.isPackaged
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * ייבוא תיקייה קיימת כפרויקט — משותף לייבוא ידני ולשכפול מ-GitHub.
 * לא נוגע בקבצים; רק מתקין תלויות אם חסרות ומרים תצוגה חיה.
 */
async function importExistingFolder(payload: {
  name: string
  description?: string
  folderPath: string
  provider: AiProvider
  model?: string
}): Promise<ProjectMeta> {
  if (!payload.name?.trim()) throw new Error('יש להזין שם לפרויקט')
  if (!payload.folderPath || !existsSync(payload.folderPath)) {
    throw new Error('יש לבחור תיקייה קיימת במחשב')
  }
  if (!existsSync(join(payload.folderPath, 'package.json'))) {
    throw new Error(
      "לא נמצא package.json בתיקייה. ייבוא נתמך לפרויקטי Node/JavaScript (React, Vite, Next וכו')"
    )
  }
  const already = listProjects().find(
    (p) => p.folderPath.toLowerCase() === payload.folderPath.toLowerCase()
  )
  if (already) {
    throw new Error(`התיקייה כבר מקושרת לפרויקט «${already.name}»`)
  }

  // התקנת תלויות אם חסרות — לא מעתיקים תבנית ולא נוגעים בקבצים קיימים
  if (!existsSync(join(payload.folderPath, 'node_modules'))) {
    const install = await installTemplateDeps(payload.folderPath)
    if (!install.ok) throw new Error(install.summary)
  }

  const now = new Date().toISOString()
  const saved = saveProject({
    id: uuidv4(),
    name: payload.name.trim(),
    description: (payload.description || '').trim(),
    folderPath: payload.folderPath,
    createdAt: now,
    updatedAt: now,
    provider: payload.provider,
    model: payload.model || getDefaultModel(payload.provider)
    // templateId נשאר ריק — פרויקט מיובא
  })

  if (projectNeedsDevServer(payload.folderPath)) {
    try {
      await ensureLivePreview(saved.id)
    } catch {
      /* Workspace will retry and show status / error */
    }
  }

  return saved
}

/**
 * ערוצי IPC שמותרים גם בלי רישיון: הפעלת מפתח, בדיקת סביבת ריצה,
 * גרסה, פתיחת קישור חיצוני, וקריאת הגדרות כדי שהמסך יוכל לעלות בכלל.
 *
 * ‏`FEEDBACK_SUBMIT` פתוח בכוונה: מי שתקוע בשער הרישיון (פג תוקף, חריגת
 * מושבים, אין מפתח) חייב דרך לבקש רישיון או חידוש מתוך המערכת — אחרת
 * המצב היחיד שבו הוא הכי צריך אותנו הוא בדיוק המצב שבו הוא לא יכול לפנות.
 * ההגנה מפני ניצול היא בשרת: פנייה בלי מפתח חתום מסומנת «לא מאומתת»
 * ומוגבלת בקצב לפי כתובת IP.
 */
const LICENSE_FREE_CHANNELS: ReadonlySet<string> = new Set([
  IPC.LICENSE_STATUS,
  IPC.LICENSE_ACTIVATE,
  IPC.LICENSE_CLEAR,
  IPC.LICENSE_REVALIDATE,
  IPC.FEEDBACK_SUBMIT,
  IPC.APP_GET_VERSION,
  IPC.APP_RUNTIME_ENV,
  IPC.APP_OPEN_EXTERNAL,
  IPC.SETTINGS_GET,
  IPC.APP_UPDATE_STATUS,
  IPC.APP_UPDATE_CHECK,
  IPC.APP_UPDATE_RETRY,
  IPC.APP_UPDATE_INSTALL
])

/**
 * הערוצים שנשארים פתוחים כשעדכון חובה ממתין — בדיוק מה שדרוש כדי
 * להציג את שער העדכון, להוריד ולהתקין. כל השאר חסום, כך שגם עקיפה של
 * המסך לא תפתח את המערכת.
 */
const UPDATE_FREE_CHANNELS: ReadonlySet<string> = new Set([
  IPC.APP_UPDATE_STATUS,
  IPC.APP_UPDATE_CHECK,
  IPC.APP_UPDATE_RETRY,
  IPC.APP_UPDATE_INSTALL,
  // בלי זה כפתור «אחר כך» היה נחסם על ידי השומר שהוא עצמו אמור לפתוח
  IPC.APP_UPDATE_SNOOZE,
  IPC.APP_GET_VERSION,
  IPC.APP_OPEN_EXTERNAL,
  IPC.LICENSE_STATUS,
  IPC.SETTINGS_GET
])

/**
 * אכיפת רישיון בתהליך הראשי — לא רק במסך.
 * מסך חסימה ב-renderer הוא UI בלבד וניתן לעקיפה; שכבת ה-IPC היא הגבול האמיתי.
 * עוטף את `ipcMain.handle` פעם אחת, כך שכל ערוץ — כולל ערוצים שייווספו
 * בעתיד — חסום כברירת מחדל אלא אם נכלל במפורש ב-LICENSE_FREE_CHANNELS.
 */
function installIpcLicenseGuard(): void {
  const original = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown
  ) =>
    original(channel, (event, ...args) => {
      // עדכון חובה קודם לכל — גם למי שהרישיון שלו תקין
      if (isUpdateRequired() && !UPDATE_FREE_CHANNELS.has(channel)) {
        throw new Error('נדרש עדכון גרסה כדי להמשיך')
      }
      if (!LICENSE_FREE_CHANNELS.has(channel)) {
        const status = getLicenseStatus()
        if (!status.ok) throw new Error(`נדרש מפתח רישיון · ${status.messageHe}`)
      }
      return listener(event, ...(args as never[]))
    })) as typeof ipcMain.handle
}

function registerIpc(): void {
  installIpcLicenseGuard()

  ipcMain.handle(IPC.SETTINGS_GET, () => {
    const settings = loadSettingsRaw()
    const keys = getKeyStatus()
    return {
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      theme: settings.theme,
      agentEngine: settings.agentEngine ?? 'legacy',
      onboardingSeen: settings.onboardingSeen ?? false,
      vercelTeamId: settings.vercelTeamId,
      vercelPlatformTeamId: settings.vercelPlatformTeamId,
      ...keys
    }
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_e, partial: Partial<AppSettings>) => {
    const {
      openaiApiKey: _o,
      anthropicApiKey: _a,
      geminiApiKey: _g,
      ...safe
    } = partial as AppSettings
    saveSettings(safe)
    return {
      ...loadSettingsRaw(),
      openaiApiKey: undefined,
      anthropicApiKey: undefined,
      geminiApiKey: undefined,
      ...getKeyStatus()
    }
  })

  ipcMain.handle(IPC.SETTINGS_SET_KEY, (_e, provider: AiProvider, key: string) => {
    if (!['openai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'lmstudio'].includes(provider)) {
      throw new Error('ספק לא חוקי')
    }
    setApiKey(provider, key)
    return getKeyStatus()
  })

  ipcMain.handle(IPC.SETTINGS_HAS_KEY, (_e, provider: AiProvider) => hasApiKey(provider))

  ipcMain.handle(IPC.LICENSE_STATUS, () => getLicenseStatus())
  ipcMain.handle(IPC.LICENSE_ACTIVATE, async (_e, key: string) => {
    const status = activateLicense(key)
    // אחרי הפעלה מוצלחת — אימות מקוון מיידי, כדי לעגן זמן אמין, לתפוס ביטול,
    // ולתפוס מושב. **ממתינים לתשובה** (עד 8 שנ' timeout) ולא מפעילים ברקע:
    // אחרת מחשב שחורג מהמכסה היה מקבל «רישיון פעיל» ורק אז מושלך החוצה.
    // כשל רשת מחזיר את הסטטוס המקומי — ההפעלה מצליחה, וחלון החסד הקצר
    // עד האימות הראשון (ACTIVATION_GRACE_MS) הוא מה שאוכף השלמה מאוחרת.
    if (status.ok) return await revalidateOnline().catch(() => status)
    return status
  })
  ipcMain.handle(IPC.LICENSE_CLEAR, () => clearLicense())
  ipcMain.handle(IPC.LICENSE_REVALIDATE, () => revalidateOnline())

  ipcMain.handle(IPC.SECURITY_SCAN, async (_e, projectId: string) => {
    const project = getProject(projectId)
    if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')
    return runPublishSecurityGate({ projectId, folderPath: project.folderPath })
  })

  // משוב/דיווח — פנוי-רישיון (ראה LICENSE_FREE_CHANNELS). עם מפתח שמור
  // הפנייה מאומתת בשרת; בלעדיו היא מסומנת «לא מאומתת» ומוגבלת בקצב לפי IP.
  ipcMain.handle(IPC.FEEDBACK_SUBMIT, async (_e, input: FeedbackSubmitInput) =>
    submitFeedback(input)
  )

  ipcMain.handle(IPC.MCP_LIST, () => listMcpServers())
  ipcMain.handle(IPC.MCP_SAVE, (_e, entry: McpServerEntry) => saveMcpServer(entry))
  ipcMain.handle(IPC.MCP_REMOVE, (_e, name: string) => removeMcpServer(name))
  ipcMain.handle(IPC.MCP_TEST, (_e, entry: McpServerEntry) => testMcpServer(entry))

  ipcMain.handle(IPC.SETTINGS_CLEAR_KEY, (_e, provider: AiProvider) => {
    clearApiKey(provider)
    return getKeyStatus()
  })

  ipcMain.handle(IPC.PROJECTS_LIST, () => listProjects())

  ipcMain.handle(IPC.PROJECTS_GET, (_e, id: string) => getProject(id))

  ipcMain.handle(IPC.PROJECTS_LIST_TEMPLATES, () => listTemplates())

  ipcMain.handle(IPC.PROJECTS_PLAN_GET, (_e, projectId: string) => loadProjectPlan(projectId))

  ipcMain.handle(IPC.PROJECTS_MEMORY_GET, (_e, projectId: string) => loadProjectMemory(projectId))

  ipcMain.handle(IPC.PROJECTS_PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'בחר תיקייה לפרויקט',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    IPC.PROJECTS_CREATE,
    async (
      _e,
      payload: {
        name: string
        description: string
        folderPath: string
        provider: AiProvider
        model?: string
        templateId?: ProjectTemplateId
      }
    ) => {
      if (!payload.name?.trim()) throw new Error('יש להזין שם לפרויקט')
      if (!payload.folderPath || !existsSync(payload.folderPath)) {
        throw new Error('יש לבחור תיקייה קיימת במחשב')
      }
      const templateId = (payload.templateId || 'web-app') as TemplateId
      if (!getTemplateInfo(templateId)) {
        throw new Error('יש לבחור תבנית התחלה')
      }

      // 1) Copy template → user folder
      copyTemplateToFolder(templateId, payload.folderPath)
      writeTemplateMeta(payload.folderPath, templateId)

      // 2) Install deps before registering — agent starts only after this succeeds
      const install = await installTemplateDeps(payload.folderPath)
      if (!install.ok) {
        throw new Error(install.summary)
      }

      // 3) Register project
      const now = new Date().toISOString()
      const meta: ProjectMeta = {
        id: uuidv4(),
        name: payload.name.trim(),
        description: (payload.description || '').trim(),
        folderPath: payload.folderPath,
        createdAt: now,
        updatedAt: now,
        provider: payload.provider,
        model: payload.model || getDefaultModel(payload.provider),
        templateId
      }
      const saved = saveProject(meta)

      // 4) Warm live preview before UI opens (scaffold + running preview)
      if (projectNeedsDevServer(payload.folderPath)) {
        try {
          await ensureLivePreview(saved.id)
        } catch {
          /* Workspace will retry and show status / error */
        }
      }

      return saved
    }
  )

  ipcMain.handle(
    IPC.PROJECTS_IMPORT,
    async (
      _e,
      payload: {
        name: string
        description?: string
        folderPath: string
        provider: AiProvider
        model?: string
      }
    ) => importExistingFolder(payload)
  )

  ipcMain.handle(
    IPC.PROJECTS_IMPORT_GITHUB,
    async (
      _e,
      payload: {
        repoUrl: string
        name?: string
        description?: string
        folderPath: string
        provider: AiProvider
        model?: string
      }
    ) => {
      if (!payload.folderPath) throw new Error('יש לבחור תיקייה במחשב לשכפול')
      const { cloneUrl, folderPath } = await cloneGithubRepo({
        repoUrl: payload.repoUrl,
        targetDir: payload.folderPath
      })
      const name = payload.name?.trim() || repoNameFromUrl(cloneUrl) || 'פרויקט מ-GitHub'
      try {
        return await importExistingFolder({
          name,
          description: payload.description,
          folderPath,
          provider: payload.provider,
          model: payload.model
        })
      } catch (err) {
        // הריפו כבר על הדיסק — בלי ההבהרה הזו המשתמש ינסה שוב לאותה
        // תיקייה ויקבל «כבר מכיל ריפוזיטורי git» בלי להבין למה
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(
          `${message}\n\nהריפו שוכפל בהצלחה אל ${folderPath} — אפשר לפתוח אותו משם, או למחוק את התיקייה ולנסות ריפו אחר.`,
          { cause: err }
        )
      }
    }
  )
  ipcMain.handle(IPC.PROJECTS_UPDATE, (_e, id: string, partial: Partial<ProjectMeta>) => {
    const current = getProject(id)
    if (!current) throw new Error('הפרויקט לא נמצא')
    const next: ProjectMeta = {
      ...current,
      ...partial,
      id: current.id,
      folderPath: current.folderPath,
      updatedAt: new Date().toISOString()
    }
    return saveProject(next)
  })

  ipcMain.handle(IPC.PROJECTS_DELETE, (_e, id: string) => {
    deleteProject(id)
    return true
  })

  ipcMain.handle(IPC.PROJECT_INDEX_ENSURE, (_e, projectId: string) => openProjectIndex(projectId))
  ipcMain.handle(IPC.PROJECT_INDEX_REFRESH, (_e, projectId: string) =>
    refreshProjectIndexForProject(projectId)
  )
  ipcMain.handle(IPC.PROJECT_INDEX_GET, (_e, projectId: string) => getProjectIndexInfo(projectId))

  ipcMain.handle(IPC.FILES_TREE, (_e, projectId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('הפרויקט לא נמצא')
    return buildFileTree(project.folderPath)
  })

  ipcMain.handle(IPC.FILES_READ, (_e, projectId: string, relativePath: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('הפרויקט לא נמצא')
    return readProjectFile(project.folderPath, relativePath)
  })

  ipcMain.handle(
    IPC.FILES_WRITE,
    (_e, projectId: string, relativePath: string, content: string) => {
      const project = getProject(projectId)
      if (!project) throw new Error('הפרויקט לא נמצא')
      writeProjectFile(project.folderPath, relativePath, content)
      return true
    }
  )

  ipcMain.handle(IPC.FILES_DELETE, (_e, projectId: string, relativePath: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('הפרויקט לא נמצא')
    deleteProjectFile(project.folderPath, relativePath)
    return true
  })

  ipcMain.handle(IPC.FILES_OPEN_EXTERNAL, async (_e, projectId: string, relativePath: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('הפרויקט לא נמצא')
    const full = resolveSafePath(project.folderPath, relativePath)
    await shell.openPath(full)
    return true
  })

  ipcMain.handle(IPC.FILES_PREVIEW_URL, (_e, projectId: string, relativePath: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('הפרויקט לא נמצא')
    // Validate path exists inside project
    resolveSafePath(project.folderPath, relativePath)
    return buildPreviewUrl(projectId, relativePath)
  })

  ipcMain.handle(IPC.FILES_FIND_HTML, (_e, projectId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('הפרויקט לא נמצא')
    return findHtmlInTree(buildFileTree(project.folderPath))
  })

  ipcMain.handle(IPC.PREVIEW_IS_VITE, (_e, projectId: string) => isViteProject(projectId))

  const sendPreviewEvent = (
    sender: {
      send: (channel: string, payload: PreviewLiveEvent) => void
      isDestroyed: () => boolean
    },
    ev: PreviewLiveEvent
  ): void => {
    try {
      if (!sender.isDestroyed()) sender.send(IPC.PREVIEW_LIVE_EVENT, ev)
    } catch {
      /* ignore */
    }
  }

  ipcMain.handle(IPC.PREVIEW_LIVE_ENSURE, async (event, projectId: string) =>
    ensureLivePreview(projectId, {
      onEvent: (ev) => sendPreviewEvent(event.sender, ev)
    })
  )

  ipcMain.handle(IPC.PREVIEW_LIVE_RESTART, async (event, projectId: string) =>
    restartLivePreview(projectId, {
      onEvent: (ev) => sendPreviewEvent(event.sender, ev)
    })
  )

  ipcMain.handle(IPC.PREVIEW_LIVE_STOP, (_e, projectId: string) => {
    stopLivePreview(projectId)
    return true
  })

  ipcMain.handle(IPC.PREVIEW_LIVE_URL, (_e, projectId: string) => getLivePreviewUrl(projectId))

  ipcMain.handle(IPC.PREVIEW_LIVE_STATUS, (_e, projectId: string) =>
    getLivePreviewStatus(projectId)
  )

  ipcMain.handle(IPC.CHAT_GET, (_e, projectId: string) => loadChat(projectId))

  ipcMain.handle(IPC.CHAT_CLEAR, (_e, projectId: string) => clearChat(projectId))

  ipcMain.handle(
    IPC.CHAT_SEND,
    async (
      _e,
      payload: {
        projectId: string
        message: string
        provider: AiProvider
        model: string
        activeFile?: string | null
        workMode?: WorkModeSelection
        selectedElements?: PreviewElementSelection[] | null
      }
    ) => {
      if (!payload.message?.trim()) throw new Error('הודעה ריקה')
      return sendChatMessage(payload)
    }
  )

  ipcMain.handle(
    IPC.CHAT_SEND_STREAM,
    async (
      event,
      payload: {
        projectId: string
        message: string
        provider: AiProvider
        model: string
        activeFile?: string | null
        workMode?: WorkModeSelection
        selectedElements?: PreviewElementSelection[] | null
      }
    ) => {
      if (!payload.message?.trim()) throw new Error('הודעה ריקה')
      return sendChatMessage(payload, (streamEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.CHAT_STREAM_EVENT, streamEvent)
        }
      })
    }
  )

  ipcMain.handle(IPC.CHAT_ABORT, (_e, projectId: string) => abortChat(projectId))

  ipcMain.handle(IPC.CHAT_CAN_UNDO, (_e, projectId: string) =>
    Boolean(getLatestSnapshotId(projectId))
  )

  ipcMain.handle(IPC.CHAT_UNDO, (_e, projectId: string) => undoLatestSnapshot(projectId))

  ipcMain.handle(IPC.CHATS_LIST, (_e, projectId: string) => loadChatsIndex(projectId))

  ipcMain.handle(IPC.CHATS_CREATE, (_e, projectId: string, title?: string) =>
    createChat(projectId, title)
  )

  ipcMain.handle(IPC.CHATS_SWITCH, (_e, projectId: string, chatId: string) =>
    switchChat(projectId, chatId)
  )

  ipcMain.handle(IPC.CHATS_DELETE, (_e, projectId: string, chatId: string) =>
    deleteChat(projectId, chatId)
  )

  ipcMain.handle(
    IPC.CHATS_SUMMARIZE_NEW,
    (_e, projectId: string, provider: AiProvider, model: string) =>
      summarizeToNewChat({ projectId, provider, model })
  )

  ipcMain.handle(IPC.SNAPSHOTS_LIST, (_e, projectId: string) => listSnapshots(projectId))

  ipcMain.handle(IPC.SNAPSHOTS_RESTORE, (_e, projectId: string, snapshotId: string) =>
    restoreToSnapshot(projectId, snapshotId)
  )

  ipcMain.handle(IPC.SNAPSHOTS_DIFF, (_e, projectId: string, snapshotId: string) =>
    getSnapshotDiff(projectId, snapshotId)
  )

  // אישור/ביטול שינויים של סבב — נשמר על ההודעה בצ'אט
  ipcMain.handle(
    IPC.CHAT_SET_APPROVAL,
    (_e, projectId: string, messageId: string, approved: boolean) => {
      const session = loadChat(projectId)
      const msg = session.messages.find((m) => m.id === messageId)
      if (!msg) return false
      msg.changesApproved = approved
      saveChat(session)
      // אמון מדורג: אישור מגדיל את הרצף, ביטול מאפס אותו
      const project = getProject(projectId)
      if (project?.folderPath) {
        try {
          recordDecision(project.folderPath, approved)
        } catch {
          /* trust is best-effort */
        }
      }
      return true
    }
  )

  ipcMain.handle(
    IPC.CHAT_ESTIMATE_CONTEXT,
    (
      _e,
      payload: {
        projectId: string
        model: string
        activeFile?: string | null
        draftMessage?: string
      }
    ) => estimateProjectContext(payload)
  )

  ipcMain.handle(IPC.SHELL_RUN, async (event, req: ShellRunRequest) => {
    return runAllowlistedShell(req, (line, stream) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC.SHELL_EVENT, { line, stream })
      }
    })
  })

  ipcMain.handle(IPC.INTEG_GET, (_e, projectId: string) => loadIntegrations(projectId))

  ipcMain.handle(IPC.INTEG_OAUTH_CONNECT, async (_e, provider: OAuthProviderId) => {
    if (provider !== 'github' && provider !== 'supabase' && provider !== 'vercel') {
      throw new Error('פלטפורמה לא נתמכת')
    }
    return connectProviderWithOAuth(provider)
  })

  ipcMain.handle(IPC.INTEG_OAUTH_CANCEL, () => {
    cancelOAuthFlow()
    return { ok: true }
  })

  ipcMain.handle(IPC.INTEG_SUPABASE_ACCOUNT_STATUS, () => {
    const account = loadSupabaseAccount()
    return { connected: Boolean(account), orgName: account?.orgName }
  })

  ipcMain.handle(IPC.INTEG_SUPABASE_ACCOUNT_DISCONNECT, () => {
    clearSupabaseAccount()
    return { ok: true }
  })

  ipcMain.handle(IPC.INTEG_SUPABASE_LIST_PROJECTS, async () => listSupabaseProjects())

  ipcMain.handle(
    IPC.INTEG_SUPABASE_LINK_PROJECT,
    async (_e, payload: { projectId: string; ref: string }) =>
      connectSupabaseProjectFromAccount(payload)
  )

  ipcMain.handle(IPC.INTEG_GITHUB_STATUS, async () => {
    const token = getGithubToken()
    if (!token) return { connected: false }
    try {
      const user = await validateGithubToken(token)
      return { connected: true, user }
    } catch {
      return { connected: false }
    }
  })

  ipcMain.handle(IPC.INTEG_GITHUB_SET_TOKEN, async (_e, token: string) => {
    const user = await validateGithubToken(token)
    setGithubToken(token)
    return { ok: true, user }
  })

  ipcMain.handle(IPC.INTEG_GITHUB_CLEAR_TOKEN, () => {
    clearGithubToken()
    return { ok: true }
  })

  ipcMain.handle(IPC.INTEG_GITHUB_VALIDATE, async () => validateGithubToken())

  ipcMain.handle(IPC.INTEG_GITHUB_BRANCHES, async (_e, projectId: string) =>
    listGithubBranches(projectId)
  )

  ipcMain.handle(IPC.INTEG_GITHUB_SET_BRANCH, (_e, projectId: string, branch: string) => {
    setGithubBranch(projectId, branch)
    return loadIntegrations(projectId)
  })

  ipcMain.handle(IPC.INTEG_GITHUB_LIST_REPOS, async () => listGithubRepos())

  ipcMain.handle(
    IPC.INTEG_GITHUB_CREATE_REPO,
    async (
      _e,
      payload: { projectId: string; name: string; description?: string; isPrivate?: boolean }
    ) => createGithubRepo(payload)
  )

  ipcMain.handle(
    IPC.INTEG_GITHUB_LINK,
    async (
      _e,
      payload: {
        projectId: string
        cloneUrl: string
        fullName: string
        defaultBranch?: string
        isPrivate?: boolean
      }
    ) => {
      await linkGithubRepo(payload)
      return loadIntegrations(payload.projectId)
    }
  )

  ipcMain.handle(IPC.INTEG_GITHUB_PUSH, async (_e, projectId: string, message?: string) =>
    pushGithubProject(projectId, message)
  )

  ipcMain.handle(
    IPC.INTEG_GITHUB_PUBLISH,
    async (_e, projectId: string, opts?: { message?: string; branchName?: string }) =>
      publishToGithub(projectId, opts)
  )

  ipcMain.handle(IPC.INTEG_GITHUB_DISCONNECT, async (_e, projectId: string) => {
    await disconnectGithub(projectId)
    return loadIntegrations(projectId)
  })

  ipcMain.handle(IPC.INTEG_SUPABASE_CONNECT, async (_e, input: SupabaseConnectInput) =>
    connectSupabase(input)
  )

  ipcMain.handle(IPC.INTEG_SUPABASE_TEST, async (_e, projectUrl: string, anonKey: string) =>
    testSupabaseConnection(projectUrl, anonKey)
  )

  ipcMain.handle(IPC.INTEG_SUPABASE_DISCONNECT, (_e, projectId: string) => {
    disconnectSupabase(projectId)
    return loadIntegrations(projectId)
  })

  ipcMain.handle(IPC.INTEG_VERCEL_STATUS, async () => {
    const status = vercelTokenStatus()
    let user: Awaited<ReturnType<typeof validateVercelToken>> | undefined
    if (status.hasUserToken) {
      try {
        user = await validateVercelToken()
      } catch {
        user = undefined
      }
    }
    const settings = loadSettingsRaw()
    return {
      ...status,
      user,
      vercelTeamId: settings.vercelTeamId || '',
      vercelPlatformTeamId:
        process.env.NF_BLAZE_VERCEL_TEAM_ID?.trim() || settings.vercelPlatformTeamId || ''
    }
  })

  ipcMain.handle(IPC.INTEG_VERCEL_SET_TOKEN, async (_e, token: string) => {
    const user = await validateVercelToken(token)
    setVercelUserToken(token)
    return { ok: true, user }
  })

  ipcMain.handle(IPC.INTEG_VERCEL_CLEAR_TOKEN, () => {
    clearVercelUserToken()
    return { ok: true }
  })

  ipcMain.handle(
    IPC.INTEG_VERCEL_SET_PLATFORM,
    async (_e, payload: { token: string; teamId: string }) => {
      if (!payload?.token?.trim()) throw new Error('חסר טוקן מארח')
      if (!payload?.teamId?.trim()) throw new Error('חסר Team ID מארח')
      setVercelPlatformCredentials(payload.token)
      saveSettings({ vercelPlatformTeamId: payload.teamId.trim() })
      return { ok: true }
    }
  )

  ipcMain.handle(IPC.INTEG_VERCEL_CLEAR_PLATFORM, () => {
    clearVercelPlatformToken()
    saveSettings({ vercelPlatformTeamId: '' })
    return { ok: true }
  })

  ipcMain.handle(IPC.INTEG_VERCEL_VALIDATE, async () => validateVercelToken())

  ipcMain.handle(IPC.INTEG_VERCEL_LIST_PROJECTS, async () => listVercelProjects())

  ipcMain.handle(IPC.INTEG_VERCEL_DEPLOY, async (_e, input: VercelDeployInput) =>
    deployToVercel(input)
  )

  ipcMain.handle(
    IPC.INTEG_VERCEL_REDEPLOY,
    async (_e, projectId: string, securityOverride?: VercelDeployInput['securityOverride']) =>
      redeployVercel(projectId, securityOverride)
  )

  ipcMain.handle(IPC.INTEG_VERCEL_DISCONNECT, (_e, projectId: string) => {
    disconnectVercel(projectId)
    return loadIntegrations(projectId)
  })

  ipcMain.handle(
    IPC.INTEG_VERCEL_FETCH_LOG,
    async (_e, deploymentId: string, mode?: 'user' | 'platform') =>
      fetchDeploymentBuildLog(deploymentId, mode || 'user')
  )

  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IPC.APP_UPDATE_STATUS, () => getUpdateState())
  ipcMain.handle(IPC.APP_UPDATE_CHECK, async () => checkNow())
  ipcMain.handle(IPC.APP_UPDATE_RETRY, async () => retryUpdate())
  ipcMain.handle(IPC.APP_UPDATE_INSTALL, () => {
    installUpdate()
    return { ok: true }
  })
  ipcMain.handle(IPC.APP_UPDATE_SNOOZE, () => snoozeUpdate())

  // איזו גרסה המשתמש כבר ראה — קובע אם להציג את פופ-אפ «מה חדש»
  ipcMain.handle(IPC.APP_SEEN_VERSION_GET, () => loadSettingsRaw().lastSeenVersion || null)
  ipcMain.handle(IPC.APP_SEEN_VERSION_SET, (_e, version: string) => {
    saveSettings({ lastSeenVersion: String(version || '').slice(0, 32) })
    return { ok: true }
  })

  ipcMain.handle(IPC.APP_GET_PATH, () => getDataRoot())

  ipcMain.handle(IPC.APP_OPEN_PATH, async (_e, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('נתיב לא תקין')
    }
    const full = resolve(normalize(targetPath))
    const allowedRoots = [
      resolve(getDataRoot()),
      ...listProjects().map((p) => resolve(p.folderPath))
    ]
    const ok = allowedRoots.some((root) => {
      const r = root.toLowerCase()
      const f = full.toLowerCase()
      return f === r || f.startsWith(r + '\\') || f.startsWith(r + '/')
    })
    if (!ok) {
      throw new Error('פתיחת נתיב מחוץ לפרויקטים מורשים חסומה')
    }
    await shell.openPath(full)
    return true
  })

  ipcMain.handle(IPC.APP_RUNTIME_ENV, async (_e, force?: boolean) =>
    probeRuntimeEnv({ force: Boolean(force) })
  )

  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('כתובת לא תקינה')
    }
    await shell.openExternal(url)
    return true
  })

  // Never expose raw keys to renderer
  void getApiKey
}

app.whenReady().then(() => {
  // File/Edit/View/Window/Help של Electron אינם רלוונטיים כאן —
  // כל הפעולות נמצאות בסרגל של האפליקציה עצמה
  Menu.setApplicationMenu(null)
  // חייב לרוץ לפני כל שימוש ב-Playwright — מפנה לדפדפן המצורף
  configureBundledBrowser()
  registerPreviewProtocol()
  registerIpc()
  createWindow()
  startAutoUpdates()
  startLicenseRevalidation()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/**
 * אימות מקוון של הרישיון: בעלייה, ואז כל 5 דקות ברקע.
 *
 * מ-1.66.0 חלון החסד הוא 15 דקות, ולכן המחזור הזה הוא מה שמחזיק את המשתמש
 * בפנים: שלושה ניסיונות לפני שהוא נחסם. אימות מוצלח מרענן עוגן זמן אמין
 * (שעון השרת החתום), תופס ביטול מרחוק, ומאשר את המושב.
 */
function startLicenseRevalidation(): void {
  void revalidateOnline().catch(() => undefined)
  setInterval(
    () => void revalidateOnline().catch(() => undefined),
    LICENSE_REVALIDATE_INTERVAL_MS
  )
}

app.on('before-quit', () => {
  stopAllLivePreviews()
  stopAllMcpServers()
})

app.on('will-quit', () => {
  stopAllLivePreviews()
  stopAllMcpServers()
})

app.on('window-all-closed', () => {
  stopAllLivePreviews()
  stopAllMcpServers()
  if (process.platform !== 'darwin') app.quit()
})
