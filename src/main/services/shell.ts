import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { killProcessTree } from '../../../agent/process_tree'
import { existsSync } from 'fs'
import type { ShellRunRequest, ShellRunResult } from '../../shared/types'
import { getProject } from './storage'
import { assertRuntimeReady, getNpmCommand, getRuntimeSpawnEnv } from './runtime-env'

/** Only package managers — never npx/node (remote/arbitrary code execution) */
const ALLOWED = new Set(['npm', 'pnpm', 'yarn'])

const SHELL_TIMEOUT_MS = 5 * 60 * 1000

/** Dangerous flags that escape project scope or enable arbitrary code */
const BLOCKED_ARG_PATTERNS = [
  /^--prefix$/i,
  /^--cwd$/i,
  /^-C$/i,
  /^\.\./,
  /^\/|^[a-zA-Z]:\\/,
  /^-e$/i,
  /^--eval$/i,
  /^--print$/i,
  /^-p$/i,
  /^--require$/i,
  /^-r$/i,
  /^--node-options=/i,
  /^--scripts-prepend-node-path/i
]

/** Allowed npm-family verbs only */
const SAFE_NPM_SUBCOMMANDS = new Set([
  'install',
  'i',
  'ci',
  'run',
  'build', // yarn/pnpm style
  'test',
  'lint',
  'start',
  'dev'
])

export type ShellLineEmitter = (line: string, stream: 'stdout' | 'stderr') => void

function assertSafePackageManagerArgs(command: string, args: string[]): void {
  if (args.length === 0) {
    throw new Error('חסרים ארגומנטים לפקודה')
  }
  const head = args[0]
  if (command === 'npm') {
    if (!SAFE_NPM_SUBCOMMANDS.has(head) && head !== 'uninstall' && head !== 'update') {
      throw new Error(`תת-פקודת npm לא מורשית: ${head}`)
    }
    if (head === 'run' && args.length < 2) {
      throw new Error('npm run דורש שם סקריפט')
    }
    if (head === 'run') {
      const script = args[1]
      if (!/^[a-zA-Z0-9:_-]+$/.test(script)) {
        throw new Error(`שם סקריפט לא תקין: ${script}`)
      }
    }
    return
  }
  if (!SAFE_NPM_SUBCOMMANDS.has(head) && head !== 'add' && head !== 'remove') {
    throw new Error(`תת-פקודה לא מורשית ל-${command}: ${head}`)
  }
}

/** Prefer bundled Node on PATH; avoid leaking host secrets */
function buildSafeEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'Path',
    'Pathext',
    'PATHEXT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ComSpec',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
    'LANG',
    'LC_ALL',
    'npm_config_cache',
    'NPM_CONFIG_CACHE'
  ]
  const fromRuntime = getRuntimeSpawnEnv()
  const env: NodeJS.ProcessEnv = {
    FORCE_COLOR: '0',
    NO_UPDATE_NOTIFIER: '1',
    PATH: fromRuntime.PATH,
    Path: fromRuntime.Path || fromRuntime.PATH
  }
  for (const key of keep) {
    if (key === 'PATH' || key === 'Path') continue
    if (fromRuntime[key]) env[key] = fromRuntime[key]
    else if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

function resolveCommandBinary(command: string): string {
  if (command === 'npm') return getNpmCommand()
  return process.platform === 'win32' ? `${command}.cmd` : command
}

export async function runAllowlistedShell(
  req: ShellRunRequest,
  onLine?: ShellLineEmitter,
  signal?: AbortSignal
): Promise<ShellRunResult> {
  if (!ALLOWED.has(req.command)) {
    throw new Error(`פקודה לא מורשית: ${req.command}`)
  }

  await assertRuntimeReady()

  const project = getProject(req.projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    throw new Error('תיקיית הפרויקט לא נמצאה')
  }

  for (const arg of req.args) {
    if (BLOCKED_ARG_PATTERNS.some((re) => re.test(arg))) {
      throw new Error(`ארגומנט חסום מסיבות אבטחה: ${arg}`)
    }
  }

  assertSafePackageManagerArgs(req.command, req.args)

  const cmd = resolveCommandBinary(req.command)
  const isWin = process.platform === 'win32'
  const useShell = isWin && /\.cmd$/i.test(cmd)

  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    let settled = false
    const finish = (result: ShellRunResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    try {
      child = spawn(cmd, req.args, {
        cwd: project.folderPath,
        env: buildSafeEnv(),
        shell: useShell,
        windowsHide: true
      })
    } catch (err) {
      finish({
        ok: false,
        code: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err)
      })
      return
    }

    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      // עץ שלם: `shell: true` ב-Windows מייצר cmd → npm → node.
      // הריגת ה-cmd לבדה משאירה את npm רץ ברקע לנצח.
      killProcessTree(child)
      finish({
        ok: false,
        code: 1,
        stdout,
        stderr: stderr + `\n[NF-Blaze] פקודה הופסקה אחרי ${SHELL_TIMEOUT_MS / 1000}s`
      })
    }, SHELL_TIMEOUT_MS)

    const onAbort = (): void => {
      killProcessTree(child)
    }
    signal?.addEventListener('abort', onAbort)

    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8')
      stdout += text
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        onLine?.(line, 'stdout')
      }
    })
    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8')
      stderr += text
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        onLine?.(line, 'stderr')
      }
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      finish({
        ok: code === 0,
        code: code ?? 1,
        stdout,
        stderr
      })
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      finish({
        ok: false,
        code: 1,
        stdout,
        stderr: err.message
      })
    })
  })
}

/** Validate allowlisted command string for UI quick-run */
export function parseSafeNpmScript(script: string): { command: 'npm'; args: string[] } | null {
  const trimmed = script.trim()
  if (trimmed === 'npm install' || trimmed === 'npm i') {
    return { command: 'npm', args: ['install'] }
  }
  if (trimmed === 'npm run build') {
    return { command: 'npm', args: ['run', 'build'] }
  }
  if (trimmed === 'npm run dev') {
    return { command: 'npm', args: ['run', 'dev'] }
  }
  return null
}
