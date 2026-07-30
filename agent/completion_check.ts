/**
 * Completion gate — blocks the agent from declaring "done" until checks pass.
 * Used only by `/agent/loop.ts` (not a tool).
 *
 * tsc / build run in a dedicated worker_thread so the agent/Electron main
 * thread stays responsive and checks can be cancelled (incl. 90s timeout).
 */
import { Worker } from 'worker_threads'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parseImports, resolveLocalImport } from './tools/validate_write'

/** Hard cap for tsc/build on the *user* project — never hang the UI */
export const PROJECT_CHECK_TIMEOUT_MS = 90_000

export const COMPLETION_CONDITIONS = {
  tsc: 'npx tsc --noEmit עובר',
  build: 'הבנייה עוברת',
  noTodo: 'אין TODO, FIXME, או placeholder בקוד שנכתב בבקשה הזו',
  noDummy: 'אין טקסט דמה מסוג "Lorem ipsum" או "כאן יבוא..."',
  listStates: 'כל רשימה שנוצרה כוללת loading, empty ו-error',
  imports: 'כל import נפתר'
} as const

export const TSC_FIX_ONLY_INSTRUCTION =
  'תקן רק את השגיאות האלה. אל תיגע בשום דבר אחר.'

export const MAX_TSC_FAILED_ATTEMPTS = 3

export interface TscError {
  file: string
  line: number
  column?: number
  code?: string
  message: string
}

export type CompletionCheckResult =
  | { ok: true; warnings?: string[] }
  | {
      ok: false
      missing: string
      detail?: string
      /** Structured tsc errors — never raw compiler dump */
      tscErrors?: TscError[]
    }

export type ProjectCheckStatus = 'checking' | 'passed' | 'failed' | 'timeout' | 'cancelled'

export type ProjectCheckEvent = {
  status: ProjectCheckStatus
  kind: 'tsc' | 'build'
  errorCount?: number
  message?: string
  rootDir?: string
}

type ProjectCheckListener = (ev: ProjectCheckEvent) => void

const checkListeners = new Set<ProjectCheckListener>()
/** Active workers — terminated on cancel / timeout */
const activeWorkers = new Set<Worker>()

export function onProjectCheckEvent(listener: ProjectCheckListener): () => void {
  checkListeners.add(listener)
  return () => {
    checkListeners.delete(listener)
  }
}

function emitProjectCheck(ev: ProjectCheckEvent): void {
  for (const listener of Array.from(checkListeners)) {
    try {
      listener(ev)
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Cancel every in-flight tsc/build worker (e.g. user aborted chat) */
export function cancelAllProjectChecks(): void {
  for (const w of Array.from(activeWorkers)) {
    try {
      w.postMessage({ type: 'cancel' })
    } catch {
      /* ignore */
    }
    try {
      void w.terminate()
    } catch {
      /* ignore */
    }
  }
  activeWorkers.clear()
  emitProjectCheck({
    status: 'cancelled',
    kind: 'tsc',
    message: 'בדיקת הפרויקט בוטלה'
  })
}

function resolveWorkerScript(): string {
  const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'workers', 'project_check_worker.mjs'),
    join(process.cwd(), 'agent', 'workers', 'project_check_worker.mjs'),
    join(here, '..', 'workers', 'project_check_worker.mjs'),
    join(here, '..', '..', 'agent', 'workers', 'project_check_worker.mjs')
  ]
  try {
    if (process.resourcesPath) {
      candidates.unshift(
        join(process.resourcesPath, 'agent-workers', 'project_check_worker.mjs'),
        join(process.resourcesPath, 'agent', 'workers', 'project_check_worker.mjs')
      )
    }
  } catch {
    /* ignore */
  }
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(
    'לא נמצא project_check_worker.mjs — ודא ש-agent/workers נארז עם האפליקציה'
  )
}

type WorkerCmdResult = {
  ok: boolean
  output: string
  timedOut: boolean
  cancelled: boolean
}

/**
 * Run tsc or build inside a dedicated worker (non-blocking for the main thread).
 * Parent enforces timeout by terminating the worker after timeoutMs.
 */
function runInProjectCheckWorker(opts: {
  kind: 'tsc' | 'build'
  rootDir: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<WorkerCmdResult> {
  const rootDir = requireUserProjectRoot(opts.rootDir)
  const timeoutMs = opts.timeoutMs

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let worker: Worker
    try {
      worker = new Worker(resolveWorkerScript(), {
        workerData: { kind: opts.kind }
      })
    } catch (err) {
      rejectPromise(err)
      return
    }

    activeWorkers.add(worker)

    const finish = (result: WorkerCmdResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise(result)
    }

    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      rejectPromise(err)
    }

    const onAbort = (): void => {
      try {
        worker.postMessage({ type: 'cancel' })
      } catch {
        /* ignore */
      }
      void worker.terminate()
      finish({ ok: false, output: '', timedOut: false, cancelled: true })
    }

    const cleanup = (): void => {
      clearTimeout(killTimer)
      activeWorkers.delete(worker)
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
    }

    if (opts.signal?.aborted) {
      void worker.terminate()
      activeWorkers.delete(worker)
      finish({ ok: false, output: '', timedOut: false, cancelled: true })
      return
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    // Hard timeout: cancel worker if it exceeds the limit
    const killTimer = setTimeout(() => {
      try {
        worker.postMessage({ type: 'cancel' })
      } catch {
        /* ignore */
      }
      void worker.terminate().then(() => {
        finish({ ok: false, output: '', timedOut: true, cancelled: false })
      })
    }, timeoutMs + 500)

    worker.on('message', (msg: {
      type?: string
      kind?: string
      ok?: boolean
      output?: string
      timedOut?: boolean
      cancelled?: boolean
      message?: string
    }) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'started') {
        emitProjectCheck({
          status: 'checking',
          kind: opts.kind,
          rootDir,
          message:
            opts.kind === 'tsc'
              ? 'בודק TypeScript בפרויקט המשתמש…'
              : 'מריץ build בפרויקט המשתמש…'
        })
        return
      }
      if (msg.type === 'error') {
        fail(new Error(msg.message || 'שגיאת worker בבדיקת פרויקט'))
        return
      }
      if (msg.type === 'done') {
        finish({
          ok: Boolean(msg.ok),
          output: String(msg.output || ''),
          timedOut: Boolean(msg.timedOut),
          cancelled: Boolean(msg.cancelled)
        })
      }
    })

    worker.on('error', (err) => fail(err))
    worker.on('exit', (code) => {
      if (!settled) {
        finish({
          ok: false,
          output: `worker exited (${code})`,
          timedOut: false,
          cancelled: true
        })
      }
    })

    worker.postMessage({
      type: 'run',
      kind: opts.kind,
      rootDir,
      timeoutMs
    })
  })
}

export function formatCompletionNudge(missing: string): string {
  return `עוד לא סיימת. חסר: ${missing}. תקן רק את זה.`
}

/**
 * Require an absolute path to the *user's* project folder.
 * Never falls back to process.cwd() or the NF-Blaze app root.
 */
export function requireUserProjectRoot(rootDir: string): string {
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new Error(
      'rootDir של פרויקט המשתמש נדרש (נתיב מוחלט) — אין ברירת מחדל של process.cwd()'
    )
  }
  const trimmed = rootDir.trim()
  if (!isAbsolute(trimmed)) {
    throw new Error(
      `rootDir חייב להיות נתיב מוחלט לפרויקט המשתמש (לא יחסי / לא cwd). קיבלתי: ${trimmed}`
    )
  }
  const abs = resolve(trimmed)
  if (!existsSync(abs)) {
    throw new Error(`תיקיית פרויקט המשתמש לא קיימת: ${abs}`)
  }
  return abs
}

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function toProjectRel(rootDir: string, filePath: string): string {
  const root = resolve(rootDir)
  const raw = filePath.trim().replace(/^["']|["']$/g, '')
  if (isAbsolute(raw)) {
    return normalizeRel(relative(root, raw))
  }
  return normalizeRel(raw)
}

/**
 * Parse `tsc --noEmit` output into structured errors.
 * Supports:
 * - file(line,col): error TSxxxx: message
 * - file:line:col - error TSxxxx: message
 */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007?/g

export function parseTscOutput(rawOutput: string, rootDir?: string): TscError[] {
  // npm run build (vite) פולט קודי צבע גם בלי TTY — בלעדיהם regex השורות נכשל
  const output = rawOutput.replace(ANSI_ESCAPES_RE, '')
  const errors: TscError[] = []
  const seen = new Set<string>()

  const patterns: RegExp[] = [
    /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.+)$/,
    /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/,
    /^(.+?):(\d+):(\d+):\s+error\s+(TS\d+):\s*(.+)$/
  ]

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !/error\s+TS\d+:/i.test(trimmed)) continue

    for (const re of patterns) {
      const m = trimmed.match(re)
      if (!m) continue
      const fileRaw = m[1]
      const lineNo = Number(m[2])
      const col = Number(m[3])
      const code = m[4]
      const message = (m[5] || '').trim()
      if (!fileRaw || !Number.isFinite(lineNo) || !message) break

      const file = rootDir ? toProjectRel(rootDir, fileRaw) : normalizeRel(fileRaw)
      const key = `${file}|${lineNo}|${col}|${code}|${message}`
      if (seen.has(key)) break
      seen.add(key)
      errors.push({
        file,
        line: lineNo,
        column: Number.isFinite(col) ? col : undefined,
        code,
        message
      })
      break
    }
  }

  return errors
}

export function groupTscErrorsByFile(errors: TscError[]): Map<string, TscError[]> {
  const map = new Map<string, TscError[]>()
  for (const err of errors) {
    const list = map.get(err.file) ?? []
    list.push(err)
    map.set(err.file, list)
  }
  return map
}

/** Prefer a stable order: path sort, then first group */
export function pickNextTscFile(errors: TscError[]): string | null {
  if (!errors.length) return null
  const byFile = groupTscErrorsByFile(errors)
  const files = Array.from(byFile.keys()).sort()
  return files[0] ?? null
}

export function formatTscErrorLines(errors: TscError[]): string {
  return errors
    .map((e) => {
      const loc = e.column != null ? `${e.line}:${e.column}` : String(e.line)
      const code = e.code ? ` [${e.code}]` : ''
      return `- שורה ${loc}${code}: ${e.message}`
    })
    .join('\n')
}

/**
 * Message for the agent: errors for one file + file content + fix-only instruction.
 * Never includes raw tsc logs.
 */
export function formatTscFileFixMessage(opts: {
  file: string
  errors: TscError[]
  content: string
}): string {
  const { file, errors, content } = opts
  return [
    `שגיאות TypeScript בקובץ ${file}:`,
    formatTscErrorLines(errors),
    '',
    `תוכן הקובץ (${file}):`,
    '```',
    content,
    '```',
    '',
    TSC_FIX_ONLY_INSTRUCTION
  ].join('\n')
}

export function formatTscRegressMessage(): string {
  return [
    'התיקון האחרון הגדיל את מספר השגיאות — שוחזר.',
    'נסה גישה אחרת.',
    TSC_FIX_ONLY_INSTRUCTION
  ].join('\n')
}

/** User-facing summary when giving up after failed attempts */
export function formatTscUnresolvedForUser(errors: TscError[]): string {
  if (!errors.length) {
    return 'בדיקת TypeScript נכשלה ולא ניתן היה לחלץ שגיאות מפורטות.'
  }
  const byFile = groupTscErrorsByFile(errors)
  const blocks: string[] = [
    `לא הצלחתי לתקן את שגיאות TypeScript אחרי ${MAX_TSC_FAILED_ATTEMPTS} ניסיונות.`,
    `נשארו ${errors.length} שגיאות:`
  ]
  for (const file of Array.from(byFile.keys()).sort()) {
    blocks.push('', `## ${file}`, formatTscErrorLines(byFile.get(file) ?? []))
  }
  return blocks.join('\n')
}

export function readProjectFile(rootDir: string, relPath: string): string | null {
  const abs = resolve(rootDir, normalizeRel(relPath))
  if (!existsSync(abs)) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/** Snapshot current file content (empty string = file did not exist) */
export function snapshotProjectFile(
  rootDir: string,
  relPath: string,
  snapshots: Map<string, string>
): void {
  const key = normalizeRel(relPath)
  if (snapshots.has(key)) return
  const abs = resolve(rootDir, key)
  if (!existsSync(abs)) {
    snapshots.set(key, '')
    return
  }
  snapshots.set(key, readFileSync(abs, 'utf8'))
}

export function restoreFileSnapshots(
  rootDir: string,
  snapshots: Map<string, string>
): void {
  for (const [rel, content] of Array.from(snapshots.entries())) {
    const abs = resolve(rootDir, normalizeRel(rel))
    if (content === '') {
      if (existsSync(abs)) {
        try {
          unlinkSync(abs)
        } catch {
          // ignore
        }
      }
      continue
    }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
}

function readWritten(
  rootDir: string,
  writtenPaths: string[]
): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  for (const rel of writtenPaths) {
    const key = normalizeRel(rel)
    const abs = resolve(rootDir, key)
    if (!existsSync(abs)) continue
    try {
      out.push({ path: key, content: readFileSync(abs, 'utf8') })
    } catch {
      // skip unreadable
    }
  }
  return out
}

function hasTodoFixmePlaceholder(content: string): boolean {
  if (/\bTODO\b|\bFIXME\b/.test(content)) return true
  const withoutAttrs = content.replace(/\bplaceholder\s*=/gi, 'attr_ph=')
  return /\bplaceholder\b/i.test(withoutAttrs)
}

function hasDummyText(content: string): boolean {
  return /Lorem\s+ipsum/i.test(content) || /כאן יבוא/.test(content)
}

function looksLikeListUi(content: string): boolean {
  return /\.map\s*\(/.test(content)
}

function hasListStates(content: string): boolean {
  const loading =
    /\b(loading|isLoading|is_loading)\b/i.test(content) || /טוען/.test(content)
  const empty =
    /\b(empty|isEmpty|is_empty|noItems|no_items)\b/i.test(content) ||
    /ריק|אין\s+(פריטים|תוצאות|נתונים)/.test(content)
  const error =
    /\b(error|isError|is_error|ErrorState)\b/i.test(content) || /שגיאה/.test(content)
  return loading && empty && error
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
    }
    for (const block of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
      if (!block) continue
      for (const name of Object.keys(block)) names.add(name)
    }
  } catch {
    // ignore
  }
  return names
}

function packageRootName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  return specifier.split('/')[0] || specifier
}

function isNodeBuiltin(name: string): boolean {
  const base = name.startsWith('node:') ? name.slice(5) : name
  return [
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
  ].includes(base)
}

function checkImports(
  rootDir: string,
  files: Array<{ path: string; content: string }>
): string | null {
  const installed = loadPackageNames(rootDir)
  for (const file of files) {
    if (!CODE_EXT.test(file.path)) continue
    const fromAbs = resolve(rootDir, file.path)
    const imports = parseImports(file.content)
    for (const im of imports) {
      if (im.isLocal || im.source.startsWith('@/')) {
        const resolved = resolveLocalImport(rootDir, fromAbs, im.source)
        if (!resolved) {
          return `${file.path} → ${im.source}`
        }
        continue
      }
      if (isNodeBuiltin(im.source)) continue
      const root = packageRootName(im.source)
      if (
        root === 'react' ||
        root === 'react-dom' ||
        im.source.startsWith('react/') ||
        im.source.startsWith('react-dom/')
      ) {
        continue
      }
      if (installed.size > 0 && !installed.has(root)) {
        return `${file.path} → ${root}`
      }
    }
  }
  return null
}

async function runCmd(
  kind: 'tsc' | 'build',
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ ok: boolean; output: string; timedOut: boolean; cancelled: boolean }> {
  return runInProjectCheckWorker({
    kind,
    rootDir: cwd,
    timeoutMs,
    signal
  })
}

function hasTsconfig(rootDir: string): boolean {
  return (
    existsSync(join(rootDir, 'tsconfig.json')) ||
    existsSync(join(rootDir, 'jsconfig.json'))
  )
}

function hasBuildScript(rootDir: string): boolean {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>
    }
    return Boolean(pkg.scripts?.build)
  } catch {
    return false
  }
}

export type TscCheckResult = {
  ok: boolean
  errors: TscError[]
  count: number
  /** Ran under this absolute user-project root */
  rootDir: string
  skipped?: 'no_tsconfig' | 'timeout' | 'cancelled'
  warning?: string
}

export async function runTscCheck(opts: {
  /** Absolute path to the *user* project — required, never cwd */
  rootDir: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<TscCheckResult> {
  const rootDir = requireUserProjectRoot(opts.rootDir)
  const timeoutMs = opts.timeoutMs ?? PROJECT_CHECK_TIMEOUT_MS

  if (!hasTsconfig(rootDir)) {
    return { ok: true, errors: [], count: 0, rootDir, skipped: 'no_tsconfig' }
  }

  emitProjectCheck({
    status: 'checking',
    kind: 'tsc',
    rootDir,
    message: 'בודק TypeScript בפרויקט המשתמש…'
  })

  const tsc = await runCmd('tsc', rootDir, timeoutMs, opts.signal)

  if (tsc.cancelled || opts.signal?.aborted) {
    emitProjectCheck({
      status: 'cancelled',
      kind: 'tsc',
      rootDir,
      message: 'בדיקת tsc בוטלה'
    })
    const err = new Error('בדיקת tsc בוטלה')
    err.name = 'AbortError'
    throw err
  }

  if (tsc.timedOut) {
    const warning = `בדיקת tsc בתיקיית המשתמש חרגה מ-${Math.round(timeoutMs / 1000)} שניות ועצרה — דולגה.`
    emitProjectCheck({
      status: 'timeout',
      kind: 'tsc',
      rootDir,
      message: warning
    })
    return {
      ok: true,
      errors: [],
      count: 0,
      rootDir,
      skipped: 'timeout',
      warning
    }
  }

  if (tsc.ok) {
    emitProjectCheck({
      status: 'passed',
      kind: 'tsc',
      errorCount: 0,
      rootDir,
      message: 'בדיקת TypeScript עברה'
    })
    return { ok: true, errors: [], count: 0, rootDir }
  }

  const errors = parseTscOutput(tsc.output, rootDir)
  emitProjectCheck({
    status: 'failed',
    kind: 'tsc',
    errorCount: errors.length,
    rootDir,
    message:
      errors.length > 0
        ? `TypeScript נכשל · ${errors.length} שגיאות`
        : 'TypeScript נכשל'
  })
  return { ok: false, errors, count: errors.length, rootDir }
}

/**
 * Run completion checks against files written in this request.
 * tsc/build always use the explicit user `rootDir` (never process.cwd()).
 * Heavy checks run in a dedicated worker and emit live status events.
 */
export async function runCompletionCheck(opts: {
  /** Absolute path to the *user* project — required */
  rootDir: string
  writtenPaths: string[]
  /** Command timeouts (ms); default PROJECT_CHECK_TIMEOUT_MS (90s) */
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<CompletionCheckResult> {
  const rootDir = requireUserProjectRoot(opts.rootDir)
  const writtenPaths = opts.writtenPaths.map(normalizeRel).filter(Boolean)
  if (writtenPaths.length === 0) {
    return { ok: true }
  }

  const files = readWritten(rootDir, writtenPaths)
  const timeoutMs = opts.timeoutMs ?? PROJECT_CHECK_TIMEOUT_MS
  const warnings: string[] = []

  for (const f of files) {
    if (hasTodoFixmePlaceholder(f.content)) {
      return { ok: false, missing: COMPLETION_CONDITIONS.noTodo, detail: f.path }
    }
  }

  for (const f of files) {
    if (hasDummyText(f.content)) {
      return { ok: false, missing: COMPLETION_CONDITIONS.noDummy, detail: f.path }
    }
  }

  for (const f of files) {
    if (looksLikeListUi(f.content) && !hasListStates(f.content)) {
      return { ok: false, missing: COMPLETION_CONDITIONS.listStates, detail: f.path }
    }
  }

  const importFail = checkImports(rootDir, files)
  if (importFail) {
    return { ok: false, missing: COMPLETION_CONDITIONS.imports, detail: importFail }
  }

  const tsc = await runTscCheck({ rootDir, timeoutMs, signal: opts.signal })
  if (tsc.warning) warnings.push(tsc.warning)
  if (!tsc.ok) {
    return {
      ok: false,
      missing: COMPLETION_CONDITIONS.tsc,
      tscErrors: tsc.errors
    }
  }

  if (hasBuildScript(rootDir)) {
    emitProjectCheck({
      status: 'checking',
      kind: 'build',
      rootDir,
      message: 'מריץ build בפרויקט המשתמש…'
    })
    const build = await runCmd('build', rootDir, timeoutMs, opts.signal)
    if (build.cancelled || opts.signal?.aborted) {
      emitProjectCheck({
        status: 'cancelled',
        kind: 'build',
        rootDir,
        message: 'בדיקת build בוטלה'
      })
      const err = new Error('בדיקת build בוטלה')
      err.name = 'AbortError'
      throw err
    } else if (build.timedOut) {
      const warning = `בדיקת build בתיקיית המשתמש חרגה מ-${Math.round(timeoutMs / 1000)} שניות ועצרה — דולגה.`
      warnings.push(warning)
      emitProjectCheck({
        status: 'timeout',
        kind: 'build',
        rootDir,
        message: warning
      })
    } else if (!build.ok) {
      const buildTsc = parseTscOutput(build.output, rootDir)
      emitProjectCheck({
        status: 'failed',
        kind: 'build',
        errorCount: buildTsc.length,
        rootDir,
        message:
          buildTsc.length > 0
            ? `build נכשל · ${buildTsc.length} שגיאות`
            : 'build נכשל'
      })
      if (buildTsc.length) {
        return {
          ok: false,
          missing: COMPLETION_CONDITIONS.build,
          tscErrors: buildTsc
        }
      }
      return {
        ok: false,
        missing: COMPLETION_CONDITIONS.build,
        detail: 'בניית הפרויקט נכשלה (ללא שגיאות TypeScript מפורטות)'
      }
    } else {
      emitProjectCheck({
        status: 'passed',
        kind: 'build',
        errorCount: 0,
        rootDir,
        message: 'בדיקת build עברה'
      })
    }
  }
  // no build script → skip silently

  return warnings.length ? { ok: true, warnings } : { ok: true }
}

/** @internal — helpers exported for focused unit tests if added later */
export const _completionInternals = {
  hasTodoFixmePlaceholder,
  hasDummyText,
  looksLikeListUi,
  hasListStates,
  normalizeRel,
  hasTsconfig,
  hasBuildScript
}
