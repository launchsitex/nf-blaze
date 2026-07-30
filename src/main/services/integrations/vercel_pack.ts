import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { gzipSync } from 'zlib'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.nf-blaze',
  '.vercel',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  'release'
])

const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/** Never pack env files into the Vercel source tarball */
function isEnvFileName(name: string): boolean {
  return /^\.env(\..+)?$/i.test(name) && !/\.(example|sample)$/i.test(name)
}

export interface FrameworkSettings {
  framework: string | null
  buildCommand?: string
  outputDirectory?: string
  installCommand?: string
  devCommand?: string
}

export interface PackedSource {
  /** gzipped ustar archive */
  tgz: Buffer
  sha: string
  fileCount: number
  framework: FrameworkSettings
}

function walkFiles(root: string, dir: string, out: { rel: string; abs: string; size: number }[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_FILES.has(name)) continue
    if (isEnvFileName(name)) continue
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walkFiles(root, abs, out)
      continue
    }
    if (!st.isFile()) continue
    if (st.size > 45 * 1024 * 1024) continue // Vercel file limit ~50MB
    const rel = relative(root, abs).split(sep).join('/')
    if (!rel || rel.startsWith('..')) continue
    out.push({ rel, abs, size: st.size })
  }
}

/** Detect Vercel framework + build settings from package.json */
export function detectFramework(folderPath: string): FrameworkSettings {
  const pkgPath = join(folderPath, 'package.json')
  if (!existsSync(pkgPath)) {
    // Static HTML site
    return { framework: null }
  }
  let pkg: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch {
    return { framework: null }
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const scripts = pkg.scripts || {}
  const has = (name: string) => Boolean(deps[name])

  if (has('next')) {
    return {
      framework: 'nextjs',
      buildCommand: scripts.build || 'next build',
      installCommand: 'npm install'
    }
  }
  if (has('nuxt') || has('nuxt3')) {
    return {
      framework: 'nuxtjs',
      buildCommand: scripts.build || 'nuxt build',
      installCommand: 'npm install'
    }
  }
  if (has('astro')) {
    return {
      framework: 'astro',
      buildCommand: scripts.build || 'astro build',
      outputDirectory: 'dist',
      installCommand: 'npm install'
    }
  }
  if (has('@remix-run/react') || has('@remix-run/node')) {
    return {
      framework: 'remix',
      buildCommand: scripts.build || 'remix build',
      installCommand: 'npm install'
    }
  }
  if (has('@sveltejs/kit')) {
    return {
      framework: 'sveltekit',
      buildCommand: scripts.build || 'vite build',
      installCommand: 'npm install'
    }
  }
  if (has('svelte') && has('vite')) {
    return {
      framework: 'svelte',
      buildCommand: scripts.build || 'vite build',
      outputDirectory: 'dist',
      installCommand: 'npm install'
    }
  }
  if (has('vite') || has('@vitejs/plugin-react')) {
    return {
      framework: 'vite',
      buildCommand: scripts.build || 'vite build',
      outputDirectory: 'dist',
      installCommand: 'npm install',
      devCommand: scripts.dev || 'vite'
    }
  }
  if (has('react-scripts')) {
    return {
      framework: 'create-react-app',
      buildCommand: scripts.build || 'react-scripts build',
      outputDirectory: 'build',
      installCommand: 'npm install'
    }
  }
  if (has('@angular/core')) {
    return {
      framework: 'angular',
      buildCommand: scripts.build || 'ng build',
      installCommand: 'npm install'
    }
  }
  if (scripts.build) {
    return {
      framework: 'other',
      buildCommand: scripts.build,
      installCommand: 'npm install'
    }
  }
  return { framework: null }
}

function tarHeader(name: string, size: number): Buffer {
  const buf = Buffer.alloc(512, 0)
  const nameBytes = Buffer.from(name, 'utf-8')
  if (nameBytes.length > 100) {
    // ustar prefix + name split is complex; keep paths under 100 via truncation guard upstream
    nameBytes.subarray(0, 100).copy(buf, 0)
  } else {
    nameBytes.copy(buf, 0)
  }
  buf.write('0000644\0', 100, 8, 'utf-8') // mode
  buf.write('0000000\0', 108, 8, 'utf-8') // uid
  buf.write('0000000\0', 116, 8, 'utf-8') // gid
  const sizeOct = size.toString(8).padStart(11, '0') + '\0'
  buf.write(sizeOct, 124, 12, 'utf-8')
  const mtime = Math.floor(Date.now() / 1000)
    .toString(8)
    .padStart(11, '0')
  buf.write(mtime + '\0', 136, 12, 'utf-8')
  buf.write('        ', 148, 8, 'utf-8') // checksum placeholder
  buf.write('0', 156, 1, 'utf-8') // type file
  buf.write('ustar\0', 257, 6, 'utf-8')
  buf.write('00', 263, 2, 'utf-8')
  let sum = 0
  for (let i = 0; i < 512; i++) sum += buf[i]
  const checksum = sum.toString(8).padStart(6, '0') + '\0 '
  buf.write(checksum, 148, 8, 'utf-8')
  return buf
}

/** Pack project files into `.vercel/source.tgz` (excludes node_modules, .git, …) */
export function packProjectSource(folderPath: string): PackedSource {
  const collected: { rel: string; abs: string; size: number }[] = []
  walkFiles(folderPath, folderPath, collected)

  // Prefer shorter paths; skip ultra-long names that break ustar name field
  const files = collected.filter((f) => Buffer.byteLength(f.rel, 'utf-8') <= 100)

  const chunks: Buffer[] = []
  for (const f of files) {
    const data = readFileSync(f.abs)
    chunks.push(tarHeader(f.rel, data.length))
    chunks.push(data)
    const pad = (512 - (data.length % 512)) % 512
    if (pad) chunks.push(Buffer.alloc(pad, 0))
  }
  chunks.push(Buffer.alloc(1024, 0))

  const tgz = gzipSync(Buffer.concat(chunks), { level: 9 })
  const sha = createHash('sha1').update(tgz).digest('hex')
  return {
    tgz,
    sha,
    fileCount: files.length,
    framework: detectFramework(folderPath)
  }
}
