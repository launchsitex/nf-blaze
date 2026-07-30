import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  fileBaseName,
  listSourceFiles,
  readTextSafe,
  relPosix
} from './cache'
import type {
  ExportStyle,
  FileNamingStyle,
  ProjectConventions,
  ProjectIndex,
  StateStyle,
  StylingStyle,
  TypescriptConventions
} from './types'

function classifyFileName(base: string): 'PascalCase' | 'kebab-case' | 'camelCase' | 'other' {
  if (!base || base === 'index' || base.startsWith('use') && base.length > 3) {
    // hooks useX — ignore for component naming stats somewhat; still count camel
  }
  if (/^[A-Z][A-Za-z0-9]*$/.test(base)) return 'PascalCase'
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(base)) return 'kebab-case'
  if (/^[a-z][A-Za-z0-9]*$/.test(base)) return 'camelCase'
  return 'other'
}

function pickMajority<T extends string>(
  scores: Record<string, number>,
  fallback: T
): T {
  let best = fallback
  let bestN = -1
  for (const [k, n] of Object.entries(scores)) {
    if (n > bestN) {
      bestN = n
      best = k as T
    }
  }
  return bestN <= 0 ? fallback : best
}

function readTsconfig(rootDir: string): {
  path?: string
  strict: boolean | null
  noImplicitAny: boolean | null
} {
  const candidates = [
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.web.json',
    'jsconfig.json'
  ]
  for (const name of candidates) {
    const path = join(rootDir, name)
    if (!existsSync(path)) continue
    try {
      const raw = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      // strip trailing commas roughly
      const json = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')) as {
        compilerOptions?: { strict?: boolean; noImplicitAny?: boolean }
      }
      const opts = json.compilerOptions || {}
      return {
        path: name,
        strict: typeof opts.strict === 'boolean' ? opts.strict : null,
        noImplicitAny:
          typeof opts.noImplicitAny === 'boolean'
            ? opts.noImplicitAny
            : typeof opts.strict === 'boolean'
              ? opts.strict
              : null
      }
    } catch {
      return { path: name, strict: null, noImplicitAny: null }
    }
  }
  return { strict: null, noImplicitAny: null }
}

function detectPackageHints(rootDir: string): {
  zustand: boolean
  redux: boolean
  tailwind: boolean
  styled: boolean
} {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return { zustand: false, redux: false, tailwind: false, styled: false }
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    return {
      zustand: Boolean(all.zustand),
      redux: Boolean(all['@reduxjs/toolkit'] || all.redux || all['react-redux']),
      tailwind: Boolean(all.tailwindcss),
      styled: Boolean(all['styled-components'] || all['@emotion/styled'])
    }
  } catch {
    return { zustand: false, redux: false, tailwind: false, styled: false }
  }
}

/** Scan project once and build convention index (no LLM) */
export function scanProjectConventions(rootDir: string): ProjectIndex {
  const files = listSourceFiles(rootDir)
  const pkg = detectPackageHints(rootDir)
  const tsconfig = readTsconfig(rootDir)

  const evidence = {
    namedExports: 0,
    defaultExports: 0,
    pascalFiles: 0,
    kebabFiles: 0,
    camelFiles: 0,
    useState: 0,
    zustand: 0,
    redux: 0,
    context: 0,
    tailwind: 0,
    cssModules: 0,
    styledComponents: 0,
    plainCss: 0,
    tryCatch: 0,
    errorBoundary: 0,
    resultPattern: 0
  }

  let anyCount = 0
  let tsFiles = 0

  if (pkg.zustand) evidence.zustand += 3
  if (pkg.redux) evidence.redux += 3
  if (pkg.tailwind) evidence.tailwind += 5
  if (pkg.styled) evidence.styledComponents += 3

  if (
    existsSync(join(rootDir, 'tailwind.config.js')) ||
    existsSync(join(rootDir, 'tailwind.config.ts')) ||
    existsSync(join(rootDir, 'tailwind.config.cjs'))
  ) {
    evidence.tailwind += 5
  }

  for (const file of files) {
    const rel = relPosix(rootDir, file)
    const base = fileBaseName(file)
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
    const naming = classifyFileName(base)

    if (ext === '.tsx' || ext === '.jsx') {
      // Component-like files dominate naming convention
      if (naming === 'PascalCase') evidence.pascalFiles += 2
      else if (naming === 'kebab-case') evidence.kebabFiles += 2
      else if (naming === 'camelCase') evidence.camelFiles += 1
    } else if (ext === '.ts' || ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      // Utilities / stores: kebab weighs more than camel (camel is common either way)
      if (naming === 'kebab-case') evidence.kebabFiles += 2
      else if (naming === 'PascalCase') evidence.pascalFiles += 1
      else if (naming === 'camelCase') evidence.camelFiles += 1
    }

    if (rel.endsWith('.module.css') || rel.endsWith('.module.scss')) {
      evidence.cssModules += 2
    } else if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') {
      evidence.plainCss++
    }

    const text = readTextSafe(file)
    if (!text) continue

    if (ext === '.ts' || ext === '.tsx') {
      tsFiles++
      const anyMatches = text.match(/:\s*any\b|as\s+any\b|<any>/g)
      if (anyMatches) anyCount += anyMatches.length
    }

    // exports
    if (/\bexport\s+default\b/.test(text)) evidence.defaultExports++
    if (
      /\bexport\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\b/.test(text) ||
      /\bexport\s*\{/.test(text)
    ) {
      evidence.namedExports++
    }

    // state
    if (/\buseState\s*[<(]/.test(text)) evidence.useState++
    if (/\bfrom\s+['"]zustand['"]/.test(text) || /\bcreate\s*\(\s*\(/.test(text) && /zustand/.test(text)) {
      evidence.zustand++
    }
    if (
      /\bfrom\s+['"]react-redux['"]/.test(text) ||
      /\bfrom\s+['"]@reduxjs\/toolkit['"]/.test(text) ||
      /\bcreateSlice\s*\(/.test(text)
    ) {
      evidence.redux++
    }
    if (/\bcreateContext\s*\(/.test(text) || /\buseContext\s*\(/.test(text)) {
      evidence.context++
    }

    // styling in code
    if (
      /\bclassName\s*=\s*['"`][^'"`]*\b(?:flex|grid|text-|bg-|p-|m-|w-|h-|rounded)/.test(text) ||
      /\btw`/.test(text)
    ) {
      evidence.tailwind++
    }
    if (/styles\.\w+|from\s+['"].+\.module\.(css|scss)['"]/.test(text)) {
      evidence.cssModules++
    }
    if (
      /\bstyled\.[a-zA-Z]/.test(text) ||
      /\bfrom\s+['"]styled-components['"]/.test(text) ||
      /\bfrom\s+['"]@emotion\/styled['"]/.test(text)
    ) {
      evidence.styledComponents++
    }

    // errors
    if (/\btry\s*\{/.test(text)) evidence.tryCatch++
    if (/\bErrorBoundary\b|\bcomponentDidCatch\b/.test(text)) evidence.errorBoundary++
    if (/\bok:\s*false\b|\.success\b|Result<|Either<|isErr\b/.test(text)) {
      evidence.resultPattern++
    }
  }

  const exports: ExportStyle = (() => {
    const n = evidence.namedExports
    const d = evidence.defaultExports
    if (n === 0 && d === 0) return 'unknown'
    if (n > d * 1.5) return 'named'
    if (d > n * 1.5) return 'default'
    return 'mixed'
  })()

  const fileNaming: FileNamingStyle = (() => {
    const scores = {
      PascalCase: evidence.pascalFiles,
      'kebab-case': evidence.kebabFiles,
      camelCase: evidence.camelFiles
    }
    const total = scores.PascalCase + scores['kebab-case'] + scores.camelCase
    if (total === 0) return 'unknown'
    const top = pickMajority(scores, 'PascalCase' as FileNamingStyle)
    const topN = scores[top as keyof typeof scores] ?? 0
    if (topN / total < 0.55) return 'mixed'
    return top
  })()

  const stateManagement: StateStyle[] = []
  const stateScores: Array<[StateStyle, number]> = [
    ['useState', evidence.useState],
    ['zustand', evidence.zustand],
    ['redux', evidence.redux],
    ['context', evidence.context]
  ]
  stateScores.sort((a, b) => b[1] - a[1])
  for (const [k, n] of stateScores) {
    if (n > 0) stateManagement.push(k)
  }

  const styling: StylingStyle[] = []
  const styleScores: Array<[StylingStyle, number]> = [
    ['tailwind', evidence.tailwind],
    ['css-modules', evidence.cssModules],
    ['styled-components', evidence.styledComponents],
    ['plain-css', evidence.plainCss]
  ]
  styleScores.sort((a, b) => b[1] - a[1])
  for (const [k, n] of styleScores) {
    if (n > 0) styling.push(k)
  }
  if (!styling.length) styling.push('unknown')

  const errorHandling = (() => {
    const parts: string[] = []
    if (evidence.tryCatch > 0) parts.push(`try/catch (${evidence.tryCatch} files)`)
    if (evidence.errorBoundary > 0) parts.push('React ErrorBoundary')
    if (evidence.resultPattern > 0) parts.push('result/ok pattern')
    if (!parts.length) return 'unknown / not clearly established'
    return parts.join(', ')
  })()

  const typescript: TypescriptConventions = {
    used: tsFiles > 0 || Boolean(tsconfig.path),
    strict: tsconfig.strict,
    anyAllowed:
      tsconfig.noImplicitAny === true
        ? anyCount > Math.max(3, Math.floor(tsFiles * 0.05))
        : tsconfig.noImplicitAny === false
          ? true
          : tsFiles === 0
            ? null
            : anyCount > 0,
    anyCount,
    tsconfigPath: tsconfig.path
  }

  const conventions: ProjectConventions = {
    exports,
    fileNaming,
    stateManagement,
    styling,
    errorHandling,
    typescript
  }

  return {
    rootDir,
    scannedAt: new Date().toISOString(),
    filesSampled: files.length,
    conventions,
    evidence
  }
}
