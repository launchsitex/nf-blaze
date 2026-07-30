/**
 * Phase A — deterministic corrections before content hits disk / UI.
 * No model calls.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import { parseImports, resolveLocalImport } from '../tools/validate_write'
import { closestName } from './fuzzy'
import { getPackageExportNames, packageRootName } from './package_exports'

export type CorrectionFix = {
  kind:
    | 'package_export_rename'
    | 'local_import_path'
    | 'local_import_marked'
    | 'jsx_common'
    | 'hook_provider'
    | 'missing_dependency'
    | 'ast_common'
  message: string
  from?: string
  to?: string
}

export type PhaseAResult = {
  content: string
  fixes: CorrectionFix[]
}

const CODE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs']

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function listBasenames(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((n) => {
      try {
        return statSync(join(dir, n)).isFile()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function renameInNamedBlock(block: string, from: string, to: string): string {
  return block.replace(
    new RegExp(
      `(^|[,{\\s])(${from})(\\s+as\\s+[A-Za-z_$][\\w$]*|(?=\\s*[,}]|\\s*$))`,
      'g'
    ),
    (_m, pre: string, _name: string, rest: string) => `${pre}${to}${rest || ''}`
  )
}

type Rename = { from: string; to: string; renameUsages: boolean }

/**
 * Fix named imports from installed packages against real exports (icons, UI kits).
 */
export function fixPackageNamedImports(
  rootDir: string,
  content: string
): PhaseAResult {
  const fixes: CorrectionFix[] = []
  const renames: Rename[] = []
  let next = content
  const imports = parseImports(content)

  for (const im of imports) {
    if (im.isLocal || im.source.startsWith('@/')) continue
    if (im.names.length === 0) continue

    const exports = getPackageExportNames(rootDir, im.source)
    if (!exports || exports.size === 0) continue

    const importLineRe = new RegExp(
      `(import\\s+(?:type\\s+)?(?:[\\w*$\\s,]*\\{\\s*))([^}]*)(\\}\\s*from\\s*['"]${escapeReg(
        im.source
      )}['"])`,
      'g'
    )

    next = next.replace(
      importLineRe,
      (full, head: string, block: string, tail: string) => {
        let blockOut = block
        for (const part of block.split(',')) {
          const trimmed = part.trim()
          if (!trimmed || trimmed.startsWith('type ')) continue
          const bits = trimmed.split(/\s+as\s+/)
          const exportName = bits[0]!.replace(/^type\s+/, '').trim()
          if (!exportName || exports.has(exportName)) continue

          const suggestion = closestName(exportName, exports)
          if (!suggestion) continue

          blockOut = renameInNamedBlock(blockOut, exportName, suggestion)
          const renameUsages = bits.length < 2
          renames.push({ from: exportName, to: suggestion, renameUsages })
          fixes.push({
            kind: 'package_export_rename',
            message: `${packageRootName(im.source)}: ${exportName} → ${suggestion}`,
            from: exportName,
            to: suggestion
          })
        }
        return `${head}${blockOut}${tail}`
      }
    )
  }

  for (const r of renames) {
    if (!r.renameUsages || r.from === r.to) continue
    const re = new RegExp(`\\b${escapeReg(r.from)}\\b`, 'g')
    next = next
      .split('\n')
      .map((line) => {
        if (/^\s*import\b/.test(line) && line.includes('from')) return line
        return line.replace(re, r.to)
      })
      .join('\n')
  }

  return { content: next, fixes }
}

function findClosestLocalFile(
  rootDir: string,
  fromAbs: string,
  specifier: string
): string | null {
  let dir: string
  let base: string

  if (specifier.startsWith('@/')) {
    const rest = specifier.slice(2)
    dir = join(rootDir, 'src', dirname(rest))
    base = rest.split('/').pop() || rest
  } else {
    dir = resolve(dirname(fromAbs), dirname(specifier))
    base = specifier.split('/').pop() || specifier
  }

  const baseNoExt = base.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, '')
  const files = listBasenames(dir)
  if (!files.length) return null

  const candidates = files.map((f) => f.replace(/\.(tsx?|jsx?|mjs|cjs|json)$/i, ''))
  const hit = closestName(baseNoExt, candidates, { maxDistance: 4 })
  if (!hit) return null

  const file = files.find(
    (f) => f.replace(/\.(tsx?|jsx?|mjs|cjs|json)$/i, '') === hit
  )
  if (!file) return null

  const abs = join(dir, file)
  const withoutExt = file.replace(/\.(tsx?|jsx?)$/i, '')

  if (specifier.startsWith('@/')) {
    const relFromSrc = toPosix(relative(join(rootDir, 'src'), abs))
    const noExt = relFromSrc.replace(/\.(tsx?|jsx?)$/i, '')
    return `@/${noExt}`
  }

  let rel = toPosix(relative(dirname(fromAbs), join(dir, withoutExt)))
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

/**
 * Ensure local / @/ imports resolve; fix path via fuzzy match or mark missing.
 */
export function fixLocalImports(
  rootDir: string,
  fileRelPath: string,
  content: string
): PhaseAResult {
  const fromAbs = resolve(rootDir, fileRelPath.replace(/\//g, sep))
  let next = content
  const fixes: CorrectionFix[] = []
  const imports = parseImports(content)

  for (const im of imports) {
    if (!im.isLocal && !im.source.startsWith('@/')) continue
    const resolved = resolveLocalImport(rootDir, fromAbs, im.source)
    if (resolved) continue

    const corrected = findClosestLocalFile(rootDir, fromAbs, im.source)
    if (corrected && corrected !== im.source) {
      const re = new RegExp(
        `(from\\s*|require\\s*\\(\\s*)(['"])${escapeReg(im.source)}\\2`,
        'g'
      )
      next = next.replace(re, `$1$2${corrected}$2`)
      fixes.push({
        kind: 'local_import_path',
        message: `ייבוא מקומי: ${im.source} → ${corrected}`,
        from: im.source,
        to: corrected
      })
      continue
    }

    const mark = `/* nf-blaze: missing import ${im.source} */`
    if (!next.includes(mark)) {
      const re = new RegExp(
        `((?:import|export)[^;\\n]*from\\s*['"]${escapeReg(im.source)}['"][^;\\n]*;?)`,
        'm'
      )
      if (re.test(next)) {
        next = next.replace(re, `${mark}\n$1`)
        fixes.push({
          kind: 'local_import_marked',
          message: `ייבוא מקומי חסר סומן: ${im.source}`,
          from: im.source
        })
      }
    }
  }

  return { content: next, fixes }
}

/** Phase A entry — package exports + local paths */
export function runPhaseA(
  rootDir: string,
  fileRelPath: string,
  content: string
): PhaseAResult {
  if (!isCodeFile(fileRelPath)) {
    return { content, fixes: [] }
  }
  const a = fixPackageNamedImports(rootDir, content)
  const b = fixLocalImports(rootDir, fileRelPath, a.content)
  return { content: b.content, fixes: [...a.fixes, ...b.fixes] }
}

function isCodeFile(rel: string): boolean {
  const lower = rel.toLowerCase()
  return CODE_EXTS.some((e) => lower.endsWith(e))
}
