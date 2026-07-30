import { Sandbox, CommandExitError } from 'e2b'
import type {
  CreateSessionOptions,
  SandboxCommandResult,
  SandboxFileInput,
  SessionInfo,
  StartPreviewOptions
} from './types'
import { assertAllowlistedCommand, staticServerCommand } from './allowlist'
import { toAbsoluteInWorkdir } from './paths'

const DEFAULT_WORKDIR = '/home/user/project'
const DEFAULT_PREVIEW_PORT = 5173
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/** Minimal surface we need from E2B (also used for tests) */
export interface E2BSandboxHandle {
  sandboxId: string
  files: {
    makeDir: (path: string) => Promise<boolean>
    writeFiles: (
      files: Array<{ path: string; data: string | ArrayBuffer }>
    ) => Promise<unknown>
  }
  commands: {
    run: (
      cmd: string,
      opts?: {
        cwd?: string
        background?: boolean
        timeoutMs?: number
      }
    ) => Promise<{
      exitCode: number
      stdout: string
      stderr: string
      error?: string
    }>
  }
  getHost: (port: number) => string
  kill: () => Promise<void>
}

export type SandboxFactory = (opts: {
  apiKey?: string
  timeoutMs: number
  template?: string
  metadata: Record<string, string>
}) => Promise<E2BSandboxHandle>

const defaultFactory: SandboxFactory = async (opts) => {
  const sandbox = await Sandbox.create({
    apiKey: opts.apiKey,
    timeoutMs: opts.timeoutMs,
    template: opts.template,
    metadata: opts.metadata
  })
  return sandbox as unknown as E2BSandboxHandle
}

function toHttpsUrl(host: string): string {
  if (host.startsWith('http://') || host.startsWith('https://')) return host
  return `https://${host}`
}

function asCommandResult(err: unknown): SandboxCommandResult | null {
  if (err instanceof CommandExitError) {
    return {
      exitCode: err.exitCode,
      stdout: err.stdout,
      stderr: err.stderr,
      error: err.error
    }
  }
  if (
    err &&
    typeof err === 'object' &&
    'exitCode' in err &&
    typeof (err as { exitCode: unknown }).exitCode === 'number'
  ) {
    const e = err as {
      exitCode: number
      stdout?: string
      stderr?: string
      error?: string
    }
    return {
      exitCode: e.exitCode,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      error: e.error
    }
  }
  return null
}

/**
 * Isolated E2B runtime for one user session.
 * Create → write files → npm install / build → live preview URL.
 */
export class SessionRuntime {
  readonly sessionId: string
  readonly sandboxId: string
  readonly workdir: string
  readonly previewPort: number

  private previewUrl: string | null = null
  private destroyed = false

  private constructor(
    sessionId: string,
    private readonly sandbox: E2BSandboxHandle,
    workdir: string,
    previewPort: number
  ) {
    this.sessionId = sessionId
    this.sandboxId = sandbox.sandboxId
    this.workdir = workdir
    this.previewPort = previewPort
  }

  static async create(
    sessionId: string,
    options: CreateSessionOptions = {},
    factory: SandboxFactory = defaultFactory
  ): Promise<SessionRuntime> {
    if (!sessionId?.trim()) {
      throw new Error('sessionId נדרש')
    }

    const workdir = options.workdir?.trim() || DEFAULT_WORKDIR
    const previewPort = options.previewPort ?? DEFAULT_PREVIEW_PORT
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const sandbox = await factory({
      apiKey: options.apiKey,
      timeoutMs,
      template: options.template,
      metadata: {
        sessionId: sessionId.trim(),
        nfBlaze: 'session-runtime'
      }
    })

    await sandbox.files.makeDir(workdir)
    return new SessionRuntime(sessionId.trim(), sandbox, workdir, previewPort)
  }

  info(): SessionInfo {
    this.assertAlive()
    return {
      sessionId: this.sessionId,
      sandboxId: this.sandboxId,
      workdir: this.workdir,
      previewPort: this.previewPort,
      previewUrl: this.previewUrl
    }
  }

  /** Write one or more files into the session workdir */
  async writeFiles(files: SandboxFileInput[]): Promise<void> {
    this.assertAlive()
    if (!files.length) return

    const entries = files.map((f) => ({
      path: toAbsoluteInWorkdir(this.workdir, f.path),
      data: f.content
    }))

    await this.sandbox.files.writeFiles(entries)
  }

  /** Run an allowlisted command in the session workdir */
  async run(command: string, opts?: { timeoutMs?: number }): Promise<SandboxCommandResult> {
    this.assertAlive()
    const cmd = assertAllowlistedCommand(command)
    return this.exec(cmd, { timeoutMs: opts?.timeoutMs ?? 10 * 60 * 1000 })
  }

  async npmInstall(opts?: { timeoutMs?: number }): Promise<SandboxCommandResult> {
    return this.run('npm install', opts)
  }

  async npmBuild(opts?: { timeoutMs?: number }): Promise<SandboxCommandResult> {
    return this.run('npm run build', opts)
  }

  /**
   * Start a preview server in the background and return a public HTTPS URL.
   * Uses `npm run preview` by default; `static` serves the workdir via python http.server.
   */
  async startPreview(options: StartPreviewOptions = {}): Promise<string> {
    this.assertAlive()
    const port = options.port ?? this.previewPort
    const mode = options.command ?? 'npm run preview'

    let startCmd: string
    if (mode === 'static') {
      startCmd = staticServerCommand(port)
    } else {
      assertAllowlistedCommand(mode)
      startCmd = mode
    }

    await this.sandbox.commands.run(startCmd, {
      cwd: this.workdir,
      background: true,
      timeoutMs: 60_000
    })

    // Give the server a short moment to bind the port
    await sleep(800)

    const url = toHttpsUrl(this.sandbox.getHost(port))
    this.previewUrl = url
    return url
  }

  /** Build preview URL for a port without starting a server */
  getPreviewUrl(port?: number): string {
    this.assertAlive()
    return toHttpsUrl(this.sandbox.getHost(port ?? this.previewPort))
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.previewUrl = null
    await this.sandbox.kill()
  }

  private async exec(
    cmd: string,
    opts: { timeoutMs: number; background?: boolean }
  ): Promise<SandboxCommandResult> {
    try {
      const result = await this.sandbox.commands.run(cmd, {
        cwd: this.workdir,
        timeoutMs: opts.timeoutMs,
        background: opts.background
      })
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error
      }
    } catch (err) {
      const mapped = asCommandResult(err)
      if (mapped) return mapped
      throw err
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error(`SessionRuntime כבר נהרס: ${this.sessionId}`)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
