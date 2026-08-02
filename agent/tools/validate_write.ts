/**
 * Pre-write validation for edit_file / write_file.
 * Intentional failures so the agent can self-correct.
 */
import { existsSync, readFileSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import { ToolError } from './types'
import { isSecretPath } from './paths'
import {
  getComponentIndex,
  listDirFilenames,
  lookupComponent
} from './component_index'
import { assertDesignSystem } from './design_rules'
import type { ToolSession } from './session'

const BUILTIN_OR_SPECIAL = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime'
])

const NODE_BUILTINS = new Set([
  'fs',
  'path',
  'os',
  'url',
  'util',
  'crypto',
  'http',
  'https',
  'stream',
  'events',
  'buffer',
  'child_process',
  'assert',
  'process',
  'module',
  'worker_threads',
  'zlib',
  'net',
  'tls',
  'dns',
  'querystring',
  'string_decoder',
  'tty',
  'vm',
  'readline'
])

export interface ParsedImport {
  source: string
  /** Local import (./ or ../ or @/ aliased as relative later) */
  isLocal: boolean
  names: string[] // imported binding names (default → 'default')
  /** namespace import */
  namespace?: string
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:(\*\s+as\s+(\w+))|(\w+)|(\{[^}]*\}))?\s*(?:,\s*(?:(\*\s+as\s+(\w+))|(\{[^}]*\})))?\s*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function parseNamedImports(block: string): string[] {
  return block
    .replace(/[{}]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(/\s+as\s+/)
      // use local binding name for JSX matching
      return (parts[1] || parts[0]).replace(/^type\s+/, '').trim()
    })
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
}

export function parseImports(content: string): ParsedImport[] {
  const out: ParsedImport[] = []
  const re = new RegExp(IMPORT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    const source = m[8] || m[9] || m[10]
    if (!source) continue
    const isLocal = source.startsWith('.') || source.startsWith('/')
    const names: string[] = []
    let namespace: string | undefined

    if (m[2]) namespace = m[2]
    if (m[6]) namespace = m[6]
    if (m[3]) names.push(m[3])
    if (m[4]) names.push(...parseNamedImports(m[4]))
    if (m[7]) names.push(...parseNamedImports(m[7]))

    out.push({ source, isLocal, names, namespace })
  }
  return out
}

function loadPackageNames(rootDir: string): Set<string> {
  const names = new Set<string>()
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return names
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    for (const bag of [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies
    ]) {
      if (!bag) continue
      for (const k of Object.keys(bag)) names.add(k)
    }
  } catch {
    /* ignore */
  }
  return names
}

function packageRootName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  return specifier.split('/')[0]
}

function isExternalAllowed(specifier: string, installed: Set<string>): boolean {
  if (specifier.startsWith('node:')) return true
  const root = packageRootName(specifier)
  if (NODE_BUILTINS.has(root)) return true
  if (BUILTIN_OR_SPECIAL.has(root) || BUILTIN_OR_SPECIAL.has(specifier)) {
    // react still should be in package.json ideally — require it if package.json exists
    if (installed.size === 0) return true
    return installed.has(root) || installed.has(specifier)
  }
  return installed.has(root)
}

const RESOLVE_EXTS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx'
]

export function resolveLocalImport(
  rootDir: string,
  fromFileAbs: string,
  specifier: string
): string | null {
  if (specifier.startsWith('@/')) {
    const base = join(rootDir, 'src', specifier.slice(2))
    for (const ext of RESOLVE_EXTS) {
      const candidate = base + ext
      if (existsSync(candidate)) return resolve(candidate)
    }
    return null
  }

  const base = resolve(dirname(fromFileAbs), specifier)
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext
    if (existsSync(candidate)) return resolve(candidate)
  }
  return null
}

function toPosix(rootDir: string, abs: string): string {
  return relative(rootDir, abs).split(sep).join('/')
}

/** JSX usages: <Name prop= ...> or <Name /> */
export function findJsxUsages(
  content: string
): Array<{ name: string; props: string[] }> {
  const out: Array<{ name: string; props: string[] }> = []
  const tagRe = /<([A-Z][A-Za-z0-9]*)(\s[^>]*)?\/?>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(content))) {
    const name = m[1]
    const attrs = m[2] || ''
    const props: string[] = []
    const propRe = /([A-Za-z_][\w]*)\s*=/g
    let pm: RegExpExecArray | null
    while ((pm = propRe.exec(attrs))) {
      const prop = pm[1]
      if (prop === 'key' || prop === 'ref') continue
      props.push(prop)
    }
    // boolean props: <Foo disabled>
    const boolRe = /\s([A-Za-z_][\w]*)(?=\s|\/|$)/g
    let bm: RegExpExecArray | null
    while ((bm = boolRe.exec(attrs))) {
      const prop = bm[1]
      if (prop === 'key' || prop === 'ref') continue
      if (!props.includes(prop)) props.push(prop)
    }
    out.push({ name, props: [...new Set(props)] })
  }
  return out
}

/**
 * Validate content that is about to be written.
 * Throws ToolError on failure (intentional — agent must fix).
 */
// קבצים שהתבנית תלויה בהם — כתיבה שמכווצת אותם דרמטית כמעט תמיד שוברת את הפרויקט
const CRITICAL_FILE_RE = /^(package\.json|index\.html|vite\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?js|postcss\.config\.[cm]?js)$/i

export function assertWritableContent(
  rootDir: string,
  fileRelPath: string,
  content: string,
  session?: ToolSession
): void {
  const fromAbs = resolve(rootDir, fileRelPath.replace(/\//g, sep))

  // 0) הגנות הרסניות — לפני כל בדיקת תוכן
  if (isSecretPath(fileRelPath)) {
    throw new ToolError(
      `אסור לכתוב לקובץ סוד (${fileRelPath}). ערכי סביבה אמיתיים נכתבים על ידי המשתמש; לתבנית השתמש ב-.env.example`,
      'secret_file'
    )
  }
  const baseName = fileRelPath.replace(/\\/g, '/').split('/').pop() || ''
  const existing = existsSync(fromAbs) ? readFileSync(fromAbs, 'utf8') : null
  if (existing !== null && existing.trim().length > 0 && content.trim().length < 10) {
    throw new ToolError(
      `הכתיבה תרוקן קובץ קיים (${fileRelPath}, ${existing.length} תווים). אם באמת צריך לרוקן — כתוב תוכן מינימלי תקין והסבר`,
      'destructive_write'
    )
  }
  if (
    existing !== null &&
    CRITICAL_FILE_RE.test(baseName) &&
    existing.length > 500 &&
    content.length < existing.length * 0.3
  ) {
    throw new ToolError(
      `הכתיבה מכווצת קובץ קריטי (${fileRelPath}) מ-${existing.length} ל-${content.length} תווים — כנראה תוכן חלקי. קרא את הקובץ וכתוב גרסה מלאה, או השתמש ב-edit_file לשינוי נקודתי`,
      'destructive_write'
    )
  }
  // package.json חייב להישאר JSON תקין (tsconfig הוא JSONC — לא נבדק)
  if (baseName === 'package.json') {
    try {
      JSON.parse(content)
    } catch {
      throw new ToolError('package.json חייב להיות JSON תקין', 'invalid_json')
    }
  }

  // 0.5) מערכת עיצוב — רק בפרויקט שמגדיר טוקנים, רק בקבצי קומפוננטה,
  // ולכל היותר פעמיים לקובץ כדי שלא ייווצר מבוי סתום
  assertDesignSystem(rootDir, fileRelPath, content, session)

  const installed = loadPackageNames(rootDir)
  const imports = parseImports(content)

  // 1) External packages
  for (const im of imports) {
    if (im.isLocal) continue
    if (!isExternalAllowed(im.source, installed)) {
      const pkg = packageRootName(im.source)
      throw new ToolError(
        `החבילה ${pkg} לא מותקנת. הרץ התקנה או השתמש בקיים.`,
        'package_not_installed'
      )
    }
  }

  // 2) Local imports — file must exist
  // Skip validation for the file being written itself when creating new paths that import siblings
  // that already exist; missing targets fail.
  const localResolved = new Map<string, string>() // binding → abs file

  for (const im of imports) {
    if (!im.isLocal && !im.source.startsWith('@/')) continue

    const resolved = resolveLocalImport(rootDir, fromAbs, im.source)
    if (!resolved) {
      let listDir = dirname(fromAbs)
      if (im.source.startsWith('@/')) {
        const sub = dirname(im.source.slice(2))
        listDir = join(rootDir, 'src', sub === '.' ? '' : sub)
      } else {
        const targetDir = resolve(dirname(fromAbs), dirname(im.source))
        if (existsSync(targetDir)) listDir = targetDir
      }
      const files = listDirFilenames(listDir)
      const listing = files.length ? files.join(', ') : '(תיקייה ריקה או לא קיימת)'
      throw new ToolError(
        `ייבוא מקומי לא נמצא: "${im.source}". קבצים קיימים בתיקייה: ${listing}`,
        'local_import_missing'
      )
    }

    for (const name of im.names) {
      if (name === 'default') continue
      localResolved.set(name, resolved)
    }
  }

  // 3) Component props vs index signatures
  const index = getComponentIndex(rootDir)
  const usages = findJsxUsages(content)

  for (const usage of usages) {
    // Only validate components imported from the project (local)
    const fromFile = localResolved.get(usage.name)
    if (!fromFile) {
      // Might be declared in the same file being written — skip or check same content
      const sameFile = index.byFile.get(fromAbs)
      const localDecl = sameFile?.find((c) => c.name === usage.name)
      if (!localDecl) {
        // Component not from project import — skip (HTML host components already filtered by Capital name;
        // external lib components like Box from MUI are imported from packages, not local)
        continue
      }
      checkProps(usage.name, usage.props, localDecl)
      continue
    }

    const preferred = toPosix(rootDir, fromFile)
    const sig =
      lookupComponent(index, usage.name, preferred) ||
      // freshly written dependency may not be in index — parse file directly
      lookupComponent(index, usage.name)

    if (!sig) {
      // Imported from local file but not detected as component — skip props check
      continue
    }
    if (!sig.propsKnown) continue
    checkProps(usage.name, usage.props, sig)
  }
}

function checkProps(
  name: string,
  used: string[],
  sig: { props: string[]; signatureText: string }
): void {
  const allowed = new Set(sig.props)
  // Always allow children if not listed
  allowed.add('children')
  allowed.add('className')
  allowed.add('style')

  const unknown = used.filter((p) => !allowed.has(p))
  if (unknown.length) {
    throw new ToolError(
      `Props לא תקינים ל-${name}: ${unknown.join(', ')}. החתימה האמיתית: ${sig.signatureText}`,
      'invalid_component_props'
    )
  }
}
