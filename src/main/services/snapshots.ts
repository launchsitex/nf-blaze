import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { AgentFileAction, ProjectSnapshot, FileSnapshotEntry } from '../../shared/types'
import { getProject } from './storage'
import {
  readProjectFile,
  resolveSafePath,
  writeProjectFile,
  deleteProjectFile
} from './filesystem'

function snapshotsDir(folderPath: string): string {
  const d = join(folderPath, '.nf-blaze', 'snapshots')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function latestPointer(folderPath: string): string {
  return join(folderPath, '.nf-blaze', 'latest-snapshot.json')
}

/** Capture current file state before applying AI actions (for undo). */
export function createSnapshot(
  projectId: string,
  actions: AgentFileAction[],
  messageId?: string
): ProjectSnapshot | null {
  const project = getProject(projectId)
  if (!project?.folderPath) return null

  const entries: FileSnapshotEntry[] = []
  const seen = new Set<string>()

  for (const action of actions) {
    if (seen.has(action.path)) continue
    seen.add(action.path)
    try {
      const full = resolveSafePath(project.folderPath, action.path)
      if (existsSync(full)) {
        try {
          const content = readProjectFile(project.folderPath, action.path)
          entries.push({ path: action.path, content, existed: true })
        } catch {
          entries.push({ path: action.path, content: null, existed: true })
        }
      } else {
        entries.push({ path: action.path, content: null, existed: false })
      }
    } catch {
      /* skip unsafe */
    }
  }

  if (!entries.length) return null

  const snap: ProjectSnapshot = {
    id: uuidv4(),
    projectId,
    createdAt: new Date().toISOString(),
    messageId,
    entries
  }

  const path = join(snapshotsDir(project.folderPath), `${snap.id}.json`)
  writeFileSync(path, JSON.stringify(snap, null, 2), 'utf-8')
  writeFileSync(latestPointer(project.folderPath), JSON.stringify({ id: snap.id }), 'utf-8')
  pruneOld(project.folderPath, 30)
  return snap
}

/**
 * הוספת קבצים ל-snapshot קיים של אותו סבב — לפני שהם נכתבים.
 * מבטיח ש"בטל" אחד משחזר את *כל* קבצי הסבב, גם כאלה שנוספו בהרחבת scope.
 */
export function extendSnapshot(
  projectId: string,
  snapshotId: string,
  actions: AgentFileAction[]
): boolean {
  const project = getProject(projectId)
  if (!project?.folderPath) return false
  const snapPath = join(snapshotsDir(project.folderPath), `${snapshotId}.json`)
  if (!existsSync(snapPath)) return false

  let snap: ProjectSnapshot
  try {
    snap = JSON.parse(readFileSync(snapPath, 'utf-8')) as ProjectSnapshot
  } catch {
    return false
  }

  const seen = new Set(snap.entries.map((e) => e.path))
  let added = false
  for (const action of actions) {
    if (seen.has(action.path)) continue
    seen.add(action.path)
    try {
      const full = resolveSafePath(project.folderPath, action.path)
      if (existsSync(full)) {
        try {
          const content = readProjectFile(project.folderPath, action.path)
          snap.entries.push({ path: action.path, content, existed: true })
        } catch {
          snap.entries.push({ path: action.path, content: null, existed: true })
        }
      } else {
        snap.entries.push({ path: action.path, content: null, existed: false })
      }
      added = true
    } catch {
      /* skip unsafe */
    }
  }

  if (added) {
    writeFileSync(snapPath, JSON.stringify(snap, null, 2), 'utf-8')
  }
  return true
}

function pruneOld(folderPath: string, keep: number): void {
  const dir = snapshotsDir(folderPath)
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, t: join(dir, f) }))
    .sort((a, b) => {
      try {
        const aa = JSON.parse(readFileSync(a.t, 'utf-8')) as ProjectSnapshot
        const bb = JSON.parse(readFileSync(b.t, 'utf-8')) as ProjectSnapshot
        return bb.createdAt.localeCompare(aa.createdAt)
      } catch {
        return 0
      }
    })

  for (const extra of files.slice(keep)) {
    try {
      unlinkSync(extra.t)
    } catch {
      /* ignore */
    }
  }
}

function readAllSnapshots(folderPath: string): ProjectSnapshot[] {
  const dir = snapshotsDir(folderPath)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as ProjectSnapshot
      } catch {
        return null
      }
    })
    .filter((x): x is ProjectSnapshot => Boolean(x))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

import type { SnapshotFileDiff, SnapshotSummary } from '../../shared/types'
export type { SnapshotSummary }

/**
 * Diff של סבב: לכל קובץ ב-snapshot — התוכן שלפני (מה-snapshot) מול הנוכחי בדיסק.
 */
export function getSnapshotDiff(
  projectId: string,
  snapshotId: string
): { ok: boolean; files: SnapshotFileDiff[]; message?: string } {
  const project = getProject(projectId)
  if (!project?.folderPath) {
    return { ok: false, files: [], message: 'פרויקט לא נמצא' }
  }
  const snapPath = join(snapshotsDir(project.folderPath), `${snapshotId}.json`)
  if (!existsSync(snapPath)) {
    return {
      ok: false,
      files: [],
      message: 'נקודת השחזור כבר לא קיימת (בוטלה או נמחקה מההיסטוריה)'
    }
  }
  let snap: ProjectSnapshot
  try {
    snap = JSON.parse(readFileSync(snapPath, 'utf-8')) as ProjectSnapshot
  } catch {
    return { ok: false, files: [], message: 'קובץ נקודת השחזור פגום' }
  }

  const files: SnapshotFileDiff[] = []
  for (const entry of snap.entries) {
    let after: string | null = null
    try {
      const full = resolveSafePath(project.folderPath, entry.path)
      if (existsSync(full)) after = readProjectFile(project.folderPath, entry.path)
    } catch {
      after = null
    }
    files.push({
      path: entry.path,
      before: entry.existed ? entry.content : null,
      after
    })
  }
  // שינויים אמיתיים בלבד — קבצים שנשמרו ב-scope אך לא נגעו בהם לא מוצגים
  return { ok: true, files: files.filter((f) => f.before !== f.after) }
}

/** רשימת נקודות שחזור, מהחדשה לישנה */
export function listSnapshots(projectId: string): SnapshotSummary[] {
  const project = getProject(projectId)
  if (!project?.folderPath) return []
  return readAllSnapshots(project.folderPath).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    messageId: s.messageId,
    files: s.entries.map((e) => e.path)
  }))
}

/**
 * שחזור לכל נקודה בהיסטוריה — מחיל את כל ה-snapshots מהחדש ועד היעד (כולל),
 * כך שהפרויקט חוזר למצב שלפני הסבב של היעד. ה-snapshots שהוחלו נמחקים.
 */
export function restoreToSnapshot(
  projectId: string,
  snapshotId: string
): { ok: boolean; restored: string[]; message: string } {
  const project = getProject(projectId)
  if (!project?.folderPath) {
    return { ok: false, restored: [], message: 'פרויקט לא נמצא' }
  }

  const all = readAllSnapshots(project.folderPath)
  const targetIndex = all.findIndex((s) => s.id === snapshotId)
  if (targetIndex < 0) {
    return { ok: false, restored: [], message: 'נקודת השחזור לא נמצאה' }
  }

  // מהחדש לישן עד היעד — כל snapshot מחזיר את הקבצים שלו למצב שלפני אותו סבב
  const toApply = all.slice(0, targetIndex + 1)
  const restored = new Set<string>()
  for (const snap of toApply) {
    for (const entry of snap.entries) {
      try {
        if (!entry.existed) {
          deleteProjectFile(project.folderPath, entry.path)
          restored.add(entry.path)
        } else if (entry.content !== null) {
          writeProjectFile(project.folderPath, entry.path, entry.content)
          restored.add(entry.path)
        }
      } catch (err) {
        console.error('restore failed for', entry.path, err)
      }
    }
  }

  for (const snap of toApply) {
    try {
      unlinkSync(join(snapshotsDir(project.folderPath), `${snap.id}.json`))
    } catch {
      /* ignore */
    }
  }

  const remaining = all.slice(targetIndex + 1)
  if (remaining[0]) {
    writeFileSync(
      latestPointer(project.folderPath),
      JSON.stringify({ id: remaining[0].id }),
      'utf-8'
    )
  } else if (existsSync(latestPointer(project.folderPath))) {
    unlinkSync(latestPointer(project.folderPath))
  }

  return {
    ok: true,
    restored: Array.from(restored),
    message: `שוחזרו ${restored.size} קבצים (${toApply.length} נקודות אחורה)`
  }
}

/** ספירת שורות שנוספו/נמחקו — multiset diff מהיר (מדויק-בקירוב, כמו git --stat) */
export function lineChangeStats(
  before: string | null,
  after: string | null
): { added: number; removed: number } {
  const beforeLines = before === null ? [] : before.split('\n')
  const afterLines = after === null ? [] : after.split('\n')
  const counts = new Map<string, number>()
  for (const line of beforeLines) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of afterLines) {
    const c = counts.get(line) ?? 0
    if (c > 0) counts.set(line, c - 1)
    else added++
  }
  let removed = 0
  for (const c of counts.values()) removed += c
  return { added, removed }
}

/** סטטיסטיקת שינויים לכל קובץ בסבב — להצגה על הודעת הסוכן */
export function getSnapshotChangeStats(
  projectId: string,
  snapshotId: string
): Record<string, { added: number; removed: number }> {
  const diff = getSnapshotDiff(projectId, snapshotId)
  if (!diff.ok) return {}
  const out: Record<string, { added: number; removed: number }> = {}
  for (const f of diff.files) out[f.path] = lineChangeStats(f.before, f.after)
  return out
}

export function getLatestSnapshotId(projectId: string): string | null {
  const project = getProject(projectId)
  if (!project?.folderPath) return null
  const ptr = latestPointer(project.folderPath)
  if (!existsSync(ptr)) return null
  try {
    const { id } = JSON.parse(readFileSync(ptr, 'utf-8')) as { id: string }
    return id || null
  } catch {
    return null
  }
}

export function undoLatestSnapshot(projectId: string): {
  ok: boolean
  restored: string[]
  message: string
} {
  const project = getProject(projectId)
  if (!project?.folderPath) {
    return { ok: false, restored: [], message: 'פרויקט לא נמצא' }
  }

  const id = getLatestSnapshotId(projectId)
  if (!id) {
    return { ok: false, restored: [], message: 'אין שינוי אחרון לביטול' }
  }

  const snapPath = join(snapshotsDir(project.folderPath), `${id}.json`)
  if (!existsSync(snapPath)) {
    return { ok: false, restored: [], message: 'ה־snapshot לא נמצא' }
  }

  const snap = JSON.parse(readFileSync(snapPath, 'utf-8')) as ProjectSnapshot
  const restored: string[] = []

  for (const entry of snap.entries) {
    try {
      if (!entry.existed) {
        deleteProjectFile(project.folderPath, entry.path)
        restored.push(entry.path)
      } else if (entry.content !== null) {
        writeProjectFile(project.folderPath, entry.path, entry.content)
        restored.push(entry.path)
      }
    } catch (err) {
      console.error('undo failed for', entry.path, err)
    }
  }

  try {
    unlinkSync(snapPath)
  } catch {
    /* ignore */
  }

  const remaining = readdirSync(snapshotsDir(project.folderPath))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(
          readFileSync(join(snapshotsDir(project.folderPath), f), 'utf-8')
        ) as ProjectSnapshot
      } catch {
        return null
      }
    })
    .filter((x): x is ProjectSnapshot => Boolean(x))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (remaining[0]) {
    writeFileSync(
      latestPointer(project.folderPath),
      JSON.stringify({ id: remaining[0].id }),
      'utf-8'
    )
  } else if (existsSync(latestPointer(project.folderPath))) {
    unlinkSync(latestPointer(project.folderPath))
  }

  return {
    ok: true,
    restored,
    message: restored.length
      ? `בוטלו שינויים ב-${restored.length} קבצים`
      : 'לא היו קבצים לשחזור'
  }
}
