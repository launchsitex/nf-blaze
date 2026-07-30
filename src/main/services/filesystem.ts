import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  unlinkSync
} from 'fs'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'path'
import type { FileNode } from '../../shared/types'

const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.cache',
  'coverage',
  '.turbo'
])

/** Resolve a relative path safely inside project root. Throws on traversal. */
export function resolveSafePath(projectRoot: string, relativePath: string): string {
  if (!projectRoot || !existsSync(projectRoot)) {
    throw new Error('תיקיית הפרויקט אינה קיימת')
  }
  const root = resolve(projectRoot)
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (cleaned.includes('\0') || cleaned.split('/').includes('..')) {
    throw new Error('גישה חסומה: הנתיב מחוץ לתיקיית הפרויקט')
  }
  const target = resolve(root, cleaned)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('גישה חסומה: הנתיב מחוץ לתיקיית הפרויקט')
  }
  return target
}

export function buildFileTree(projectRoot: string, maxDepth = 6): FileNode[] {
  const root = resolve(projectRoot)
  if (!existsSync(root)) return []

  function walk(dir: string, depth: number): FileNode[] {
    if (depth > maxDepth) return []
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return []
    }
    const nodes: FileNode[] = []
    for (const name of entries.sort((a, b) => a.localeCompare(b, 'he'))) {
      if (IGNORED.has(name) || name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      const rel = relative(root, full).replace(/\\/g, '/')
      if (st.isDirectory()) {
        nodes.push({
          name,
          path: full,
          relativePath: rel,
          isDirectory: true,
          children: walk(full, depth + 1)
        })
      } else {
        nodes.push({
          name,
          path: full,
          relativePath: rel,
          isDirectory: false
        })
      }
    }
    // directories first
    return nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, 'he')
    })
  }

  return walk(root, 0)
}

export function summarizeTree(nodes: FileNode[], prefix = ''): string {
  const lines: string[] = []
  for (const n of nodes) {
    lines.push(`${prefix}${n.isDirectory ? '📁' : '📄'} ${n.relativePath}`)
    if (n.children?.length) {
      lines.push(summarizeTree(n.children, prefix))
    }
  }
  return lines.slice(0, 200).join('\n')
}

export function readProjectFile(projectRoot: string, relativePath: string): string {
  const full = resolveSafePath(projectRoot, relativePath)
  if (!existsSync(full) || statSync(full).isDirectory()) {
    throw new Error(`הקובץ לא נמצא: ${relativePath}`)
  }
  const size = statSync(full).size
  if (size > 2_000_000) {
    throw new Error('הקובץ גדול מדי לקריאה (מעל 2MB)')
  }
  return readFileSync(full, 'utf-8')
}

export function writeProjectFile(projectRoot: string, relativePath: string, content: string): void {
  const full = resolveSafePath(projectRoot, relativePath)
  const dir = dirname(full)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

export function deleteProjectFile(projectRoot: string, relativePath: string): void {
  const full = resolveSafePath(projectRoot, relativePath)
  if (!existsSync(full)) return
  const st = statSync(full)
  if (st.isDirectory()) {
    rmSync(full, { recursive: true, force: true })
  } else {
    unlinkSync(full)
  }
}

export function ensureDir(projectRoot: string, relativePath: string): void {
  const full = resolveSafePath(projectRoot, relativePath)
  if (!existsSync(full)) mkdirSync(full, { recursive: true })
}

export function normalizeRel(p: string): string {
  return normalize(p).replace(/\\/g, '/').replace(/^\/+/, '')
}
