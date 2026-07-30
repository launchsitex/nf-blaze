import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AgentStreamEvent,
  AiProvider,
  AppSettings,
  ChatSession,
  FileNode,
  GithubRepoInfo,
  GithubUserInfo,
  ProjectIntegrations,
  ProjectMeta,
  ProjectIndexInfo,
  SendChatResult,
  ShellRunRequest,
  ShellRunResult,
  SupabaseConnectInput,
  VercelDeployInput,
  VercelDeployResult,
  VercelProjectInfo,
  VercelUserInfo,
  ProjectTemplateId,
  ProjectTemplateInfo,
  ProjectPlan,
  PreviewElementSelection,
  McpServerInfo,
  McpServersList,
  McpTestOutcome,
  SnapshotSummary,
  SnapshotFileDiff,
  ChatMeta,
  ChatsIndex
} from '../shared/types'
import type { ContextUsage } from '../shared/context'

export interface NfBlazeApi {
  getSettings: () => Promise<
    Omit<AppSettings, 'openaiApiKey' | 'anthropicApiKey' | 'geminiApiKey'> & {
      hasOpenaiKey: boolean
      hasAnthropicKey: boolean
      hasGeminiKey: boolean
      hasOpenrouterKey: boolean
      hasGithubToken: boolean
      hasVercelToken: boolean
      hasVercelPlatformToken: boolean
      encryptionAvailable: boolean
    }
  >
  setSettings: (
    partial: Partial<Omit<AppSettings, 'openaiApiKey' | 'anthropicApiKey' | 'geminiApiKey'>>
  ) => Promise<unknown>
  setApiKey: (provider: AiProvider, key: string) => Promise<{
    hasOpenaiKey: boolean
    hasAnthropicKey: boolean
    hasGeminiKey: boolean
    hasOpenrouterKey: boolean
    hasGithubToken: boolean
    hasVercelToken: boolean
    hasVercelPlatformToken: boolean
    encryptionAvailable: boolean
  }>
  clearApiKey: (provider: AiProvider) => Promise<{
    hasOpenaiKey: boolean
    hasAnthropicKey: boolean
    hasGeminiKey: boolean
    hasOpenrouterKey: boolean
    hasGithubToken: boolean
    hasVercelToken: boolean
    hasVercelPlatformToken: boolean
    encryptionAvailable: boolean
  }>
  hasApiKey: (provider: AiProvider) => Promise<boolean>

  listMcpServers: () => Promise<McpServersList>
  saveMcpServer: (entry: McpServerInfo) => Promise<McpServersList>
  removeMcpServer: (name: string) => Promise<McpServersList>
  testMcpServer: (entry: McpServerInfo) => Promise<McpTestOutcome>

  listProjects: () => Promise<ProjectMeta[]>
  getProject: (id: string) => Promise<ProjectMeta | null>
  pickFolder: () => Promise<string | null>
  importProject: (payload: {
    name: string
    description?: string
    folderPath: string
    provider: AiProvider
    model?: string
  }) => Promise<ProjectMeta>
  createProject: (payload: {
    name: string
    description: string
    folderPath: string
    provider: AiProvider
    model?: string
    templateId?: ProjectTemplateId
  }) => Promise<ProjectMeta>
  updateProject: (id: string, partial: Partial<ProjectMeta>) => Promise<ProjectMeta>
  deleteProject: (id: string) => Promise<boolean>
  listTemplates: () => Promise<ProjectTemplateInfo[]>
  getProjectPlan: (projectId: string) => Promise<ProjectPlan | null>
  getProjectMemory: (projectId: string) => Promise<string>

  ensureProjectIndex: (projectId: string) => Promise<ProjectIndexInfo>
  refreshProjectIndex: (projectId: string) => Promise<ProjectIndexInfo>
  getProjectIndex: (projectId: string) => Promise<ProjectIndexInfo>

  getFileTree: (projectId: string) => Promise<FileNode[]>
  readFile: (projectId: string, relativePath: string) => Promise<string>
  writeFile: (projectId: string, relativePath: string, content: string) => Promise<boolean>
  deleteFile: (projectId: string, relativePath: string) => Promise<boolean>
  openFileExternal: (projectId: string, relativePath: string) => Promise<boolean>
  getPreviewUrl: (projectId: string, relativePath: string) => Promise<string>
  findHtmlFile: (projectId: string) => Promise<string | null>
  ensureLivePreview: (projectId: string) => Promise<{
    url: string
    reused: boolean
    mode?: 'live' | 'fallback'
    message?: string
  }>
  restartLivePreview: (projectId: string) => Promise<{
    url: string
    reused: boolean
    mode?: 'live' | 'fallback'
    message?: string
  }>
  stopLivePreview: (projectId: string) => Promise<boolean>
  getLivePreviewUrl: (projectId: string) => Promise<string | null>
  getLivePreviewStatus: (projectId: string) => Promise<{
    url: string | null
    mode: 'live' | 'fallback' | null
    errorText: string
    log: string[]
  }>
  isViteProject: (projectId: string) => Promise<boolean>
  onPreviewLiveEvent: (
    handler: (ev: {
      projectId: string
      phase: string
      message: string
      url?: string | null
      mode?: 'live' | 'fallback' | 'static'
      logLine?: string
      errorText?: string
    }) => void
  ) => () => void

  getChat: (projectId: string) => Promise<ChatSession>
  clearChat: (projectId: string) => Promise<ChatSession>
  listChats: (projectId: string) => Promise<ChatsIndex>
  createChat: (projectId: string, title?: string) => Promise<ChatMeta>
  switchChat: (projectId: string, chatId: string) => Promise<ChatsIndex>
  deleteChat: (projectId: string, chatId: string) => Promise<ChatsIndex>
  summarizeToNewChat: (
    projectId: string,
    provider: AiProvider,
    model: string
  ) => Promise<{ chat: ChatMeta; summarized: boolean }>
  sendChat: (payload: {
    projectId: string
    message: string
    provider: AiProvider
    model: string
    activeFile?: string | null
    workMode?: import('../shared/types').WorkModeSelection
    selectedElements?: PreviewElementSelection[] | null
  }) => Promise<SendChatResult>
  sendChatStream: (payload: {
    projectId: string
    message: string
    provider: AiProvider
    model: string
    activeFile?: string | null
    workMode?: import('../shared/types').WorkModeSelection
    selectedElements?: PreviewElementSelection[] | null
  }) => Promise<SendChatResult>
  onChatStream: (handler: (event: AgentStreamEvent) => void) => () => void
  abortChat: (projectId: string) => Promise<boolean>
  canUndo: (projectId: string) => Promise<boolean>
  undoLast: (projectId: string) => Promise<{ ok: boolean; restored: string[]; message: string }>
  listSnapshots: (projectId: string) => Promise<SnapshotSummary[]>
  restoreSnapshot: (
    projectId: string,
    snapshotId: string
  ) => Promise<{ ok: boolean; restored: string[]; message: string }>
  getSnapshotDiff: (
    projectId: string,
    snapshotId: string
  ) => Promise<{ ok: boolean; files: SnapshotFileDiff[]; message?: string }>
  setChangesApproval: (
    projectId: string,
    messageId: string,
    approved: boolean
  ) => Promise<boolean>
  estimateContext: (payload: {
    projectId: string
    model: string
    activeFile?: string | null
    draftMessage?: string
  }) => Promise<ContextUsage>

  runShell: (req: ShellRunRequest) => Promise<ShellRunResult>
  getLicenseStatus: () => Promise<import('../shared/license').LicenseStatus>
  activateLicense: (key: string) => Promise<import('../shared/license').LicenseStatus>
  clearLicense: () => Promise<import('../shared/license').LicenseStatus>
  runSecurityScan: (projectId: string) => Promise<{
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
  }>
  onShellEvent: (handler: (ev: { line: string; stream: 'stdout' | 'stderr' }) => void) => () => void

  getIntegrations: (projectId: string) => Promise<ProjectIntegrations>
  githubStatus: () => Promise<{ connected: boolean; user?: GithubUserInfo }>
  setGithubToken: (token: string) => Promise<{ ok: boolean; user: GithubUserInfo }>
  clearGithubToken: () => Promise<{ ok: boolean }>
  validateGithub: () => Promise<GithubUserInfo>
  listGithubRepos: () => Promise<GithubRepoInfo[]>
  createGithubRepo: (payload: {
    projectId: string
    name: string
    description?: string
    isPrivate?: boolean
  }) => Promise<GithubRepoInfo>
  linkGithubRepo: (payload: {
    projectId: string
    cloneUrl: string
    fullName: string
    defaultBranch?: string
    isPrivate?: boolean
  }) => Promise<ProjectIntegrations>
  pushGithub: (projectId: string, message?: string) => Promise<{ ok: boolean; summary: string }>
  listGithubBranches: (projectId: string) => Promise<string[]>
  setGithubBranch: (projectId: string, branch: string) => Promise<ProjectIntegrations>
  disconnectGithub: (projectId: string) => Promise<ProjectIntegrations>
  connectSupabase: (input: SupabaseConnectInput) => Promise<{ ok: boolean; message: string }>
  testSupabase: (
    projectUrl: string,
    anonKey: string
  ) => Promise<{ ok: boolean; message: string }>
  disconnectSupabase: (projectId: string) => Promise<ProjectIntegrations>

  vercelStatus: () => Promise<{
    hasUserToken: boolean
    hasPlatformToken: boolean
    user?: VercelUserInfo
    vercelTeamId: string
    vercelPlatformTeamId: string
  }>
  setVercelToken: (token: string) => Promise<{ ok: boolean; user: VercelUserInfo }>
  clearVercelToken: () => Promise<{ ok: boolean }>
  setVercelPlatform: (payload: {
    token: string
    teamId: string
  }) => Promise<{ ok: boolean }>
  clearVercelPlatform: () => Promise<{ ok: boolean }>
  validateVercel: () => Promise<VercelUserInfo>
  listVercelProjects: () => Promise<VercelProjectInfo[]>
  deployVercel: (input: VercelDeployInput) => Promise<VercelDeployResult>
  redeployVercel: (
    projectId: string,
    securityOverride?: VercelDeployInput['securityOverride']
  ) => Promise<VercelDeployResult>
  disconnectVercel: (projectId: string) => Promise<ProjectIntegrations>
  fetchVercelBuildLog: (
    deploymentId: string,
    mode?: 'user' | 'platform'
  ) => Promise<string>

  getAppVersion: () => Promise<string>
  getDataPath: () => Promise<string>
  openPath: (path: string) => Promise<boolean>
  getRuntimeEnv: (force?: boolean) => Promise<{
    ok: boolean
    source: 'bundled' | 'system' | 'missing'
    node: { available: boolean; version: string | null; path: string | null }
    npm: { available: boolean; version: string | null; path: string | null }
    bundledDir: string | null
    minNode: string
    downloadUrl: string
    checkedAt: string
    messageHe: string
    instructionHe: string
  }>
  openExternal: (url: string) => Promise<boolean>
}

const api: NfBlazeApi = {
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (partial) => ipcRenderer.invoke(IPC.SETTINGS_SET, partial),
  setApiKey: (provider, key) => ipcRenderer.invoke(IPC.SETTINGS_SET_KEY, provider, key),
  clearApiKey: (provider) => ipcRenderer.invoke(IPC.SETTINGS_CLEAR_KEY, provider),
  hasApiKey: (provider) => ipcRenderer.invoke(IPC.SETTINGS_HAS_KEY, provider),

  listMcpServers: () => ipcRenderer.invoke(IPC.MCP_LIST),
  saveMcpServer: (entry) => ipcRenderer.invoke(IPC.MCP_SAVE, entry),
  removeMcpServer: (name) => ipcRenderer.invoke(IPC.MCP_REMOVE, name),
  testMcpServer: (entry) => ipcRenderer.invoke(IPC.MCP_TEST, entry),

  listProjects: () => ipcRenderer.invoke(IPC.PROJECTS_LIST),
  getProject: (id) => ipcRenderer.invoke(IPC.PROJECTS_GET, id),
  pickFolder: () => ipcRenderer.invoke(IPC.PROJECTS_PICK_FOLDER),
  createProject: (payload) => ipcRenderer.invoke(IPC.PROJECTS_CREATE, payload),
  importProject: (payload) => ipcRenderer.invoke(IPC.PROJECTS_IMPORT, payload),
  updateProject: (id, partial) => ipcRenderer.invoke(IPC.PROJECTS_UPDATE, id, partial),
  deleteProject: (id) => ipcRenderer.invoke(IPC.PROJECTS_DELETE, id),
  listTemplates: () => ipcRenderer.invoke(IPC.PROJECTS_LIST_TEMPLATES),
  getProjectPlan: (projectId) => ipcRenderer.invoke(IPC.PROJECTS_PLAN_GET, projectId),
  getProjectMemory: (projectId) => ipcRenderer.invoke(IPC.PROJECTS_MEMORY_GET, projectId),

  ensureProjectIndex: (projectId) => ipcRenderer.invoke(IPC.PROJECT_INDEX_ENSURE, projectId),
  refreshProjectIndex: (projectId) => ipcRenderer.invoke(IPC.PROJECT_INDEX_REFRESH, projectId),
  getProjectIndex: (projectId) => ipcRenderer.invoke(IPC.PROJECT_INDEX_GET, projectId),

  getFileTree: (projectId) => ipcRenderer.invoke(IPC.FILES_TREE, projectId),
  readFile: (projectId, relativePath) =>
    ipcRenderer.invoke(IPC.FILES_READ, projectId, relativePath),
  writeFile: (projectId, relativePath, content) =>
    ipcRenderer.invoke(IPC.FILES_WRITE, projectId, relativePath, content),
  deleteFile: (projectId, relativePath) =>
    ipcRenderer.invoke(IPC.FILES_DELETE, projectId, relativePath),
  openFileExternal: (projectId, relativePath) =>
    ipcRenderer.invoke(IPC.FILES_OPEN_EXTERNAL, projectId, relativePath),
  getPreviewUrl: (projectId, relativePath) =>
    ipcRenderer.invoke(IPC.FILES_PREVIEW_URL, projectId, relativePath),
  findHtmlFile: (projectId) => ipcRenderer.invoke(IPC.FILES_FIND_HTML, projectId),
  ensureLivePreview: (projectId) => ipcRenderer.invoke(IPC.PREVIEW_LIVE_ENSURE, projectId),
  restartLivePreview: (projectId) => ipcRenderer.invoke(IPC.PREVIEW_LIVE_RESTART, projectId),
  stopLivePreview: (projectId) => ipcRenderer.invoke(IPC.PREVIEW_LIVE_STOP, projectId),
  getLivePreviewUrl: (projectId) => ipcRenderer.invoke(IPC.PREVIEW_LIVE_URL, projectId),
  getLivePreviewStatus: (projectId) => ipcRenderer.invoke(IPC.PREVIEW_LIVE_STATUS, projectId),
  isViteProject: (projectId) => ipcRenderer.invoke(IPC.PREVIEW_IS_VITE, projectId),
  onPreviewLiveEvent: (handler) => {
    const listener = (
      _e: unknown,
      data: {
        projectId: string
        phase: string
        message: string
        url?: string | null
        mode?: 'live' | 'fallback' | 'static'
        logLine?: string
        errorText?: string
      }
    ) => handler(data)
    ipcRenderer.on(IPC.PREVIEW_LIVE_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC.PREVIEW_LIVE_EVENT, listener)
  },

  getChat: (projectId) => ipcRenderer.invoke(IPC.CHAT_GET, projectId),
  clearChat: (projectId) => ipcRenderer.invoke(IPC.CHAT_CLEAR, projectId),
  listChats: (projectId) => ipcRenderer.invoke(IPC.CHATS_LIST, projectId),
  createChat: (projectId, title) => ipcRenderer.invoke(IPC.CHATS_CREATE, projectId, title),
  switchChat: (projectId, chatId) => ipcRenderer.invoke(IPC.CHATS_SWITCH, projectId, chatId),
  deleteChat: (projectId, chatId) => ipcRenderer.invoke(IPC.CHATS_DELETE, projectId, chatId),
  summarizeToNewChat: (projectId, provider, model) =>
    ipcRenderer.invoke(IPC.CHATS_SUMMARIZE_NEW, projectId, provider, model),
  sendChat: (payload) => ipcRenderer.invoke(IPC.CHAT_SEND, payload),
  sendChatStream: (payload) => ipcRenderer.invoke(IPC.CHAT_SEND_STREAM, payload),
  onChatStream: (handler) => {
    const listener = (_event: unknown, data: AgentStreamEvent) => handler(data)
    ipcRenderer.on(IPC.CHAT_STREAM_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC.CHAT_STREAM_EVENT, listener)
  },
  abortChat: (projectId) => ipcRenderer.invoke(IPC.CHAT_ABORT, projectId),
  canUndo: (projectId) => ipcRenderer.invoke(IPC.CHAT_CAN_UNDO, projectId),
  listSnapshots: (projectId) => ipcRenderer.invoke(IPC.SNAPSHOTS_LIST, projectId),
  restoreSnapshot: (projectId, snapshotId) =>
    ipcRenderer.invoke(IPC.SNAPSHOTS_RESTORE, projectId, snapshotId),
  getSnapshotDiff: (projectId, snapshotId) =>
    ipcRenderer.invoke(IPC.SNAPSHOTS_DIFF, projectId, snapshotId),
  setChangesApproval: (projectId, messageId, approved) =>
    ipcRenderer.invoke(IPC.CHAT_SET_APPROVAL, projectId, messageId, approved),
  undoLast: (projectId) => ipcRenderer.invoke(IPC.CHAT_UNDO, projectId),
  estimateContext: (payload) => ipcRenderer.invoke(IPC.CHAT_ESTIMATE_CONTEXT, payload),

  runShell: (req) => ipcRenderer.invoke(IPC.SHELL_RUN, req),
  getLicenseStatus: () => ipcRenderer.invoke(IPC.LICENSE_STATUS),
  activateLicense: (key) => ipcRenderer.invoke(IPC.LICENSE_ACTIVATE, key),
  clearLicense: () => ipcRenderer.invoke(IPC.LICENSE_CLEAR),
  runSecurityScan: (projectId) => ipcRenderer.invoke(IPC.SECURITY_SCAN, projectId),
  onShellEvent: (handler) => {
    const listener = (_e: unknown, data: { line: string; stream: 'stdout' | 'stderr' }) =>
      handler(data)
    ipcRenderer.on(IPC.SHELL_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC.SHELL_EVENT, listener)
  },

  getIntegrations: (projectId) => ipcRenderer.invoke(IPC.INTEG_GET, projectId),
  githubStatus: () => ipcRenderer.invoke(IPC.INTEG_GITHUB_STATUS),
  setGithubToken: (token) => ipcRenderer.invoke(IPC.INTEG_GITHUB_SET_TOKEN, token),
  clearGithubToken: () => ipcRenderer.invoke(IPC.INTEG_GITHUB_CLEAR_TOKEN),
  validateGithub: () => ipcRenderer.invoke(IPC.INTEG_GITHUB_VALIDATE),
  listGithubRepos: () => ipcRenderer.invoke(IPC.INTEG_GITHUB_LIST_REPOS),
  createGithubRepo: (payload) => ipcRenderer.invoke(IPC.INTEG_GITHUB_CREATE_REPO, payload),
  linkGithubRepo: (payload) => ipcRenderer.invoke(IPC.INTEG_GITHUB_LINK, payload),
  listGithubBranches: (projectId) => ipcRenderer.invoke(IPC.INTEG_GITHUB_BRANCHES, projectId),
  setGithubBranch: (projectId, branch) =>
    ipcRenderer.invoke(IPC.INTEG_GITHUB_SET_BRANCH, projectId, branch),
  pushGithub: (projectId, message) =>
    ipcRenderer.invoke(IPC.INTEG_GITHUB_PUSH, projectId, message),
  disconnectGithub: (projectId) => ipcRenderer.invoke(IPC.INTEG_GITHUB_DISCONNECT, projectId),
  connectSupabase: (input) => ipcRenderer.invoke(IPC.INTEG_SUPABASE_CONNECT, input),
  testSupabase: (projectUrl, anonKey) =>
    ipcRenderer.invoke(IPC.INTEG_SUPABASE_TEST, projectUrl, anonKey),
  disconnectSupabase: (projectId) =>
    ipcRenderer.invoke(IPC.INTEG_SUPABASE_DISCONNECT, projectId),

  vercelStatus: () => ipcRenderer.invoke(IPC.INTEG_VERCEL_STATUS),
  setVercelToken: (token) => ipcRenderer.invoke(IPC.INTEG_VERCEL_SET_TOKEN, token),
  clearVercelToken: () => ipcRenderer.invoke(IPC.INTEG_VERCEL_CLEAR_TOKEN),
  setVercelPlatform: (payload) => ipcRenderer.invoke(IPC.INTEG_VERCEL_SET_PLATFORM, payload),
  clearVercelPlatform: () => ipcRenderer.invoke(IPC.INTEG_VERCEL_CLEAR_PLATFORM),
  validateVercel: () => ipcRenderer.invoke(IPC.INTEG_VERCEL_VALIDATE),
  listVercelProjects: () => ipcRenderer.invoke(IPC.INTEG_VERCEL_LIST_PROJECTS),
  deployVercel: (input) => ipcRenderer.invoke(IPC.INTEG_VERCEL_DEPLOY, input),
  redeployVercel: (projectId, securityOverride) =>
    ipcRenderer.invoke(IPC.INTEG_VERCEL_REDEPLOY, projectId, securityOverride),
  disconnectVercel: (projectId) => ipcRenderer.invoke(IPC.INTEG_VERCEL_DISCONNECT, projectId),
  fetchVercelBuildLog: (deploymentId, mode) =>
    ipcRenderer.invoke(IPC.INTEG_VERCEL_FETCH_LOG, deploymentId, mode),

  getAppVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
  getDataPath: () => ipcRenderer.invoke(IPC.APP_GET_PATH),
  openPath: (path) => ipcRenderer.invoke(IPC.APP_OPEN_PATH, path),
  getRuntimeEnv: (force) => ipcRenderer.invoke(IPC.APP_RUNTIME_ENV, force),
  openExternal: (url) => ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url)
}

contextBridge.exposeInMainWorld('nfblaze', api)
