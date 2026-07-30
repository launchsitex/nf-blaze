/**
 * Resolve Node/npm for project commands (preview, shell, template install).
 * Prefers a bundled runtime under resources/runtime when present;
 * otherwise uses the system PATH.
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, join } from 'path'
import { app } from 'electron'

/** Vite 6 / modern templates need Node 18+ */
export const MIN_NODE_MAJOR = 18
export const MIN_NODE_MINOR = 0
export const NODE_DOWNLOAD_URL = 'https://nodejs.org/he/download'

export type RuntimeSource = 'bundled' | 'system' | 'missing'

export type RuntimeToolInfo = {
  available: boolean
  version: string | null
  path: string | null
}

export type RuntimeEnvStatus = {
  ok: boolean
  source: RuntimeSource
  node: RuntimeToolInfo
  npm: RuntimeToolInfo
  /** Absolute dir of bundled runtime, when used */
  bundledDir: string | null
  minNode: string
  downloadUrl: string
  checkedAt: string
  /** Short Hebrew summary for UI */
  messageHe: string
  /** Two-sentence install hint when not ok */
  instructionHe: string
}

type ResolvedRuntime = {
  source: RuntimeSource
  bundledDir: string | null
  nodePath: string | null
  npmPath: string | null
  /** PATH prefix so child processes find the same node/npm */
  pathPrefix: string | null
}

let cachedStatus: RuntimeEnvStatus | null = null
let cachedResolved: ResolvedRuntime | null = null

function nodeBinaryName(): string {
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

function npmBinaryName(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** Candidate dirs for a packaged Node distribution (node + npm side by side). */
export function bundledRuntimeCandidates(): string[] {
  const list: string[] = []
  try {
    if (app.isPackaged) {
      list.push(join(process.resourcesPath, 'runtime'))
    }
  } catch {
    /* app may be unavailable in tests */
  }
  // Dev / unpackaged: repo resources/runtime
  list.push(join(process.cwd(), 'resources', 'runtime'))
  try {
    list.push(join(app.getAppPath(), 'resources', 'runtime'))
  } catch {
    /* ignore */
  }
  return list
}

export function findBundledRuntimeDir(): string | null {
  for (const dir of bundledRuntimeCandidates()) {
    const nodePath = join(dir, nodeBinaryName())
    if (existsSync(nodePath)) return dir
  }
  return null
}

function resolveRuntimePaths(): ResolvedRuntime {
  const bundledDir = findBundledRuntimeDir()
  if (bundledDir) {
    const nodePath = join(bundledDir, nodeBinaryName())
    const npmPath = join(bundledDir, npmBinaryName())
    return {
      source: 'bundled',
      bundledDir,
      nodePath: existsSync(nodePath) ? nodePath : null,
      npmPath: existsSync(npmPath) ? npmPath : null,
      pathPrefix: bundledDir
    }
  }
  return {
    source: 'system',
    bundledDir: null,
    nodePath: null,
    npmPath: null,
    pathPrefix: null
  }
}

function runCapture(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 8000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const useShell = isWin && /\.cmd$/i.test(command)
    let settled = false
    const finish = (code: number | null, stdout: string, stderr: string): void => {
      if (settled) return
      settled = true
      resolve({ code, stdout, stderr })
    }

    let child
    try {
      // עם shell, נתיב עם רווחים (Program Files) חייב ציטוט ידני
      const cmd = useShell && /\s/.test(command) ? `"${command}"` : command
      child = spawn(cmd, args, {
        env,
        shell: useShell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      finish(1, '', err instanceof Error ? err.message : String(err))
      return
    }

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish(1, stdout, stderr || 'timeout')
    }, timeoutMs)

    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf-8')
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf-8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish(1, stdout, err.message)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code, stdout, stderr)
    })
  })
}

function parseNodeVersion(raw: string): { major: number; minor: number; patch: number } | null {
  const m = raw.trim().match(/v?(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

function versionMeetsMin(v: { major: number; minor: number; patch: number }): boolean {
  if (v.major > MIN_NODE_MAJOR) return true
  if (v.major < MIN_NODE_MAJOR) return false
  return v.minor >= MIN_NODE_MINOR
}

function buildProbeEnv(resolved: ResolvedRuntime): NodeJS.ProcessEnv {
  // NO_COLOR מכבה צבעי ANSI בכל הספריות; FORCE_COLOR אסור שיהיה מוגדר —
  // picocolors (של Vite) בודק רק אם המשתנה קיים ומדליק צבעים גם על '0'
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  delete env.FORCE_COLOR
  if (resolved.pathPrefix) {
    env.PATH = `${resolved.pathPrefix}${delimiter}${env.PATH || ''}`
    if (process.platform === 'win32') {
      env.Path = env.PATH
    }
  }
  return env
}

/**
 * Env for spawning npm/node project commands — bundled Node wins over system PATH.
 */
export function getRuntimeSpawnEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const resolved = cachedResolved ?? resolveRuntimePaths()
  cachedResolved = resolved
  const base = buildProbeEnv(resolved)
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...extra,
    NO_COLOR: extra.NO_COLOR ?? '1',
    NO_UPDATE_NOTIFIER: '1',
    BROWSER: extra.BROWSER ?? 'none'
  }
  if (!('FORCE_COLOR' in extra)) delete env.FORCE_COLOR
  return env
}

/** Absolute npm binary when known; else platform default name for PATH lookup. */
export function getNpmCommand(): string {
  const resolved = cachedResolved ?? resolveRuntimePaths()
  cachedResolved = resolved
  if (resolved.npmPath && existsSync(resolved.npmPath)) return resolved.npmPath
  return npmBinaryName()
}

export function getNodeCommand(): string {
  const resolved = cachedResolved ?? resolveRuntimePaths()
  cachedResolved = resolved
  if (resolved.nodePath && existsSync(resolved.nodePath)) return resolved.nodePath
  return nodeBinaryName()
}

function hebrewStatus(input: {
  ok: boolean
  source: RuntimeSource
  nodeVer: string | null
  npmVer: string | null
  nodeOk: boolean
  npmOk: boolean
  tooOld: boolean
}): { messageHe: string; instructionHe: string } {
  if (input.ok) {
    const src =
      input.source === 'bundled' ? 'Node המצורף לאפליקציה' : 'Node המותקן במחשב'
    return {
      messageHe: `הסביבה מוכנה · ${src} · Node ${input.nodeVer} · npm ${input.npmVer}`,
      instructionHe: ''
    }
  }
  if (!input.nodeOk && !input.npmOk) {
    return {
      messageHe: 'Node.js ו-npm לא נמצאו במחשב',
      instructionHe:
        'הורידו והתקינו Node.js LTS מהקישור למטה (כולל npm). אחרי ההתקנה לחצו «בדיקה מחדש» או הפעילו מחדש את NF-Blaze.'
    }
  }
  if (!input.nodeOk) {
    return {
      messageHe: 'Node.js לא נמצא במחשב',
      instructionHe:
        'הורידו Node.js LTS מהקישור למטה והתקינו אותו. אחרי ההתקנה לחצו «בדיקה מחדש».'
    }
  }
  if (!input.npmOk) {
    return {
      messageHe: 'npm לא נמצא (לרוב מגיע עם Node.js)',
      instructionHe:
        'התקינו מחדש את Node.js LTS מהקישור למטה כך ש-npm ייכלל. אחר כך לחצו «בדיקה מחדש».'
    }
  }
  if (input.tooOld) {
    return {
      messageHe: `גרסת Node ישנה מדי (${input.nodeVer}) — נדרש ${MIN_NODE_MAJOR}+`,
      instructionHe:
        'הורידו גרסת LTS עדכנית מהקישור למטה והתקינו אותה מעל הגרסה הישנה. אחר כך לחצו «בדיקה מחדש».'
    }
  }
  return {
    messageHe: 'סביבת Node לא תקינה',
    instructionHe:
      'התקינו Node.js LTS מהקישור למטה. אחרי ההתקנה לחצו «בדיקה מחדש».'
  }
}

async function probeWith(resolved: ResolvedRuntime): Promise<{
  nodeVersion: string | null
  npmVersion: string | null
  nodeOk: boolean
  npmOk: boolean
  tooOld: boolean
  ok: boolean
}> {
  const env = buildProbeEnv(resolved)
  const nodeCmd =
    resolved.nodePath && existsSync(resolved.nodePath) ? resolved.nodePath : nodeBinaryName()
  const npmCmd =
    resolved.npmPath && existsSync(resolved.npmPath) ? resolved.npmPath : npmBinaryName()

  const [nodeRes, npmRes] = await Promise.all([
    runCapture(nodeCmd, ['-v'], env),
    runCapture(npmCmd, ['-v'], env)
  ])

  const nodeVersion =
    nodeRes.code === 0 ? (nodeRes.stdout || nodeRes.stderr).trim().split(/\s+/)[0] || null : null
  const npmVersion =
    npmRes.code === 0 ? (npmRes.stdout || npmRes.stderr).trim().split(/\s+/)[0] || null : null

  const parsed = nodeVersion ? parseNodeVersion(nodeVersion) : null
  const nodeOk = Boolean(parsed)
  const npmOk = Boolean(npmVersion)
  const tooOld = Boolean(parsed && !versionMeetsMin(parsed))
  return { nodeVersion, npmVersion, nodeOk, npmOk, tooOld, ok: nodeOk && npmOk && !tooOld }
}

const SYSTEM_RUNTIME: ResolvedRuntime = {
  source: 'system',
  bundledDir: null,
  nodePath: null,
  npmPath: null,
  pathPrefix: null
}

export async function probeRuntimeEnv(opts?: { force?: boolean }): Promise<RuntimeEnvStatus> {
  if (cachedStatus && !opts?.force) return cachedStatus

  let resolved = resolveRuntimePaths()
  let probe = await probeWith(resolved)

  // ה-runtime המצורף פגום/חלקי? נופלים ל-Node של המערכת במקום לחסום את המשתמש
  if (!probe.ok && resolved.bundledDir) {
    const systemProbe = await probeWith(SYSTEM_RUNTIME)
    if (systemProbe.ok) {
      resolved = SYSTEM_RUNTIME
      probe = systemProbe
    }
  }
  cachedResolved = resolved

  const { nodeVersion, npmVersion, nodeOk, npmOk, tooOld, ok } = probe

  let source: RuntimeSource = resolved.source
  if (!nodeOk && !resolved.bundledDir) source = 'missing'
  if (!nodeOk && resolved.bundledDir) source = 'missing'

  const { messageHe, instructionHe } = hebrewStatus({
    ok,
    source: ok ? (resolved.bundledDir ? 'bundled' : 'system') : source,
    nodeVer: nodeVersion,
    npmVer: npmVersion,
    nodeOk,
    npmOk,
    tooOld
  })

  const status: RuntimeEnvStatus = {
    ok,
    source: ok ? (resolved.bundledDir ? 'bundled' : 'system') : source === 'bundled' ? 'bundled' : source,
    node: {
      available: nodeOk,
      version: nodeVersion,
      path: resolved.nodePath
    },
    npm: {
      available: npmOk,
      version: npmVersion,
      path: resolved.npmPath
    },
    bundledDir: resolved.bundledDir,
    minNode: `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0`,
    downloadUrl: NODE_DOWNLOAD_URL,
    checkedAt: new Date().toISOString(),
    messageHe,
    instructionHe
  }

  cachedStatus = status
  return status
}

export function clearRuntimeEnvCache(): void {
  cachedStatus = null
  cachedResolved = null
}

/** Assert runtime before long-running install/dev — throws Hebrew error if not ok */
export async function assertRuntimeReady(): Promise<RuntimeEnvStatus> {
  const status = await probeRuntimeEnv()
  if (!status.ok) {
    throw new Error(
      `${status.messageHe}. ${status.instructionHe || `הורידו מ-${status.downloadUrl}`}`
    )
  }
  return status
}
