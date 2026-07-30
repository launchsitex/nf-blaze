/**
 * Dedicated worker for user-project tsc / build checks.
 * Never uses process.cwd() — only the absolute rootDir from the parent message.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { spawn } from 'node:child_process'

if (!parentPort) {
  throw new Error('project_check_worker must run as a worker_thread')
}

/** @type {import('node:child_process').ChildProcess | null} */
let child = null
let cancelled = false

function requireAbsoluteRoot(rootDir) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new Error('rootDir נדרש (נתיב מוחלט לפרויקט המשתמש)')
  }
  const abs = resolve(rootDir.trim())
  if (!isAbsolute(abs)) {
    throw new Error(`rootDir חייב להיות מוחלט, קיבלתי: ${rootDir}`)
  }
  if (!existsSync(abs)) {
    throw new Error(`תיקיית פרויקט לא קיימת: ${abs}`)
  }
  return abs
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {number} timeoutMs
 */
function runCmd(command, args, cwd, timeoutMs) {
  return new Promise((resolveResult) => {
    cancelled = false
    const isWin = process.platform === 'win32'
    const cmd = isWin && command === 'npx' ? 'npx.cmd' : isWin && command === 'npm' ? 'npm.cmd' : command

    child = spawn(cmd, args, {
      cwd,
      env: { ...(() => { const e = { ...process.env, NO_COLOR: '1' }; delete e.FORCE_COLOR; return e })() },
      shell: isWin,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = `${stdout}${stderr}`.trim()
      resolveResult({
        ok: Boolean(ok) && !cancelled && !timedOut,
        output,
        timedOut,
        cancelled
      })
      child = null
    }

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child?.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      // Force kill after grace
      setTimeout(() => {
        try {
          child?.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 2000)
    }, timeoutMs)

    child.stdout?.on('data', (buf) => {
      stdout += buf.toString('utf8')
    })
    child.stderr?.on('data', (buf) => {
      stderr += buf.toString('utf8')
    })
    child.on('error', (err) => {
      stderr += err.message || String(err)
      finish(false)
    })
    child.on('close', (code) => {
      if (cancelled) {
        finish(false)
        return
      }
      if (timedOut) {
        finish(false)
        return
      }
      finish(code === 0)
    })
  })
}

function cancelChild() {
  cancelled = true
  try {
    child?.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      child?.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 1500)
}

parentPort.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'cancel') {
    cancelChild()
    return
  }

  if (msg.type !== 'run') return

  const kind = msg.kind === 'build' ? 'build' : 'tsc'
  const timeoutMs = typeof msg.timeoutMs === 'number' ? msg.timeoutMs : 90_000

  try {
    const rootDir = requireAbsoluteRoot(msg.rootDir)
    parentPort.postMessage({ type: 'started', kind, rootDir })

    const result =
      kind === 'tsc'
        ? await runCmd('npx', ['tsc', '--noEmit'], rootDir, timeoutMs)
        : await runCmd('npm', ['run', 'build'], rootDir, timeoutMs)

    parentPort.postMessage({
      type: 'done',
      kind,
      rootDir,
      ok: result.ok,
      output: result.output,
      timedOut: result.timedOut,
      cancelled: result.cancelled
    })
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      kind,
      message: err instanceof Error ? err.message : String(err)
    })
  }
})

// Optional bootstrap from workerData
if (workerData?.autoRun) {
  parentPort.postMessage({ type: 'ready' })
}
