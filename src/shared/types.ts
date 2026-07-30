/** Shared types for NF-Blaze — updated model catalog: 24/07/2026 */

export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'

export interface AiModelOption {
  id: string
  label: string
  description: string
  recommended?: boolean
  /** Max input context window in tokens */
  contextWindow: number
}

export interface ProviderInfo {
  id: AiProvider
  label: string
  description: string
  keyPlaceholder: string
  keyUrl: string
  models: AiModelOption[]
  /** false = ספק מקומי שלא דורש מפתח API (Ollama / LM Studio) */
  requiresKey?: boolean
}

/** האם הספק דורש מפתח API (מקומיים לא) */
export function providerRequiresKey(provider: AiProvider): boolean {
  return provider !== 'ollama' && provider !== 'lmstudio'
}

/** דגלי מפתחות כפי שמוחזרים מ-getKeyStatus (שדות חדשים אופציונליים לתאימות) */
export interface ProviderKeyFlags {
  hasOpenaiKey: boolean
  hasAnthropicKey: boolean
  hasGeminiKey: boolean
  hasOpenrouterKey?: boolean
}

/** האם אפשר להשתמש בספק — יש מפתח, או שהוא מקומי ולא צריך */
export function providerHasKey(flags: ProviderKeyFlags | null | undefined, provider: AiProvider): boolean {
  if (!providerRequiresKey(provider)) return true
  if (!flags) return false
  if (provider === 'openai') return flags.hasOpenaiKey
  if (provider === 'anthropic') return flags.hasAnthropicKey
  if (provider === 'gemini') return flags.hasGeminiKey
  if (provider === 'openrouter') return Boolean(flags.hasOpenrouterKey)
  return false
}

export type AgentEngine = 'legacy' | 'new'

export interface AppSettings {
  openaiApiKey?: string
  anthropicApiKey?: string
  geminiApiKey?: string
  defaultProvider: AiProvider
  defaultModel: string
  theme: 'dark' | 'light'
  /**
   * Agent engine: `legacy` = nfblaze JSON path (default),
   * `new` = agent/loop + providers tool_use path.
   */
  agentEngine?: AgentEngine
  /** מיגרציה חד-פעמית: המנוע החדש הפך לברירת המחדל (1.36.0) */
  engineMigratedToNew?: boolean
  /** המשתמש סיים את מסך ההסבר בהפעלה הראשונה */
  onboardingSeen?: boolean
  /** תאריך ההתקנה — בסיס לתקופת הניסיון */
  installedAt?: string
  /** Optional team id for the user's Vercel account (Path B) */
  vercelTeamId?: string
  /** Host team id for instant claim deploys (Path A) */
  vercelPlatformTeamId?: string
}

/** נקודת שחזור להצגה בהיסטוריית הגרסאות — בלי תוכן קבצים */
export interface SnapshotSummary {
  id: string
  createdAt: string
  messageId?: string
  files: string[]
}

/** שרת MCP בקובץ הגלובלי — ניהול ממסך ההגדרות */
export interface McpServerInfo {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  disabled?: boolean
}

export interface McpServersList {
  path: string
  servers: McpServerInfo[]
}

export interface McpTestOutcome {
  ok: boolean
  tools?: string[]
  error?: string
}

/** תוכנית בנייה בשלבים — נשמרת ב-.nf-blaze/plan.json וחיה בין הודעות */
export type ProjectPlanStageStatus = 'pending' | 'in_progress' | 'done'

export interface ProjectPlanStage {
  id: number
  title: string
  status: ProjectPlanStageStatus
  notes?: string
}

export interface ProjectPlan {
  goal: string
  stages: ProjectPlanStage[]
  updatedAt: string
}

export type ProjectTemplateId = 'web-app' | 'data-app'

export interface ProjectTemplateInfo {
  id: ProjectTemplateId
  nameHe: string
  descriptionHe: string
  hasSupabase: boolean
}

export interface ProjectIndexInfo {
  ready: boolean
  rootDir: string
  scannedAt: string
  filesSampled: number
  /** True when loaded from `.nf-blaze/project-index.json` without a full rescan */
  fromCache: boolean
  /** Short conventions one-liner for the UI */
  summary?: string
  error?: string
}

export interface ProjectMeta {
  id: string
  name: string
  description: string
  folderPath: string
  createdAt: string
  updatedAt: string
  provider: AiProvider
  model: string
  lastPreviewFile?: string
  /** Starter template id when created from templates/ */
  templateId?: ProjectTemplateId
}

/** ASK / PLAN / BUILD — agent work modes */
export type WorkMode = 'ASK' | 'PLAN' | 'BUILD'
export type WorkModeSelection = WorkMode | 'auto'

/**
 * Coerce UI/IPC work-mode selection.
 * Missing / invalid → ASK (no silent default to auto/BUILD).
 */
export function coerceWorkModeSelection(
  selection?: WorkModeSelection | null
): WorkModeSelection {
  if (selection === 'auto' || selection === 'ASK' || selection === 'PLAN' || selection === 'BUILD') {
    return selection
  }
  return 'ASK'
}

export function isReadOnlyWorkMode(mode: WorkMode): boolean {
  return mode === 'ASK' || mode === 'PLAN'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  filesChanged?: string[]
  error?: boolean
  aborted?: boolean
  /** Work mode attached to this turn (user selection / resolved) */
  workMode?: WorkMode
  /** How the mode was chosen */
  workModeSource?: 'manual' | 'auto'
  /** True when the model proposed writes that were blocked by ASK/PLAN */
  modeBlockedWrites?: boolean
  /** PLAN clarification questions (not file actions) */
  clarify?: ClarifyBlock
  /** Snapshot של הסבב — מאפשר diff, שחזור ואישור/ביטול שינויים */
  snapshotId?: string
  /** שורות שנוספו/נמחקו לכל קובץ בסבב (בסגנון git --stat) */
  changeStats?: Record<string, { added: number; removed: number }>
  /** אישור שינויים: true=אושרו, false=בוטלו; undefined=ממתין להחלטה */
  changesApproved?: boolean
}

/** Diff של קובץ בודד בסבב — לפני (מה-snapshot) מול אחרי (הקובץ הנוכחי) */
export interface SnapshotFileDiff {
  path: string
  /** null = הקובץ לא היה קיים לפני הסבב */
  before: string | null
  /** null = הקובץ נמחק / לא קיים כרגע */
  after: string | null
}

export interface ClarifyQuestion {
  q: string
  options: string[]
  multi?: boolean
}

export interface ClarifyBlock {
  type: 'clarify'
  questions: ClarifyQuestion[]
}

/** מטא-דאטה של צ'אט בודד — לפרויקט יכולים להיות כמה צ'אטים */
export interface ChatMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatsIndex {
  activeChatId: string
  chats: ChatMeta[]
}

export interface ChatSession {
  /** הצ'אט שההודעות שייכות אליו (ברירת מחדל: הפעיל) */
  chatId?: string
  projectId: string
  messages: ChatMessage[]
  updatedAt: string
}

export interface FileNode {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  children?: FileNode[]
}

export interface AgentFileAction {
  type: 'write' | 'delete' | 'mkdir' | 'edit'
  path: string
  content?: string
  /** For type=edit — exact unique substring to find */
  old_string?: string
  /** For type=edit — replacement */
  new_string?: string
}

export interface FileSnapshotEntry {
  path: string
  content: string | null
  existed: boolean
}

export interface ProjectSnapshot {
  id: string
  projectId: string
  createdAt: string
  messageId?: string
  entries: FileSnapshotEntry[]
}

export interface ShellRunRequest {
  projectId: string
  command: 'npm' | 'npx' | 'node' | 'pnpm' | 'yarn'
  args: string[]
}

export interface ShellRunResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

export interface AgentResponse {
  message: string
  actions: AgentFileAction[]
  previewFile?: string
  clarify?: ClarifyBlock
}

export interface PreviewElementSelection {
  /** ריק כשהאלמנט לא מתויג (פרויקט מיובא / HTML סטטי) — אז selector מזהה אותו */
  file: string
  line: number
  component?: string
  tag?: string
  /** CSS path לאלמנט — fallback כשאין data-nf-file */
  selector?: string
  /** קטע מהטקסט של האלמנט — עוזר לסוכן לאתר אותו */
  text?: string
}

export interface SendChatRequest {
  projectId: string
  message: string
  provider: AiProvider
  model: string
  /** New engine: auto | ASK | PLAN | BUILD */
  workMode?: WorkModeSelection
  /** Elements picked from preview select mode (בחירה מרובה) */
  selectedElements?: PreviewElementSelection[] | null
}

export interface SendChatResult {
  assistantMessage: ChatMessage
  actionsApplied: AgentFileAction[]
  previewFile?: string
  error?: string
  aborted?: boolean
  snapshotId?: string
  /** Resolved mode for this turn */
  workMode?: WorkMode
  workModeSource?: 'manual' | 'auto'
  /** Model proposed file writes while in ASK/PLAN — blocked, not applied */
  modeBlockedWrites?: boolean
}

/** Live agent progress events pushed to the renderer while working */
export type AgentStreamEvent =
  | { type: 'status'; message: string; step?: string }
  | { type: 'token'; text: string; replace?: boolean }
  | { type: 'file'; action: 'write' | 'delete' | 'mkdir' | 'edit'; path: string }
  | { type: 'shell'; line: string; stream: 'stdout' | 'stderr' }
  | { type: 'done'; result: SendChatResult }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
  /** New engine: resolved work mode */
  | { type: 'intent'; mode: WorkMode; source: 'manual' | 'auto' }
  /** New engine: declared edit scope */
  | {
      type: 'scope'
      files: string[]
      reason?: string
      expansion: boolean
      allScoped: string[]
    }
  /** New engine: tool call lifecycle */
  | {
      type: 'tool'
      phase: 'start' | 'end'
      name: string
      path?: string
      isError?: boolean
      detail?: string
    }
  /** New engine: structured tsc fix round */
  | {
      type: 'tsc_fix'
      file: string
      errors: Array<{ line: number; column?: number; code?: string; message: string }>
      attempt: number
    }
  /** New engine: completion gate result / nudge */
  | {
      type: 'completion_check'
      ok: boolean
      missing?: string
      nudge?: string
      detail?: string
    }
  /** Live tsc/build worker status (user project) */
  | {
      type: 'project_check'
      status: 'checking' | 'passed' | 'failed' | 'timeout' | 'cancelled'
      kind: 'tsc' | 'build'
      errorCount?: number
      message?: string
    }
  /** Context window was compacted mid-run */
  | {
      type: 'context_compact'
      beforePercent: number
      afterPercent: number
      beforeTokens: number
      afterTokens: number
      contextWindow: number
    }
  /** Browser QA sub-agent (Playwright) live progress */
  | {
      type: 'browser_qa'
      phase: 'start' | 'action' | 'passed' | 'failed' | 'skipped' | 'error'
      attempt: number
      message: string
      url?: string
      action?: string
      summary?: string
      works?: string[]
      broken?: string[]
    }

export const QUICK_PROMPTS = [
  'בנה דף נחיתה מודרני בעברית RTL עם כותרת, CTA ועיצוב פרימיום',
  'צור מערכת CRM לניהול לקוחות עם טבלה, חיפוש וטופס הוספה',
  'בנה אפליקציית React + Vite עם ניווט ודף בית בעברית',
  'שפר את העיצוב שיהיה יותר מקצועי ובינלאומי',
  'הוסף מצב כהה ומצב בהיר עם כפתור החלפה'
] as const

export const AI_PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    description: 'מודלי GPT-5.6 — Sol / Terra / Luna',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        description: 'מודל הדגל לחשיבה מורכבת וקידוד',
        recommended: true,
        contextWindow: 256000
      },
      {
        id: 'gpt-5.6-terra',
        label: 'GPT-5.6 Terra',
        description: 'איזון בין ביצועים לעלות',
        contextWindow: 256000
      },
      {
        id: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna',
        description: 'מהיר וחסכוני לנפחים גבוהים',
        contextWindow: 128000
      },
      {
        id: 'gpt-5.1',
        label: 'GPT-5.1',
        description: 'דור קודם — עדיין זמין עד דצמבר 2026',
        contextWindow: 256000
      },
      {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        description: 'יציב ומוכח למשימות כלליות',
        contextWindow: 128000
      }
    ]
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'מודלי Claude — Fable / Opus / Sonnet / Haiku',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      {
        id: 'claude-fable-5',
        label: 'Claude Fable 5',
        description: 'המודל החזק ביותר לסוכנים ארוכי-טווח',
        contextWindow: 1000000
      },
      {
        id: 'claude-opus-4-8',
        label: 'Claude Opus 4.8',
        description: 'דגל לקידוד אגנטי ועבודה ארגונית',
        recommended: true,
        contextWindow: 1000000
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        description: 'השילוב הטוב ביותר של מהירות ובינה',
        contextWindow: 1000000
      },
      {
        id: 'claude-opus-4-7',
        label: 'Claude Opus 4.7',
        description: 'גרסה קודמת של Opus',
        contextWindow: 1000000
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        description: 'Sonnet קודם — יציב ומהיר',
        contextWindow: 1000000
      },
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'Claude Haiku 4.5',
        description: 'המהיר ביותר עם בינה כמעט-חזיתית',
        contextWindow: 200000
      }
    ]
  },
  {
    id: 'gemini',
    label: 'Google (Gemini)',
    description: 'מודלי Gemini 3.x ו-2.5',
    keyPlaceholder: 'AIza...',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro',
        description: 'SOTA לחשיבה, מולטימודלי וקידוד',
        recommended: true,
        contextWindow: 1000000
      },
      {
        id: 'gemini-3.6-flash',
        label: 'Gemini 3.6 Flash',
        description: 'מודל Flash החזק ביותר (יולי 2026)',
        contextWindow: 1000000
      },
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        description: 'מהיר ויציב למשימות אגנטיות',
        contextWindow: 1000000
      },
      {
        id: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash-Lite',
        description: 'קל וחסכוני',
        contextWindow: 1000000
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash-Lite',
        description: 'Lite מדור 3.1',
        contextWindow: 1000000
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash (Preview)',
        description: 'Preview — מהיר עם יכולות חיפוש',
        contextWindow: 1000000
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Pro יציב — עד אוקטובר 2026',
        contextWindow: 1000000
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Flash יציב עם חלון הקשר של 1M',
        contextWindow: 1000000
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        description: 'Lite מהיר וזול',
        contextWindow: 1000000
      }
    ]
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'מפתח אחד למאות מודלים — DeepSeek, Qwen, Llama, Kimi ועוד',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/settings/keys',
    models: [
      {
        id: 'openrouter:deepseek/deepseek-chat-v3.1',
        label: 'DeepSeek V3.1',
        description: 'קידוד חזק במחיר נמוך',
        recommended: true,
        contextWindow: 128000
      },
      {
        id: 'openrouter:qwen/qwen3-coder',
        label: 'Qwen3 Coder',
        description: 'מודל קוד ייעודי של Alibaba',
        contextWindow: 128000
      },
      {
        id: 'openrouter:moonshotai/kimi-k2',
        label: 'Kimi K2',
        description: 'מודל סוכנים חזק של Moonshot',
        contextWindow: 128000
      },
      {
        id: 'openrouter:meta-llama/llama-3.3-70b-instruct',
        label: 'Llama 3.3 70B',
        description: 'קוד פתוח — זול ומהיר',
        contextWindow: 128000
      }
    ]
  },
  {
    id: 'ollama',
    label: 'Ollama (מקומי)',
    description: 'מודלים שרצים על המחשב שלך — חינם, פרטי, בלי מפתח. דורש ש-Ollama מותקן ורץ',
    keyPlaceholder: 'לא נדרש מפתח',
    keyUrl: 'https://ollama.com/download',
    requiresKey: false,
    models: [
      {
        id: 'ollama:qwen2.5-coder:14b',
        label: 'Qwen2.5 Coder 14B',
        description: 'מודל הקוד המקומי המומלץ (ollama pull qwen2.5-coder:14b)',
        recommended: true,
        contextWindow: 32000
      },
      {
        id: 'ollama:qwen2.5-coder:7b',
        label: 'Qwen2.5 Coder 7B',
        description: 'קטן ומהיר — למחשבים עם פחות זיכרון',
        contextWindow: 32000
      },
      {
        id: 'ollama:llama3.3',
        label: 'Llama 3.3 70B',
        description: 'דורש מחשב חזק (48GB+ RAM)',
        contextWindow: 128000
      },
      {
        id: 'ollama:deepseek-r1:14b',
        label: 'DeepSeek R1 14B',
        description: 'מודל חשיבה מקומי',
        contextWindow: 64000
      }
    ]
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (מקומי)',
    description: 'מודלים מקומיים דרך שרת LM Studio — הפעל את השרת (Developer → Start Server) ובחר מודל בשם שטעון שם',
    keyPlaceholder: 'לא נדרש מפתח',
    keyUrl: 'https://lmstudio.ai',
    requiresKey: false,
    models: [
      {
        id: 'lmstudio:qwen2.5-coder-14b-instruct',
        label: 'Qwen2.5 Coder 14B',
        description: 'ודא שהמודל בשם הזה טעון ב-LM Studio',
        recommended: true,
        contextWindow: 32000
      },
      {
        id: 'lmstudio:qwen2.5-coder-7b-instruct',
        label: 'Qwen2.5 Coder 7B',
        description: 'קטן ומהיר — למחשבים עם פחות זיכרון',
        contextWindow: 32000
      },
      {
        id: 'lmstudio:deepseek-r1-distill-qwen-14b',
        label: 'DeepSeek R1 Distill 14B',
        description: 'מודל חשיבה מקומי',
        contextWindow: 64000
      }
    ]
  }
]

export function getProvider(id: AiProvider): ProviderInfo {
  const p = AI_PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error(`ספק לא ידוע: ${id}`)
  return p
}

export function getDefaultModel(provider: AiProvider): string {
  const p = getProvider(provider)
  return p.models.find((m) => m.recommended)?.id ?? p.models[0].id
}

export function findModel(modelId: string): AiModelOption | undefined {
  for (const p of AI_PROVIDERS) {
    const m = p.models.find((x) => x.id === modelId)
    if (m) return m
  }
  return undefined
}

export function getModelContextWindow(modelId: string): number {
  return findModel(modelId)?.contextWindow ?? 128000
}

export const DEFAULT_SETTINGS: Omit<AppSettings, 'openaiApiKey' | 'anthropicApiKey' | 'geminiApiKey'> = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-opus-4-8',
  theme: 'dark',
  agentEngine: 'new',
  engineMigratedToNew: true
}

/** Per-project integration public metadata (no secrets) */
export interface GithubIntegrationMeta {
  connected: boolean
  login?: string
  repoFullName?: string
  remoteUrl?: string
  defaultBranch?: string
  private?: boolean
}

export interface SupabaseIntegrationMeta {
  connected: boolean
  projectUrl?: string
  hasAnonKey: boolean
  hasServiceKey: boolean
  lastTestOk?: boolean
  lastTestAt?: string
}

export interface VercelIntegrationMeta {
  connected: boolean
  /** platform = instant/claim; user = account token */
  mode?: 'platform' | 'user'
  projectId?: string
  projectName?: string
  deploymentId?: string
  url?: string
  claimUrl?: string
  lastDeployAt?: string
  lastReadyState?: string
  lastErrorLog?: string
  framework?: string | null
}

export interface ProjectIntegrations {
  github: GithubIntegrationMeta
  supabase: SupabaseIntegrationMeta
  vercel: VercelIntegrationMeta
}

export interface GithubUserInfo {
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface GithubRepoInfo {
  fullName: string
  name: string
  private: boolean
  htmlUrl: string
  cloneUrl: string
  defaultBranch: string
}

export interface SupabaseConnectInput {
  projectId: string
  projectUrl: string
  anonKey: string
  serviceRoleKey?: string
  writeEnvFiles?: boolean
  scaffoldClient?: boolean
}

export interface VercelUserInfo {
  id: string
  username: string
  name: string | null
  email: string | null
}

export interface VercelProjectInfo {
  id: string
  name: string
  framework: string | null
}

export interface VercelDeployInput {
  projectId: string
  /** instant = Path A (platform + claim); account = Path B (user token) */
  mode: 'instant' | 'account'
  /** Path B: create a brand-new Vercel project */
  createNew?: boolean
  projectName?: string
  existingProjectId?: string
  existingProjectName?: string
  /**
   * Explicit security override after the user typed the acknowledgment phrase.
   * Without this, blocking findings stop the deploy.
   */
  securityOverride?: {
    confirmed: boolean
    phrase: string
  }
}

/** Must type this exactly to override a security block */
export const SECURITY_OVERRIDE_PHRASE =
  'אני מבין את הסיכון ורוצה לפרסם בכל זאת'

export interface PublishSecurityFindingDto {
  id: string
  kind: string
  severity: 'block' | 'warn'
  title: string
  found: string
  why: string
  fixHint?: string
  path?: string
}

export interface VercelDeployResult {
  ok: boolean
  mode: 'platform' | 'user'
  url?: string
  claimUrl?: string
  deploymentId: string
  projectId?: string
  projectName?: string
  readyState: string
  framework?: string | null
  fileCount?: number
  buildLogHebrew?: string
  message: string
  /** Pre-publish security gate blocked the deploy */
  securityBlocked?: boolean
  securityFindings?: PublishSecurityFindingDto[]
  securitySummaryHebrew?: string
  /** Prompt-ready text for «תן לסוכן לתקן» */
  securityAgentPrompt?: string
}

export const DEFAULT_INTEGRATIONS: ProjectIntegrations = {
  github: { connected: false },
  supabase: { connected: false, hasAnonKey: false, hasServiceKey: false },
  vercel: { connected: false }
}

