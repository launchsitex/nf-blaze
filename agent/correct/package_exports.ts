/**
 * Resolve real named exports from an installed package under the user project.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const exportCache = new Map<string, Set<string>>()

function packageRootName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  return specifier.split('/')[0]
}

function readPkgJson(pkgDir: string): {
  typings?: string
  types?: string
  main?: string
  module?: string
  exports?: unknown
} | null {
  const p = join(pkgDir, 'package.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as {
      typings?: string
      types?: string
      main?: string
      module?: string
      exports?: unknown
    }
  } catch {
    return null
  }
}

function collectFromDts(text: string, into: Set<string>): void {
  // export declare const Foo
  for (const m of text.matchAll(
    /export\s+declare\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  )) {
    into.add(m[1]!)
  }
  // export { Foo, Bar as Baz }
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1]!.split(',')) {
      const raw = part.trim()
      if (!raw || raw.startsWith('type ')) continue
      const bits = raw.split(/\s+as\s+/)
      const exported = (bits[1] || bits[0] || '').replace(/^type\s+/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) into.add(exported)
    }
  }
  // export type { X }
  for (const m of text.matchAll(/export\s+type\s*\{([^}]+)\}/g)) {
    for (const part of m[1]!.split(',')) {
      const bits = part.trim().split(/\s+as\s+/)
      const exported = (bits[1] || bits[0] || '').replace(/^type\s+/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) into.add(exported)
    }
  }
}

function collectFromEsm(text: string, into: Set<string>): void {
  for (const m of text.matchAll(
    /export\s*\{([^}]+)\}/g
  )) {
    for (const part of m[1]!.split(',')) {
      const bits = part.trim().split(/\s+as\s+/)
      const exported = (bits[1] || bits[0] || '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) into.add(exported)
    }
  }
  for (const m of text.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z_$][\w$]*)/g
  )) {
    into.add(m[1]!)
  }
}

function tryRead(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Lucide ships thousands of icons — prefer .d.ts / icons folder listing */
function collectLucide(pkgDir: string, into: Set<string>): void {
  const dts = tryRead(join(pkgDir, 'dist', 'lucide-react.d.ts'))
  if (dts) {
    collectFromDts(dts, into)
    return
  }
  const iconsDir = join(pkgDir, 'dist', 'esm', 'icons')
  if (!existsSync(iconsDir)) return
  try {
    for (const name of readdirSync(iconsDir)) {
      if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue
      if (name === 'index.js' || name === 'index.mjs') continue
      // file "a-arrow-down.js" → export often PascalCase in d.ts; convert kebab → Pascal
      const base = name.replace(/\.(mjs|js)$/, '')
      const pascal = base
        .split('-')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('')
      into.add(pascal)
    }
  } catch {
    /* ignore */
  }
}

function walkExportCandidates(pkgDir: string, into: Set<string>): void {
  const pkg = readPkgJson(pkgDir)
  if (!pkg) return

  const typeEntry = pkg.typings || pkg.types
  if (typeof typeEntry === 'string') {
    const dts = tryRead(join(pkgDir, typeEntry))
    if (dts) collectFromDts(dts, into)
  }

  for (const rel of [
    'dist/index.d.ts',
    'index.d.ts',
    'dist/types/index.d.ts',
    'build/index.d.ts'
  ]) {
    const dts = tryRead(join(pkgDir, rel))
    if (dts) collectFromDts(dts, into)
  }

  const jsEntry = pkg.module || pkg.main
  if (typeof jsEntry === 'string' && into.size < 20) {
    const js = tryRead(join(pkgDir, jsEntry))
    if (js && js.length < 2_000_000) collectFromEsm(js, into)
  }
}

/**
 * Named exports available from `from 'pkg'` or `from 'pkg/subpath'`.
 * Cached per rootDir + specifier.
 */
export function getPackageExportNames(
  rootDir: string,
  specifier: string
): Set<string> | null {
  const cacheKey = `${rootDir}::${specifier}`
  const hit = exportCache.get(cacheKey)
  if (hit) return hit

  const root = packageRootName(specifier)
  const pkgDir = join(rootDir, 'node_modules', ...root.split('/'))
  if (!existsSync(pkgDir) || !statSync(pkgDir).isDirectory()) {
    return null
  }

  const names = new Set<string>()
  if (root === 'lucide-react' || specifier.startsWith('lucide-react')) {
    collectLucide(pkgDir, names)
  } else {
    walkExportCandidates(pkgDir, names)
    // subpath: try node_modules/pkg/subpath
    if (specifier !== root) {
      const sub = join(rootDir, 'node_modules', ...specifier.split('/'))
      if (existsSync(sub)) {
        if (statSync(sub).isDirectory()) walkExportCandidates(sub, names)
        else {
          const text = tryRead(sub)
          if (text) {
            if (sub.endsWith('.d.ts')) collectFromDts(text, names)
            else collectFromEsm(text, names)
          }
        }
      }
    }
  }

  if (names.size === 0) return null
  exportCache.set(cacheKey, names)
  return names
}

export function clearPackageExportCache(): void {
  exportCache.clear()
}

export { packageRootName }
