import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync
} from 'fs'
import { basename, extname, join, relative } from 'path'
import type { ProjectIndex } from './types'

const CACHE_DIR = '.nf-blaze'
const CACHE_FILE = 'project-index.json'

/** In-memory cache keyed by absolute rootDir */
const memory = new Map<string, ProjectIndex>()

export function cachePath(rootDir: string): string {
  return join(rootDir, CACHE_DIR, CACHE_FILE)
}

export function getCachedIndex(rootDir: string): ProjectIndex | null {
  const hit = memory.get(rootDir)
  if (hit) return hit

  const path = cachePath(rootDir)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as ProjectIndex
    if (!raw?.conventions || raw.rootDir !== rootDir) return null
    memory.set(rootDir, raw)
    return raw
  } catch {
    return null
  }
}

export function saveIndex(index: ProjectIndex): void {
  memory.set(index.rootDir, index)
  const dir = join(index.rootDir, CACHE_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(cachePath(index.rootDir), JSON.stringify(index, null, 2), 'utf8')
}

export function clearIndexCache(rootDir?: string): void {
  if (rootDir) {
    memory.delete(rootDir)
    return
  }
  memory.clear()
}

export function listSourceFiles(rootDir: string, maxFiles = 400): string[] {
  const skip = new Set([
    'node_modules',
    '.git',
    '.nf-blaze',
    'dist',
    'build',
    'out',
    'release',
    'coverage',
    '.next',
    '.vite'
  ])
  const exts = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.css',
    '.scss',
    '.sass',
    '.less'
  ])
  const out: string[] = []

  function walk(dir: string): void {
    if (out.length >= maxFiles) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (out.length >= maxFiles) break
      if (skip.has(name)) continue
      if (name.startsWith('.') && name !== '.ts' && name !== '.') continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (st.isFile()) {
        const ext = extname(name).toLowerCase()
        if (exts.has(ext) || name === 'tailwind.config.js' || name === 'tailwind.config.ts') {
          out.push(full)
        }
      }
    }
  }

  walk(rootDir)
  return out
}

export function readTextSafe(path: string, maxBytes = 120_000): string {
  try {
    const buf = readFileSync(path)
    if (buf.length > maxBytes) return buf.subarray(0, maxBytes).toString('utf8')
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

export function relPosix(rootDir: string, absolute: string): string {
  return relative(rootDir, absolute).split('\\').join('/')
}

export function fileBaseName(path: string): string {
  return basename(path, extname(path))
}
