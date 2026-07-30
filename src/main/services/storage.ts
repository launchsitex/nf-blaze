import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type {
  AppSettings,
  ChatMessage,
  ChatMeta,
  ChatSession,
  ChatsIndex,
  ProjectMeta,
  ProjectPlan
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'

function dataRoot(): string {
  const root = join(app.getPath('userData'), 'nf-blaze-data')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function projectsDir(): string {
  const d = join(dataRoot(), 'projects')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function settingsPath(): string {
  return join(dataRoot(), 'settings.json')
}

/** Index entry in app data (points to folder on disk) */
function projectIndexPath(id: string): string {
  return join(projectsDir(), `${id}.json`)
}

/** Project-local NF-Blaze folder inside the user-chosen directory */
function projectLocalDir(folderPath: string): string {
  const d = join(folderPath, '.nf-blaze')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function projectLocalMetaPath(folderPath: string): string {
  return join(projectLocalDir(folderPath), 'project.json')
}

function projectLocalChatPath(folderPath: string): string {
  return join(projectLocalDir(folderPath), 'chat.json')
}

function projectLocalMemoryPath(folderPath: string): string {
  return join(projectLocalDir(folderPath), 'memory.md')
}

function projectLocalPlanPath(folderPath: string): string {
  return join(projectLocalDir(folderPath), 'plan.json')
}

export function loadSettingsRaw(): AppSettings {
  const path = settingsPath()
  if (!existsSync(path)) {
    const initial: AppSettings = { ...DEFAULT_SETTINGS }
    writeFileSync(path, JSON.stringify(initial, null, 2), 'utf-8')
    return initial
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as AppSettings
    // מיגרציה חד-פעמית (1.36.0): המנוע החדש הופך לברירת המחדל גם למשתמשים קיימים.
    // מי שיחזור ידנית ל«ישן» בהגדרות — הבחירה שלו תישמר (המיגרציה לא רצה שוב).
    if (!parsed.engineMigratedToNew) {
      parsed.agentEngine = 'new'
      parsed.engineMigratedToNew = true
      try {
        writeFileSync(path, JSON.stringify(parsed, null, 2), 'utf-8')
      } catch {
        /* best effort */
      }
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettingsRaw()
  const next = { ...current, ...partial }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function listProjects(): ProjectMeta[] {
  const dir = projectsDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  const projects: ProjectMeta[] = []
  for (const file of files) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as ProjectMeta
      // Prefer fresh copy from project folder if available
      if (meta.folderPath && existsSync(projectLocalMetaPath(meta.folderPath))) {
        try {
          const local = JSON.parse(
            readFileSync(projectLocalMetaPath(meta.folderPath), 'utf-8')
          ) as ProjectMeta
          projects.push({ ...local, folderPath: meta.folderPath, id: meta.id })
          continue
        } catch {
          /* fall through */
        }
      }
      projects.push(meta)
    } catch {
      // skip corrupt
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getProject(id: string): ProjectMeta | null {
  const path = projectIndexPath(id)
  if (!existsSync(path)) return null
  try {
    const meta = JSON.parse(readFileSync(path, 'utf-8')) as ProjectMeta
    if (meta.folderPath && existsSync(projectLocalMetaPath(meta.folderPath))) {
      try {
        const local = JSON.parse(
          readFileSync(projectLocalMetaPath(meta.folderPath), 'utf-8')
        ) as ProjectMeta
        return { ...local, folderPath: meta.folderPath, id: meta.id }
      } catch {
        /* use index */
      }
    }
    return meta
  } catch {
    return null
  }
}

export function saveProject(meta: ProjectMeta): ProjectMeta {
  // App index
  writeFileSync(projectIndexPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8')
  // Persist inside the user-selected project folder
  if (meta.folderPath && existsSync(meta.folderPath)) {
    writeFileSync(projectLocalMetaPath(meta.folderPath), JSON.stringify(meta, null, 2), 'utf-8')
  }
  return meta
}

export function deleteProject(id: string): boolean {
  const meta = getProject(id)
  const index = projectIndexPath(id)
  if (existsSync(index)) rmSync(index)
  // Do NOT delete the user's project folder or its .nf-blaze data
  void meta
  return true
}

/* --- ריבוי צ'אטים לפרויקט ---
   chats/<id>.json + אינדקס chats-index.json עם הצ'אט הפעיל.
   loadChat/saveChat ממשיכים לעבוד מול הצ'אט הפעיל — הסוכן לא צריך לדעת כלום. */

function projectChatsDir(folderPath: string): string {
  const d = join(projectLocalDir(folderPath), 'chats')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function chatsIndexPath(folderPath: string): string {
  return join(projectLocalDir(folderPath), 'chats-index.json')
}

function chatFilePath(folderPath: string, chatId: string): string {
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(projectChatsDir(folderPath), `${safe}.json`)
}

function defaultChatTitle(): string {
  return 'שיחה חדשה'
}

/** טוען אינדקס צ'אטים; מיגרציה שקטה מ-chat.json הישן בפעם הראשונה */
export function loadChatsIndex(projectId: string): ChatsIndex {
  const project = getProject(projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    return { activeChatId: 'main', chats: [] }
  }
  const idxPath = chatsIndexPath(project.folderPath)
  if (existsSync(idxPath)) {
    try {
      const idx = JSON.parse(readFileSync(idxPath, 'utf-8')) as ChatsIndex
      if (idx.chats?.length && idx.activeChatId) return idx
    } catch {
      /* rebuild below */
    }
  }
  // מיגרציה: chat.json ישן → הצ'אט הראשון
  const now = new Date().toISOString()
  const firstId = uuidv4()
  const meta: ChatMeta = { id: firstId, title: 'שיחה ראשית', createdAt: now, updatedAt: now }
  const legacyPath = projectLocalChatPath(project.folderPath)
  let legacy: ChatSession | null = null
  if (existsSync(legacyPath)) {
    try {
      legacy = JSON.parse(readFileSync(legacyPath, 'utf-8')) as ChatSession
    } catch {
      legacy = null
    }
  }
  const session: ChatSession = legacy
    ? { ...legacy, chatId: firstId }
    : { chatId: firstId, projectId, messages: [], updatedAt: now }
  writeFileSync(
    chatFilePath(project.folderPath, firstId),
    JSON.stringify(session, null, 2),
    'utf-8'
  )
  const idx: ChatsIndex = { activeChatId: firstId, chats: [meta] }
  writeFileSync(idxPath, JSON.stringify(idx, null, 2), 'utf-8')
  return idx
}

function saveChatsIndex(folderPath: string, idx: ChatsIndex): void {
  writeFileSync(chatsIndexPath(folderPath), JSON.stringify(idx, null, 2), 'utf-8')
}

export function createChat(
  projectId: string,
  title?: string,
  seedMessages?: ChatMessage[]
): ChatMeta {
  const project = getProject(projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    throw new Error('תיקיית הפרויקט חסרה')
  }
  const idx = loadChatsIndex(projectId)
  const now = new Date().toISOString()
  const meta: ChatMeta = {
    id: uuidv4(),
    title: (title || defaultChatTitle()).slice(0, 60),
    createdAt: now,
    updatedAt: now
  }
  const session: ChatSession = {
    chatId: meta.id,
    projectId,
    messages: seedMessages ?? [],
    updatedAt: now
  }
  writeFileSync(
    chatFilePath(project.folderPath, meta.id),
    JSON.stringify(session, null, 2),
    'utf-8'
  )
  idx.chats.unshift(meta)
  idx.activeChatId = meta.id
  saveChatsIndex(project.folderPath, idx)
  return meta
}

export function switchChat(projectId: string, chatId: string): ChatsIndex {
  const project = getProject(projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')
  const idx = loadChatsIndex(projectId)
  if (idx.chats.some((c) => c.id === chatId)) {
    idx.activeChatId = chatId
    saveChatsIndex(project.folderPath, idx)
  }
  return idx
}

export function deleteChat(projectId: string, chatId: string): ChatsIndex {
  const project = getProject(projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')
  const idx = loadChatsIndex(projectId)
  if (idx.chats.length <= 1) return idx // תמיד נשאר צ'אט אחד
  idx.chats = idx.chats.filter((c) => c.id !== chatId)
  try {
    const p = chatFilePath(project.folderPath, chatId)
    if (existsSync(p)) rmSync(p)
  } catch {
    /* ignore */
  }
  if (idx.activeChatId === chatId) {
    idx.activeChatId = idx.chats[0]!.id
  }
  saveChatsIndex(project.folderPath, idx)
  return idx
}

export function loadChat(projectId: string): ChatSession {
  const project = getProject(projectId)
  if (project?.folderPath) {
    const idx = loadChatsIndex(projectId)
    const path = chatFilePath(project.folderPath, idx.activeChatId)
    if (existsSync(path)) {
      try {
        const session = JSON.parse(readFileSync(path, 'utf-8')) as ChatSession
        session.chatId = idx.activeChatId
        return session
      } catch {
        /* fall through */
      }
    }
    return {
      chatId: idx.activeChatId,
      projectId,
      messages: [],
      updatedAt: new Date().toISOString()
    }
  }
  return { projectId, messages: [], updatedAt: new Date().toISOString() }
}

export function saveChat(session: ChatSession): void {
  session.updatedAt = new Date().toISOString()
  const project = getProject(session.projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    throw new Error('לא ניתן לשמור צ׳אט — תיקיית הפרויקט חסרה')
  }
  const idx = loadChatsIndex(session.projectId)
  const chatId = session.chatId || idx.activeChatId
  session.chatId = chatId
  writeFileSync(
    chatFilePath(project.folderPath, chatId),
    JSON.stringify(session, null, 2),
    'utf-8'
  )
  // עדכון מטא — כותרת אוטומטית מההודעה הראשונה של המשתמש
  const meta = idx.chats.find((c) => c.id === chatId)
  if (meta) {
    meta.updatedAt = session.updatedAt
    if (meta.title === defaultChatTitle() || meta.title === 'שיחה ראשית') {
      const firstUser = session.messages.find((m) => m.role === 'user')
      if (firstUser?.content) {
        meta.title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 44) || meta.title
      }
    }
    saveChatsIndex(project.folderPath, idx)
  }
}

export function clearChat(projectId: string): ChatSession {
  const idx = loadChatsIndex(projectId)
  const empty: ChatSession = {
    chatId: idx.activeChatId,
    projectId,
    messages: [],
    updatedAt: new Date().toISOString()
  }
  saveChat(empty)
  return empty
}

/** זיכרון פרויקט מתמשך — החלטות ארכיטקטורה/עיצוב שהסוכן מתחזק בין סבבים */
const MEMORY_MAX_CHARS = 6000

export function loadProjectMemory(projectId: string): string {
  const project = getProject(projectId)
  if (!project?.folderPath) return ''
  const path = projectLocalMemoryPath(project.folderPath)
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf-8').slice(0, MEMORY_MAX_CHARS)
  } catch {
    return ''
  }
}

export function saveProjectMemory(projectId: string, content: string): void {
  const project = getProject(projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    throw new Error('לא ניתן לשמור זיכרון פרויקט — תיקיית הפרויקט חסרה')
  }
  writeFileSync(
    projectLocalMemoryPath(project.folderPath),
    content.slice(0, MEMORY_MAX_CHARS),
    'utf-8'
  )
}

/** תוכנית בנייה בשלבים שחיה בין הודעות */
export function loadProjectPlan(projectId: string): ProjectPlan | null {
  const project = getProject(projectId)
  if (!project?.folderPath) return null
  const path = projectLocalPlanPath(project.folderPath)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ProjectPlan
  } catch {
    return null
  }
}

export function saveProjectPlan(projectId: string, plan: ProjectPlan): ProjectPlan {
  const project = getProject(projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    throw new Error('לא ניתן לשמור תוכנית — תיקיית הפרויקט חסרה')
  }
  plan.updatedAt = new Date().toISOString()
  writeFileSync(
    projectLocalPlanPath(project.folderPath),
    JSON.stringify(plan, null, 2),
    'utf-8'
  )
  return plan
}

export function getDataRoot(): string {
  return dataRoot()
}
