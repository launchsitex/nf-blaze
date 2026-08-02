/**
 * Live project preview: prefer `npm run dev` (URL from process output),
 * fall back to static `nfblaze://` after a failed/timed-out start.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { getProject } from './storage'
import { buildPreviewUrl } from './preview-protocol'
import { assertRuntimeReady, getNpmCommand, getRuntimeSpawnEnv } from './runtime-env'
import { syncNfSourcePlugin, ensureNfSourceInViteConfig } from './templates'

export type PreviewPhase =
  | 'idle'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'fallback'
  | 'error'
  | 'crashed'

export type PreviewLiveEvent = {
  projectId: string
  phase: PreviewPhase
  message: string
  url?: string | null
  mode?: 'live' | 'fallback' | 'static'
  logLine?: string
  errorText?: string
}

export type EnsureLivePreviewResult = {
  url: string
  reused: boolean
  mode: 'live' | 'fallback'
  message?: string
}

type LivePreviewState = {
  projectId: string
  folderPath: string
  url: string
  mode: 'live' | 'fallback'
  child: ChildProcessWithoutNullStreams | null
  log: string[]
  errorText: string
}

type EnsureOpts = {
  onEvent?: (ev: PreviewLiveEvent) => void
  /** Force kill + restart even if already running */
  forceRestart?: boolean
}

const liveByProject = new Map<string, LivePreviewState>()
const DEV_TIMEOUT_MS = 60_000
const INSTALL_TIMEOUT_MS = 10 * 60_000
const MAX_LOG_LINES = 400

function emit(onEvent: EnsureOpts['onEvent'], ev: PreviewLiveEvent): void {
  try {
    onEvent?.(ev)
  } catch {
    /* ignore UI listener errors */
  }
}

// CSI (צבעים/סמן) + OSC (כותרת חלון) — כלים כמו Vite פולטים אותם גם בלי TTY
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007?/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function appendLog(state: { log: string[] }, line: string): void {
  const parts = stripAnsi(line).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)
  for (const p of parts) {
    state.log.push(p)
  }
  while (state.log.length > MAX_LOG_LINES) state.log.shift()
}

function readPkg(folderPath: string): {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
} | null {
  const pkgPath = join(folderPath, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
  } catch {
    return null
  }
}

/** package.json with a `dev` script → real dev-server preview */
export function projectNeedsDevServer(folderPath: string): boolean {
  const pkg = readPkg(folderPath)
  const dev = pkg?.scripts?.dev?.trim()
  return Boolean(dev)
}

/** Kept for existing IPC / UI callers — now means "has scripts.dev" */
export function isViteProject(projectId: string): boolean {
  const project = getProject(projectId)
  if (!project?.folderPath) return false
  return projectNeedsDevServer(project.folderPath)
}

function killProcessTree(child: ChildProcessWithoutNullStreams | null): void {
  if (!child || child.killed) return
  const pid = child.pid
  try {
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          if (!child.killed) child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 1500)
    }
  } catch {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
}

function extractLocalUrl(rawChunk: string): string | null {
  // בלי ניקוי ANSI קודי הצבע מפצלים את ה-URL והפורט הולך לאיבוד
  // (Vite מדפיס "http://localhost:" ואז ESC[1m ואז "5173")
  const chunk = stripAnsi(rawChunk)
  const local = chunk.match(/Local:\s*(https?:\/\/[^\s]+)/i)
  if (local?.[1]) {
    return local[1].replace(/\/$/, '')
  }
  const network = chunk.match(
    /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/[^\s]*)?/i
  )
  if (network?.[0]) {
    return network[0].replace(/\/$/, '')
  }
  return null
}

function looksLikeCompileError(text: string): boolean {
  return (
    /\[vite\].*error/i.test(text) ||
    /failed to compile/i.test(text) ||
    /internal server error/i.test(text) ||
    /error during build/i.test(text) ||
    /cannot find module/i.test(text) ||
    /Module not found/i.test(text) ||
    /SyntaxError/i.test(text) ||
    /TS\d{4}/.test(text)
  )
}

function hebrewCompileHint(raw: string): string {
  const trimmed = raw.trim().slice(0, 2500)
  if (/cannot find module|Module not found/i.test(trimmed)) {
    return `שגיאת ייבוא / מודול חסר בתצוגה:\n${trimmed}`
  }
  if (/SyntaxError|Unexpected token/i.test(trimmed)) {
    return `שגיאת תחביר בקוד — התצוגה לא מצליחה לקמפל:\n${trimmed}`
  }
  if (/TS\d{4}/.test(trimmed)) {
    return `שגיאת TypeScript בתצוגה:\n${trimmed}`
  }
  return `שגיאה בשרת הפיתוח:\n${trimmed}`
}

function waitHttpOk(url: string, timeoutMs: number, child?: ChildProcessWithoutNullStreams | null): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(
      () => done(new Error('השרת לא הגיב בזמן')),
      timeoutMs
    )
    const poll = setInterval(() => {
      fetch(url)
        .then((r) => {
          if (r.ok || r.status === 404) done()
        })
        .catch(() => undefined)
    }, 500)
    child?.on('exit', (code) => {
      done(new Error(`שרת הפיתוח נסגר לפני שהיה מוכן (קוד ${code ?? '?'})`))
    })
  })
}

function runNpm(
  folderPath: string,
  args: string[],
  timeoutMs: number,
  onChunk?: (text: string, stream: 'stdout' | 'stderr') => void
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32'
    const npmCmd = getNpmCommand()
    const useShell = isWin && /\.cmd$/i.test(npmCmd)
    const child = spawn(npmCmd, args, {
      cwd: folderPath,
      env: getRuntimeSpawnEnv({
        npm_config_fund: 'false',
        npm_config_audit: 'false',
        CI: '1'
      }),
      shell: useShell,
      windowsHide: true
    }) as ChildProcessWithoutNullStreams

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }

    const timer = setTimeout(() => {
      killProcessTree(child)
      reject(new Error(`הפקודה npm ${args.join(' ')} חרגה מזמן ההמתנה`))
    }, timeoutMs)

    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8')
      stdout += text
      onChunk?.(text, 'stdout')
    })
    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8')
      stderr += text
      onChunk?.(text, 'stderr')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code) => finish(code))
  })
}

function findBuildIndexHtml(folderPath: string): string | null {
  const preferred = ['dist/index.html', 'build/index.html', 'out/index.html', 'dist/index.htm']
  for (const rel of preferred) {
    if (existsSync(join(folderPath, rel))) return rel.replace(/\\/g, '/')
  }
  // shallow scan top-level dirs for index.html
  try {
    for (const name of readdirSync(folderPath)) {
      const full = join(folderPath, name)
      if (!statSync(full).isDirectory()) continue
      if (name === 'node_modules' || name.startsWith('.')) continue
      const idx = join(full, 'index.html')
      if (existsSync(idx)) return `${name}/index.html`
    }
  } catch {
    /* ignore */
  }
  return null
}

async function tryStaticBuildFallback(
  projectId: string,
  folderPath: string,
  onEvent?: EnsureOpts['onEvent'],
  priorLog: string[] = []
): Promise<EnsureLivePreviewResult> {
  emit(onEvent, {
    projectId,
    phase: 'fallback',
    message: 'שרת הפיתוח לא עלה — עובר למצב גיבוי (בנייה סטטית, בלי עדכון חי)',
    mode: 'fallback'
  })

  // בפרויקטי Vite חובה base יחסי — נתיבי /assets אבסולוטיים נשברים תחת
  // nfblaze://preview/<projectId>/dist/ (הסגמנט הראשון מתפרש כ-projectId)
  const buildScript = readPkg(folderPath)?.scripts?.build ?? ''
  const buildArgs = /\bvite\b/.test(buildScript)
    ? ['run', 'build', '--', '--base=./']
    : ['run', 'build']
  const buildResult = await runNpm(folderPath, buildArgs, DEV_TIMEOUT_MS, (text) => {
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      emit(onEvent, {
        projectId,
        phase: 'fallback',
        message: 'בונה גרסת גיבוי…',
        mode: 'fallback',
        logLine: line
      })
    }
  })

  if (buildResult.code !== 0) {
    const err = hebrewCompileHint(
      (buildResult.stderr || buildResult.stdout || 'בניית הגיבוי נכשלה').slice(-3000)
    )
    emit(onEvent, {
      projectId,
      phase: 'error',
      message: 'מצב הגיבוי נכשל — לא ניתן להציג תצוגה',
      mode: 'fallback',
      errorText: err
    })
    throw new Error(err)
  }

  const indexRel = findBuildIndexHtml(folderPath)
  if (!indexRel) {
    const err = 'הבנייה הסתיימה אבל לא נמצא index.html בתיקיית הפלט'
    emit(onEvent, {
      projectId,
      phase: 'error',
      message: err,
      mode: 'fallback',
      errorText: err
    })
    throw new Error(err)
  }

  const url = buildPreviewUrl(projectId, indexRel)
  const state: LivePreviewState = {
    projectId,
    folderPath,
    url,
    mode: 'fallback',
    child: null,
    log: [...priorLog],
    errorText: ''
  }
  liveByProject.set(projectId, state)
  emit(onEvent, {
    projectId,
    phase: 'fallback',
    message: 'מצב גיבוי פעיל — תצוגה סטטית בלי עדכון חי (HMR)',
    url,
    mode: 'fallback'
  })
  return {
    url,
    reused: false,
    mode: 'fallback',
    message: 'מצב גיבוי — בלי עדכון חי'
  }
}

function attachChildLogging(
  projectId: string,
  state: LivePreviewState,
  child: ChildProcessWithoutNullStreams,
  onEvent?: EnsureOpts['onEvent']
): void {
  const onData = (buf: Buffer): void => {
    const text = buf.toString('utf-8')
    appendLog(state, text)
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      emit(onEvent, {
        projectId,
        phase: state.mode === 'fallback' ? 'fallback' : 'ready',
        message: state.mode === 'fallback' ? 'מצב גיבוי' : 'מוכן',
        url: state.url,
        mode: state.mode,
        logLine: line
      })
    }
    if (looksLikeCompileError(text)) {
      state.errorText = hebrewCompileHint(text)
      emit(onEvent, {
        projectId,
        phase: 'error',
        message: 'שגיאת קומפילציה בתצוגה',
        url: state.url,
        mode: state.mode,
        errorText: state.errorText,
        logLine: text.trim().slice(0, 500)
      })
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', (code) => {
    const current = liveByProject.get(projectId)
    if (current !== state) return
    liveByProject.delete(projectId)
    const msg = `שרת הפיתוח קרס (קוד ${code ?? '?'})`
    emit(onEvent, {
      projectId,
      phase: 'crashed',
      message: msg,
      url: null,
      mode: 'live',
      errorText: [msg, ...state.log.slice(-30)].join('\n')
    })
  })
}

export async function ensureLivePreview(
  projectId: string,
  opts: EnsureOpts = {}
): Promise<EnsureLivePreviewResult> {
  const { onEvent, forceRestart } = opts

  if (forceRestart) {
    stopLivePreview(projectId)
  }

  const existing = liveByProject.get(projectId)
  if (existing && (!existing.child || !existing.child.killed)) {
    if (existing.mode === 'fallback') {
      return {
        url: existing.url,
        reused: true,
        mode: 'fallback',
        message: 'מצב גיבוי — בלי עדכון חי'
      }
    }
    try {
      const res = await fetch(existing.url)
      if (res.ok || res.status === 404) {
        emit(onEvent, {
          projectId,
          phase: 'ready',
          message: 'מוכן',
          url: existing.url,
          mode: 'live'
        })
        return { url: existing.url, reused: true, mode: 'live' }
      }
    } catch {
      stopLivePreview(projectId)
    }
  }

  const project = getProject(projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')
  const folderPath = project.folderPath

  if (!projectNeedsDevServer(folderPath)) {
    throw new Error('הפרויקט אינו דורש שרת פיתוח — השתמשו בתצוגה הסטטית')
  }

  await assertRuntimeReady()

  // סנכרון ה-plugin של NF-Blaze בפרויקט (בוחר אלמנטים / דיווח שגיאות) לגרסה העדכנית —
  // פרויקטים ישנים קיבלו עותק חד-פעמי ולא היו מקבלים תיקונים בלי זה
  syncNfSourcePlugin(folderPath)
  // פרויקטים שלא נוצרו ב-NF-Blaze (מיובאים / Dyad) — מזריקים את ה-plugin ל-vite.config
  // כדי שבורר האלמנטים יעבוד גם בהם. בלי זה הבחירה בתצוגה «לא עושה כלום».
  ensureNfSourceInViteConfig(folderPath)

  const logBuf: string[] = []

  if (!existsSync(join(folderPath, 'node_modules'))) {
    emit(onEvent, {
      projectId,
      phase: 'installing',
      message: 'מתקין תלויות',
      mode: 'live'
    })
    try {
      const install = await runNpm(folderPath, ['install'], INSTALL_TIMEOUT_MS, (text) => {
        appendLog({ log: logBuf }, text)
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          emit(onEvent, {
            projectId,
            phase: 'installing',
            message: 'מתקין תלויות',
            mode: 'live',
            logLine: line
          })
        }
      })
      if (install.code !== 0) {
        const err = `התקנת התלויות נכשלה:\n${(install.stderr || install.stdout).slice(-2000)}`
        emit(onEvent, {
          projectId,
          phase: 'error',
          message: 'התקנת התלויות נכשלה',
          mode: 'live',
          errorText: err
        })
        throw new Error(err)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emit(onEvent, {
        projectId,
        phase: 'error',
        message: 'התקנת התלויות נכשלה',
        mode: 'live',
        errorText: msg
      })
      throw err instanceof Error ? err : new Error(msg)
    }
  }

  emit(onEvent, {
    projectId,
    phase: 'starting',
    message: 'מרים שרת',
    mode: 'live'
  })

  const isWin = process.platform === 'win32'
  const npmCmd = getNpmCommand()
  const useShell = isWin && /\.cmd$/i.test(npmCmd)
  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: folderPath,
    env: getRuntimeSpawnEnv(),
    shell: useShell,
    windowsHide: true
  }) as ChildProcessWithoutNullStreams

  let detectedUrl: string | null = null
  let startupLog = ''
  let startupActive = true

  const onStartupData = (buf: Buffer): void => {
    if (!startupActive) return
    const text = buf.toString('utf-8')
    startupLog += text
    appendLog({ log: logBuf }, text)
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      emit(onEvent, {
        projectId,
        phase: 'starting',
        message: 'מרים שרת',
        mode: 'live',
        logLine: line
      })
    }
    if (!detectedUrl) {
      // חיפוש על הלוג המצטבר — URL עלול להתפצל בין chunks
      const found = extractLocalUrl(startupLog)
      if (found) detectedUrl = found
    }
  }

  child.stdout.on('data', onStartupData)
  child.stderr.on('data', onStartupData)

  const urlPromise = new Promise<string>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('TIMEOUT'))
      }
    }, DEV_TIMEOUT_MS)

    const pollUrl = setInterval(() => {
      if (settled) {
        clearInterval(pollUrl)
        return
      }
      if (detectedUrl) {
        settled = true
        clearTimeout(timer)
        clearInterval(pollUrl)
        resolve(detectedUrl)
      }
    }, 200)

    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        clearInterval(pollUrl)
        reject(
          new Error(
            `שרת הפיתוח נסגר מוקדם (קוד ${code ?? '?'}):\n${startupLog.slice(-2000)}`
          )
        )
      }
    })
    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        clearInterval(pollUrl)
        reject(err)
      }
    })
  })

  try {
    let url: string
    try {
      url = await urlPromise
    } catch (err) {
      startupActive = false
      killProcessTree(child)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'TIMEOUT' || /נסגר מוקדם|TIMEOUT/i.test(msg)) {
        return tryStaticBuildFallback(projectId, folderPath, onEvent, logBuf)
      }
      emit(onEvent, {
        projectId,
        phase: 'error',
        message: 'שרת הפיתוח נכשל',
        mode: 'live',
        errorText: hebrewCompileHint(msg)
      })
      throw err instanceof Error ? err : new Error(msg)
    }

    try {
      await waitHttpOk(url, 20_000, child)
    } catch {
      startupActive = false
      killProcessTree(child)
      return tryStaticBuildFallback(projectId, folderPath, onEvent, logBuf)
    }

    startupActive = false
    child.stdout.off('data', onStartupData)
    child.stderr.off('data', onStartupData)

    const state: LivePreviewState = {
      projectId,
      folderPath,
      url,
      mode: 'live',
      child,
      log: [...logBuf],
      errorText: ''
    }
    liveByProject.set(projectId, state)
    attachChildLogging(projectId, state, child, onEvent)

    emit(onEvent, {
      projectId,
      phase: 'ready',
      message: 'מוכן',
      url,
      mode: 'live'
    })
    return { url, reused: false, mode: 'live' }
  } catch (err) {
    startupActive = false
    killProcessTree(child)
    throw err
  }
}

export async function restartLivePreview(
  projectId: string,
  opts: EnsureOpts = {}
): Promise<EnsureLivePreviewResult> {
  return ensureLivePreview(projectId, { ...opts, forceRestart: true })
}

export function stopLivePreview(projectId: string): void {
  const state = liveByProject.get(projectId)
  if (!state) return
  liveByProject.delete(projectId)
  killProcessTree(state.child)
}

export function stopAllLivePreviews(): void {
  for (const id of Array.from(liveByProject.keys())) {
    stopLivePreview(id)
  }
}

export function getLivePreviewUrl(projectId: string): string | null {
  return liveByProject.get(projectId)?.url || null
}

export function getLivePreviewStatus(projectId: string): {
  url: string | null
  mode: 'live' | 'fallback' | null
  errorText: string
  log: string[]
} {
  const state = liveByProject.get(projectId)
  if (!state) {
    return { url: null, mode: null, errorText: '', log: [] }
  }
  return {
    url: state.url,
    mode: state.mode,
    errorText: state.errorText,
    log: [...state.log]
  }
}
