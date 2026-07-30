/**
 * Project convention index — Electron wiring for agent/index.
 * Builds/loads `{project}/.nf-blaze/project-index.json` without modifying agent/index.
 */
import { existsSync } from 'fs'
import { getProject } from './storage'
import {
  ensureProjectIndex,
  refreshProjectIndex,
  getCachedIndex,
  cachePath,
  formatConventionsBlock,
  type ProjectIndex
} from '../../../agent/index'
import type { ProjectIndexInfo } from '../../shared/types'

function toInfo(index: ProjectIndex, fromCache: boolean): ProjectIndexInfo {
  const c = index.conventions
  const summary = [
    `exports:${c.exports}`,
    `naming:${c.fileNaming}`,
    `state:${c.stateManagement.join('+') || '—'}`,
    `style:${c.styling.join('+') || '—'}`
  ].join(' · ')

  return {
    ready: true,
    rootDir: index.rootDir,
    scannedAt: index.scannedAt,
    filesSampled: index.filesSampled,
    fromCache,
    summary
  }
}

function requireProjectFolder(projectId: string): string {
  const project = getProject(projectId)
  if (!project?.folderPath) {
    throw new Error('הפרויקט לא נמצא')
  }
  if (!existsSync(project.folderPath)) {
    throw new Error(`תיקיית הפרויקט לא קיימת: ${project.folderPath}`)
  }
  return project.folderPath
}

/** Load cached index or scan once — call when opening a project */
export function openProjectIndex(projectId: string): ProjectIndexInfo {
  try {
    const rootDir = requireProjectFolder(projectId)
    const diskPath = cachePath(rootDir)
    const hadDisk = existsSync(diskPath)
    const hadMem = Boolean(getCachedIndex(rootDir))
    const fromCache = hadDisk || hadMem
    const index = ensureProjectIndex(rootDir)
    return toInfo(index, fromCache && hadDisk)
  } catch (err) {
    return {
      ready: false,
      rootDir: '',
      scannedAt: '',
      filesSampled: 0,
      fromCache: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** Force rescan (manual refresh or after a write round) */
export function refreshProjectIndexForProject(projectId: string): ProjectIndexInfo {
  try {
    const rootDir = requireProjectFolder(projectId)
    const index = refreshProjectIndex(rootDir)
    return toInfo(index, false)
  } catch (err) {
    return {
      ready: false,
      rootDir: '',
      scannedAt: '',
      filesSampled: 0,
      fromCache: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** Refresh by absolute folder path (used from agent bridge after writes) */
export function refreshProjectIndexAtRoot(rootDir: string): ProjectIndexInfo | null {
  if (!rootDir || !existsSync(rootDir)) return null
  try {
    const index = refreshProjectIndex(rootDir)
    return toInfo(index, false)
  } catch {
    return null
  }
}

export function getProjectIndexInfo(projectId: string): ProjectIndexInfo {
  try {
    const rootDir = requireProjectFolder(projectId)
    const cached = getCachedIndex(rootDir)
    if (cached) return toInfo(cached, true)
    return openProjectIndex(projectId)
  } catch (err) {
    return {
      ready: false,
      rootDir: '',
      scannedAt: '',
      filesSampled: 0,
      fromCache: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** Debug / optional: conventions block text already injected by the new loop */
export function peekConventionsBlock(projectId: string): string | null {
  try {
    const rootDir = requireProjectFolder(projectId)
    const index = ensureProjectIndex(rootDir)
    return formatConventionsBlock(index)
  } catch {
    return null
  }
}
