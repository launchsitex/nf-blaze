import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, extname, join, relative } from 'path'

const SKIP = new Set([
  'node_modules',
  '.git',
  '.nf-blaze',
  'dist',
  'build',
  'out',
  'release',
  'coverage',
  '.next'
])

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export interface ComponentSignature {
  /** Exported / declared component name */
  name: string
  /** Project-relative posix path */
  file: string
  /** Declared prop names (empty = no props / unknown) */
  props: string[]
  /** Whether props type was found */
  propsKnown: boolean
  /** Human-readable signature for error messages */
  signatureText: string
}

export interface ComponentIndex {
  rootDir: string
  /** name → signatures (may have duplicates across files) */
  byName: Map<string, ComponentSignature[]>
  /** absolute file → components declared there */
  byFile: Map<string, ComponentSignature[]>
  builtAt: number
}

const cache = new Map<string, ComponentIndex>()

function toPosix(rootDir: string, abs: string): string {
  return relative(rootDir, abs).split('\\').join('/')
}

function listCodeFiles(rootDir: string, max = 500): string[] {
  const out: string[] = []
  function walk(dir: string): void {
    if (out.length >= max) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (out.length >= max) break
      if (SKIP.has(name) || (name.startsWith('.') && name !== '.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (st.isFile() && CODE_EXT.has(extname(name).toLowerCase())) out.push(full)
    }
  }
  walk(rootDir)
  return out
}

function extractPropsFromTypeBody(body: string): string[] {
  const props: string[] = []
  const re = /(?:^|[;{,\n])\s*(?:readonly\s+)?([A-Za-z_][\w]*)\s*(\?)?\s*[?:]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const name = m[1]
    if (name === 'extends' || name === 'type' || name === 'interface') continue
    props.push(name)
  }
  return [...new Set(props)]
}

function findPropsType(
  source: string,
  componentName: string
): { props: string[]; known: boolean; label: string } {
  // interface XProps / type XProps =
  const propsTypeNames = [
    `${componentName}Props`,
    'Props',
    `${componentName}Properties`
  ]

  for (const typeName of propsTypeNames) {
    const iface = source.match(
      new RegExp(`interface\\s+${typeName}\\s*(?:extends\\s+[^{]+)?\\{([\\s\\S]*?)\\}`)
    )
    if (iface) {
      const props = extractPropsFromTypeBody(iface[1])
      return {
        props,
        known: true,
        label: `interface ${typeName} { ${props.join('; ')} }`
      }
    }
    const typ = source.match(
      new RegExp(`type\\s+${typeName}\\s*=\\s*\\{([\\s\\S]*?)\\}`)
    )
    if (typ) {
      const props = extractPropsFromTypeBody(typ[1])
      return {
        props,
        known: true,
        label: `type ${typeName} = { ${props.join('; ')} }`
      }
    }
  }

  // function Comp({ a, b }: SomeProps) or function Comp({ a, b })
  const fn =
    source.match(
      new RegExp(
        `(?:export\\s+)?(?:default\\s+)?function\\s+${componentName}\\s*\\(\\s*\\{\\s*([^}]*)\\}`
      )
    ) ||
    source.match(
      new RegExp(
        `(?:export\\s+)?const\\s+${componentName}\\s*=\\s*(?:async\\s*)?\\(\\s*\\{\\s*([^}]*)\\}`
      )
    )

  if (fn) {
    const raw = fn[1]
    const props = raw
      .split(',')
      .map((p) => p.trim())
      .map((p) => p.replace(/\s*=\s*.*$/, '').replace(/\?.*$/, '').trim())
      .map((p) => p.replace(/^\{\s*|\s*\}$/g, '').trim())
      .filter((p) => /^[A-Za-z_][\w]*$/.test(p))
    if (props.length) {
      return {
        props,
        known: true,
        label: `${componentName}({ ${props.join(', ')} })`
      }
    }
  }

  // React.FC<Props> / FC<Props>
  const fc = source.match(
    new RegExp(
      `${componentName}\\s*[:=]\\s*(?:React\\.)?FC\\s*<\\s*([A-Za-z_][\\w]*)\\s*>`
    )
  )
  if (fc) {
    const typeName = fc[1]
    const iface = source.match(
      new RegExp(`(?:interface|type)\\s+${typeName}\\s*=?\\s*\\{([\\s\\S]*?)\\}`)
    )
    if (iface) {
      const props = extractPropsFromTypeBody(iface[1])
      return {
        props,
        known: true,
        label: `FC<${typeName}> { ${props.join('; ')} }`
      }
    }
  }

  return {
    props: [],
    known: false,
    label: `${componentName}(props: unknown)`
  }
}

function extractComponentsFromFile(
  rootDir: string,
  absFile: string,
  source: string
): ComponentSignature[] {
  const out: ComponentSignature[] = []
  const file = toPosix(rootDir, absFile)

  const declRe =
    /(?:export\s+(?:default\s+)?)?(?:function|const)\s+([A-Z][A-Za-z0-9]*)\s*[=(:]/g
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = declRe.exec(source))) {
    names.add(m[1])
  }
  // export default function Name
  const defFn = source.match(/export\s+default\s+function\s+([A-Z][A-Za-z0-9]*)/)
  if (defFn) names.add(defFn[1])

  for (const name of names) {
    const { props, known, label } = findPropsType(source, name)
    out.push({
      name,
      file,
      props,
      propsKnown: known,
      signatureText: `${name} @ ${file}: ${label}`
    })
  }
  return out
}

/** Build or return cached component prop index for a project */
export function getComponentIndex(rootDir: string, force = false): ComponentIndex {
  const hit = cache.get(rootDir)
  if (hit && !force && Date.now() - hit.builtAt < 60_000) return hit

  const byName = new Map<string, ComponentSignature[]>()
  const byFile = new Map<string, ComponentSignature[]>()

  for (const file of listCodeFiles(rootDir)) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (source.length > 400_000) continue
    const comps = extractComponentsFromFile(rootDir, file, source)
    if (!comps.length) continue
    byFile.set(file, comps)
    for (const c of comps) {
      const list = byName.get(c.name) || []
      list.push(c)
      byName.set(c.name, list)
    }
  }

  const index: ComponentIndex = { rootDir, byName, byFile, builtAt: Date.now() }
  cache.set(rootDir, index)
  return index
}

export function invalidateComponentIndex(rootDir?: string): void {
  if (rootDir) cache.delete(rootDir)
  else cache.clear()
}

export function lookupComponent(
  index: ComponentIndex,
  name: string,
  preferredFile?: string
): ComponentSignature | undefined {
  const list = index.byName.get(name)
  if (!list?.length) return undefined
  if (preferredFile) {
    const hit = list.find((c) => c.file === preferredFile || preferredFile.endsWith(c.file))
    if (hit) return hit
  }
  return list[0]
}

/** List filenames in a directory (for missing-local-import errors) */
export function listDirFilenames(dirAbs: string): string[] {
  if (!existsSync(dirAbs)) return []
  try {
    return readdirSync(dirAbs)
      .filter((n) => {
        try {
          return statSync(join(dirAbs, n)).isFile() || true
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

export { dirname }
