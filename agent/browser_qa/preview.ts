/**
 * Raise a local preview for browser QA (by absolute rootDir).
 * Prefer an injected URL from the host; otherwise spawn `npm run dev`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { createServer } from 'net'
import { join } from 'path'
import { killProcessTree } from '../process_tree'

export type PreviewHandle = {
  url: string
  /** Stop only if we spawned it (not host-provided) */
  stop: () => void
}

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number, attempts: number): void => {
      if (attempts <= 0) {
        reject(new Error('לא נמצא פורט פנוי לבדיקת דפדפן'))
        return
      }
      const srv = createServer()
      srv.unref()
      srv.on('error', () => tryPort(port + 1, attempts - 1))
      srv.listen(port, '127.0.0.1', () => {
        const addr = srv.address()
        const p = typeof addr === 'object' && addr ? addr.port : port
        srv.close(() => resolve(p))
      })
    }
    tryPort(start, 40)
  })
}

function hasVite(rootDir: string): boolean {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return Boolean(deps.vite) || Boolean(pkg.scripts?.dev?.includes('vite'))
  } catch {
    return false
  }
}

async function waitReady(
  child: ChildProcessWithoutNullStreams,
  url: string,
  timeoutMs = 60_000
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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
      () => done(new Error('תצוגה מקדימה לא עלתה בזמן לבדיקת דפדפן')),
      timeoutMs
    )
    const onData = (buf: Buffer): void => {
      const text = buf.toString('utf8')
      if (/Local:\s+https?:\/\//i.test(text) || /ready in/i.test(text) || text.includes(url)) {
        done()
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', (code) => {
      done(new Error(`Vite נסגר מוקדם (קוד ${code ?? '?'})`))
    })
    const poll = setInterval(() => {
      fetch(url)
        .then((r) => {
          if (r.ok || r.status === 404) done()
        })
        .catch(() => undefined)
    }, 700)
  })
}

/**
 * @param getHostUrl optional — reuse Electron live preview when available
 */
export async function ensureQaPreview(
  rootDir: string,
  getHostUrl?: () => Promise<string | null>
): Promise<PreviewHandle> {
  if (getHostUrl) {
    try {
      const url = await getHostUrl()
      if (url) {
        try {
          const res = await fetch(url)
          if (res.ok || res.status === 404) {
            return { url, stop: () => undefined }
          }
        } catch {
          /* fall through to spawn */
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!hasVite(rootDir)) {
    // Static HTML fallback — file URL not ideal for Playwright; try index.html via simple hint
    const indexHtml = join(rootDir, 'index.html')
    if (existsSync(indexHtml)) {
      throw new Error('אין Vite בפרויקט — בדיקת דפדפן דורשת `npm run dev` (Vite) כרגע')
    }
    throw new Error('לא נמצאה תצוגה מקדימה להרצה')
  }

  if (!existsSync(join(rootDir, 'node_modules'))) {
    throw new Error('חסרות תלויות (node_modules) — לא ניתן להרים תצוגה לבדיקה')
  }

  const port = await findFreePort(5293)
  const url = `http://127.0.0.1:${port}`
  const isWin = process.platform === 'win32'
  const child = spawn(
    isWin ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: rootDir,
      env: {
        ...(() => {
          const e: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', BROWSER: 'none' }
          delete e.FORCE_COLOR
          return e
        })()
      },
      shell: isWin,
      windowsHide: true
    }
  ) as ChildProcessWithoutNullStreams

  try {
    await waitReady(child, url)
  } catch (err) {
    // עץ שלם — ב-Windows ה-cmd הוא רק העטיפה, vite הוא הנכד
    killProcessTree(child)
    throw err
  }

  return {
    url,
    stop: () => killProcessTree(child)
  }
}
