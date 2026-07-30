/**
 * Phase B — AST-oriented fixes after file content is complete (post-stream).
 * Uses @babel/* from the *user* project when available; regex fallback otherwise.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'fs'
import { createRequire } from 'module'
import { dirname, join, relative, resolve, sep } from 'path'
import { parseImports } from '../tools/validate_write'
import type { CorrectionFix } from './phase_a'

export type PhaseBResult = {
  /** Updated file contents (project-relative → content) */
  files: Map<string, string>
  fixes: CorrectionFix[]
}

type BabelBundle = {
  parse: (code: string, opts: Record<string, unknown>) => unknown
  traverse: (ast: unknown, visitors: Record<string, unknown>) => void
  generate: (ast: unknown) => { code: string }
  t: {
    isJSXAttribute: (n: unknown) => boolean
    isJSXIdentifier: (n: unknown, opts?: { name?: string }) => boolean
    jsxIdentifier: (name: string) => unknown
    isStringLiteral: (n: unknown) => boolean
    objectExpression: (props: unknown[]) => unknown
    objectProperty: (k: unknown, v: unknown) => unknown
    identifier: (name: string) => unknown
    stringLiteral: (value: string) => unknown
    isIdentifier: (n: unknown, opts?: { name?: string }) => boolean
  }
}

function loadBabel(rootDir: string): BabelBundle | null {
  try {
    const req = createRequire(join(rootDir, 'package.json'))
    const parser = req('@babel/parser') as {
      parse: BabelBundle['parse']
    }
    const traverseMod = req('@babel/traverse') as {
      default?: BabelBundle['traverse']
    } & BabelBundle['traverse']
    const generateMod = req('@babel/generator') as {
      default?: BabelBundle['generate']
    } & BabelBundle['generate']
    const t = req('@babel/types') as BabelBundle['t']
    const traverse = (traverseMod.default || traverseMod) as BabelBundle['traverse']
    const generate = (generateMod.default || generateMod) as BabelBundle['generate']
    return { parse: parser.parse, traverse, generate, t }
  } catch {
    return null
  }
}

function toPosix(rootDir: string, abs: string): string {
  return relative(rootDir, abs).split(sep).join('/')
}

function readRel(rootDir: string, rel: string): string | null {
  const abs = resolve(rootDir, rel.replace(/\//g, sep))
  if (!existsSync(abs)) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

function writeRel(rootDir: string, rel: string, content: string): void {
  const abs = resolve(rootDir, rel.replace(/\//g, sep))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** Common JSX / TS mistakes — regex path (always available) */
export function fixCommonJsxTs(content: string): {
  content: string
  fixes: CorrectionFix[]
} {
  let next = content
  const fixes: CorrectionFix[] = []

  const classRe = /(?<=<\w[^>]*\s)class=/g
  if (classRe.test(next)) {
    next = next.replace(/(?<=<\w[^>]*\s)class=/g, 'className=')
    fixes.push({
      kind: 'jsx_common',
      message: 'class= → className=',
      from: 'class=',
      to: 'className='
    })
  }

  const forRe = /(?<=<\w[^>]*\s)for=/g
  if (forRe.test(next)) {
    next = next.replace(/(?<=<\w[^>]*\s)for=/g, 'htmlFor=')
    fixes.push({
      kind: 'jsx_common',
      message: 'for= → htmlFor=',
      from: 'for=',
      to: 'htmlFor='
    })
  }

  // style="color: red" → style={{ color: 'red' }} (simple single declarations)
  next = next.replace(
    /\bstyle\s*=\s*"([^"]+)"/g,
    (_m, css: string) => {
      fixes.push({
        kind: 'jsx_common',
        message: 'style string → style object',
        from: `style="${css}"`
      })
      const props = css
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const [k, ...rest] = pair.split(':')
          if (!k || !rest.length) return null
          const key = k
            .trim()
            .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
          const val = rest.join(':').trim()
          const num = Number(val)
          if (val !== '' && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(val)) {
            return `${key}: ${val}`
          }
          return `${key}: '${val.replace(/'/g, "\\'")}'`
        })
        .filter(Boolean)
        .join(', ')
      return `style={{ ${props} }}`
    }
  )

  // React import when JSX present but no react import (classic TS error with old jsx setting)
  if (
    /<[A-Za-z]/.test(next) &&
    !/\bfrom\s*['"]react['"]/.test(next) &&
    !/\bimport\s+React\b/.test(next) &&
    /\bReact\./.test(next)
  ) {
    next = `import React from 'react'\n${next}`
    fixes.push({
      kind: 'ast_common',
      message: 'הוסף import React',
      to: "import React from 'react'"
    })
  }

  // Fix `= >` typos in arrows
  if (/= >/.test(next)) {
    next = next.replace(/= >/g, '=>')
    fixes.push({
      kind: 'ast_common',
      message: '= > → =>',
      from: '= >',
      to: '=>'
    })
  }

  return { content: next, fixes }
}

/** AST pass via babel when the user project has it installed */
export function fixWithBabelAst(
  rootDir: string,
  content: string,
  fileRel: string
): { content: string; fixes: CorrectionFix[] } {
  const babel = loadBabel(rootDir)
  if (!babel) return { content, fixes: [] }

  const fixes: CorrectionFix[] = []
  const isTsx = /\.tsx$/i.test(fileRel) || /\.jsx$/i.test(fileRel)
  const isTs = /\.tsx?$/i.test(fileRel)

  let ast: unknown
  try {
    ast = babel.parse(content, {
      sourceType: 'module',
      plugins: [
        isTs ? 'typescript' : null,
        isTsx || isTs ? 'jsx' : null
      ].filter(Boolean)
    })
  } catch {
    return { content, fixes: [] }
  }

  const { t } = babel
  babel.traverse(ast, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    JSXAttribute(path: any) {
      const nameNode = path.node.name
      if (!t.isJSXIdentifier(nameNode)) return
      if (nameNode.name === 'class') {
        nameNode.name = 'className'
        fixes.push({
          kind: 'ast_common',
          message: 'AST: class → className'
        })
      } else if (nameNode.name === 'for') {
        nameNode.name = 'htmlFor'
        fixes.push({
          kind: 'ast_common',
          message: 'AST: for → htmlFor'
        })
      }
    }
  })

  if (!fixes.length) return { content, fixes: [] }
  try {
    const out = babel.generate(ast)
    return { content: out.code, fixes }
  } catch {
    return { content, fixes: [] }
  }
}

const HOOK_PROVIDER_RULES: Array<{
  hook: string
  provider: string
  importFrom: string
  extraImports?: string
  wrapOpen: string
  wrapClose: string
}> = [
  {
    hook: 'useQuery',
    provider: 'QueryClientProvider',
    importFrom: '@tanstack/react-query',
    extraImports: 'QueryClient',
    wrapOpen: '<QueryClientProvider client={__nfQueryClient}>',
    wrapClose: '</QueryClientProvider>'
  },
  {
    hook: 'useMutation',
    provider: 'QueryClientProvider',
    importFrom: '@tanstack/react-query',
    extraImports: 'QueryClient',
    wrapOpen: '<QueryClientProvider client={__nfQueryClient}>',
    wrapClose: '</QueryClientProvider>'
  },
  {
    hook: 'useTheme',
    provider: 'ThemeProvider',
    importFrom: 'next-themes',
    wrapOpen: '<ThemeProvider attribute="class" defaultTheme="system" enableSystem>',
    wrapClose: '</ThemeProvider>'
  }
]

const COMPONENT_PROVIDER_RULES: Array<{
  component: string
  provider: string
  importFrom: string
  wrapOpen: string
  wrapClose: string
}> = [
  {
    component: 'Tooltip',
    provider: 'TooltipProvider',
    importFrom: '@/components/ui/tooltip',
    wrapOpen: '<TooltipProvider>',
    wrapClose: '</TooltipProvider>'
  },
  {
    component: 'TooltipTrigger',
    provider: 'TooltipProvider',
    importFrom: '@/components/ui/tooltip',
    wrapOpen: '<TooltipProvider>',
    wrapClose: '</TooltipProvider>'
  }
]

function detectNeededProviders(
  contents: string[]
): Array<{
  provider: string
  importFrom: string
  extraImports?: string
  wrapOpen: string
  wrapClose: string
}> {
  const needed: Array<{
    provider: string
    importFrom: string
    extraImports?: string
    wrapOpen: string
    wrapClose: string
  }> = []
  const seen = new Set<string>()
  const blob = contents.join('\n')

  for (const rule of HOOK_PROVIDER_RULES) {
    if (!new RegExp(`\\b${rule.hook}\\b`).test(blob)) continue
    if (seen.has(rule.provider)) continue
    if (new RegExp(`\\b${rule.provider}\\b`).test(blob)) continue
    seen.add(rule.provider)
    needed.push(rule)
  }
  for (const rule of COMPONENT_PROVIDER_RULES) {
    if (!new RegExp(`\\b${rule.component}\\b`).test(blob)) continue
    if (seen.has(rule.provider)) continue
    if (new RegExp(`\\b${rule.provider}\\b`).test(blob)) continue
    seen.add(rule.provider)
    needed.push(rule)
  }
  return needed
}

function findEntryFiles(rootDir: string): string[] {
  const candidates = [
    'src/main.tsx',
    'src/main.jsx',
    'src/main.ts',
    'src/index.tsx',
    'src/index.jsx',
    'src/App.tsx',
    'src/App.jsx'
  ]
  return candidates.filter((c) => existsSync(resolve(rootDir, c)))
}

/**
 * Wrap app entry with required providers when hooks/components need them.
 */
export function fixHookProviders(
  rootDir: string,
  writtenContents: Map<string, string>
): PhaseBResult {
  const fixes: CorrectionFix[] = []
  const files = new Map<string, string>()
  const allTexts = [
    ...writtenContents.values(),
    ...findEntryFiles(rootDir).map((f) => readRel(rootDir, f) || '')
  ]
  const needed = detectNeededProviders(allTexts)
  if (!needed.length) return { files, fixes }

  const entry =
    findEntryFiles(rootDir).find((f) => /main\.(t|j)sx?$/.test(f)) ||
    findEntryFiles(rootDir)[0]
  if (!entry) return { files, fixes }

  let content = writtenContents.get(entry) ?? readRel(rootDir, entry)
  if (content == null) return { files, fixes }

  for (const rule of needed) {
    if (content.includes(rule.provider) && content.includes(rule.wrapOpen)) {
      continue
    }

    const names = [rule.provider, rule.extraImports].filter(Boolean).join(', ')
    const importLine = `import { ${names} } from '${rule.importFrom}'`
    if (!content.includes(importLine) && !content.includes(`from '${rule.importFrom}'`)) {
      content = `${importLine}\n${content}`
    } else if (
      content.includes(`from '${rule.importFrom}'`) &&
      !content.includes(rule.provider)
    ) {
      content = content.replace(
        new RegExp(
          `(import\\s*\\{)([^}]*)(\\}\\s*from\\s*['"]${rule.importFrom.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
          )}['"])`
        ),
        (_m, a: string, mid: string, c: string) => {
          if (mid.includes(rule.provider)) return `${a}${mid}${c}`
          const extra = rule.extraImports && !mid.includes(rule.extraImports)
            ? `, ${rule.extraImports}`
            : ''
          return `${a}${mid.replace(/\s*$/, '')}, ${rule.provider}${extra}${c}`
        }
      )
    }

    if (
      rule.provider === 'QueryClientProvider' &&
      !content.includes('__nfQueryClient')
    ) {
      content = `const __nfQueryClient = new QueryClient()\n${content}`
    }

    // Wrap <App /> or createRoot(...).render(...)
    if (/<App\s*\/>/.test(content) && !content.includes(rule.wrapOpen)) {
      content = content.replace(
        /<App\s*\/>/,
        `${rule.wrapOpen}<App />${rule.wrapClose}`
      )
      fixes.push({
        kind: 'hook_provider',
        message: `עטיפת ${rule.provider} ב-${entry}`,
        to: rule.provider
      })
    } else if (
      /createRoot\([^)]*\)\.render\(/.test(content) &&
      !content.includes(rule.wrapOpen)
    ) {
      content = content.replace(
        /(createRoot\([^)]*\)\.render\(\s*)([\s\S]*?)(\s*\))/,
        (_m, pre: string, inner: string, close: string) => {
          if (inner.includes(rule.provider)) return `${pre}${inner}${close}`
          return `${pre}${rule.wrapOpen}${inner}${rule.wrapClose}${close}`
        }
      )
      fixes.push({
        kind: 'hook_provider',
        message: `עטיפת ${rule.provider} ב-${entry}`,
        to: rule.provider
      })
    }
  }

  files.set(entry, content)
  return { files, fixes }
}

/** Known packages → default semver range when auto-adding */
const DEFAULT_DEP_RANGES: Record<string, string> = {
  'framer-motion': '^11.0.0',
  '@tanstack/react-query': '^5.0.0',
  'next-themes': '^0.4.0',
  'react-router-dom': '^7.0.0',
  'date-fns': '^4.0.0',
  zod: '^3.23.0',
  'react-hook-form': '^7.0.0',
  recharts: '^2.12.0',
  sonner: '^1.5.0',
  cmdk: '^1.0.0',
  'class-variance-authority': '^0.7.0',
  clsx: '^2.1.0',
  'tailwind-merge': '^2.0.0',
  'lucide-react': '^0.525.0',
  '@radix-ui/react-slot': '^1.0.0',
  '@radix-ui/react-tooltip': '^1.0.0',
  '@radix-ui/react-dialog': '^1.0.0',
  '@radix-ui/react-dropdown-menu': '^1.0.0',
  '@supabase/supabase-js': '^2.0.0'
}

const SKIP_PKG = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime'
])

function packageRootName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  return specifier.split('/')[0]
}

function loadInstalledNames(rootDir: string): Set<string> {
  const names = new Set<string>()
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return names
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    for (const bag of [pkg.dependencies, pkg.devDependencies]) {
      if (!bag) continue
      for (const k of Object.keys(bag)) names.add(k)
    }
  } catch {
    /* ignore */
  }
  return names
}

/**
 * Scan code strings for external imports missing from package.json and add them.
 * Used before write (so validate_write doesn't reject) and again in Phase B.
 */
export function ensureDependenciesListed(
  rootDir: string,
  contents: string[]
): CorrectionFix[] {
  const map = new Map<string, string>()
  for (const c of contents) map.set(`mem:${map.size}`, c)
  const result = fixMissingDependencies(rootDir, map)
  for (const [rel, content] of result.files) {
    writeRel(rootDir, rel, content)
  }
  return result.fixes
}

/**
 * Scan written code for external imports missing from package.json and add them.
 */
export function fixMissingDependencies(
  rootDir: string,
  writtenContents: Map<string, string>
): PhaseBResult {
  const fixes: CorrectionFix[] = []
  const files = new Map<string, string>()
  const installed = loadInstalledNames(rootDir)
  const missing = new Map<string, string>()

  for (const content of writtenContents.values()) {
    for (const im of parseImports(content)) {
      if (im.isLocal || im.source.startsWith('@/') || im.source.startsWith('node:')) {
        continue
      }
      const root = packageRootName(im.source)
      if (SKIP_PKG.has(root) || SKIP_PKG.has(im.source)) continue
      if (installed.has(root)) continue
      if (existsSync(join(rootDir, 'node_modules', ...root.split('/')))) {
        // Present on disk but not listed — still add to package.json
      }
      const range = DEFAULT_DEP_RANGES[root] || '^1.0.0'
      missing.set(root, range)
    }
  }

  if (!missing.size) return { files, fixes }

  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return { files, fixes }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      [k: string]: unknown
    }
    if (!pkg.dependencies) pkg.dependencies = {}
    for (const [name, range] of missing) {
      if (pkg.dependencies[name]) continue
      pkg.dependencies[name] = range
      fixes.push({
        kind: 'missing_dependency',
        message: `נוספה תלות: ${name}@${range}`,
        to: name
      })
    }
    const text = `${JSON.stringify(pkg, null, 2)}\n`
    files.set('package.json', text)
  } catch {
    /* ignore */
  }

  return { files, fixes }
}

/**
 * Run all Phase B corrections for files written in this request.
 * Writes corrected content back to disk (silent — before user-facing preview).
 */
export function runPhaseB(
  rootDir: string,
  writtenPaths: string[]
): PhaseBResult {
  const fixes: CorrectionFix[] = []
  const files = new Map<string, string>()
  const working = new Map<string, string>()

  for (const rel of writtenPaths) {
    const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '')
    const raw = readRel(rootDir, norm)
    if (raw == null) continue
    if (!/\.(tsx?|jsx?|mjs|cjs)$/i.test(norm)) {
      working.set(norm, raw)
      continue
    }

    let content = raw
    const common = fixCommonJsxTs(content)
    content = common.content
    fixes.push(...common.fixes)

    const ast = fixWithBabelAst(rootDir, content, norm)
    // Prefer babel output only when it actually changed attributes; avoid churn/formatting
    if (ast.fixes.length && ast.content !== content) {
      content = ast.content
      fixes.push(...ast.fixes)
    }

    working.set(norm, content)
    if (content !== raw) files.set(norm, content)
  }

  const providers = fixHookProviders(rootDir, working)
  for (const [rel, content] of providers.files) {
    files.set(rel, content)
    working.set(rel, content)
  }
  fixes.push(...providers.fixes)

  const deps = fixMissingDependencies(rootDir, working)
  for (const [rel, content] of deps.files) {
    files.set(rel, content)
  }
  fixes.push(...deps.fixes)

  // Persist
  for (const [rel, content] of files) {
    writeRel(rootDir, rel, content)
  }

  return { files, fixes }
}

export { toPosix }
