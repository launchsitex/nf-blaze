/**
 * בדיקה דטרמיניסטית של האפליקציה בדפדפן — בלי מודל שפה.
 *
 * נבדק רק מה שאין עליו ויכוח: העמוד נטען (סטטוס < 400), לא נזרקה שגיאת
 * ריצה, והשורש לא נשאר ריק (מסך לבן). שיפוט איכות נשאר לתת-סוכן ה-QA.
 */
import { openBrowserSession } from '../browser_qa/playwright_session'
import { normalizeConsoleError } from './baseline'
import type { HealthReport, RouteHealth } from './types'

export const MAX_PROBE_ROUTES = 6
/** כמה זמן לתת ל-SPA לצייר לפני שנקבע «מסך לבן» */
export const RENDER_TIMEOUT_MS = 3_000
const NAV_TIMEOUT_MS = 15_000

/**
 * מסלולים שאפשר לבדוק אוטומטית: יחסיים, בלי פרמטרים דינמיים.
 * `/` תמיד ראשון.
 */
export function pickRoutes(routes: string[], max = MAX_PROBE_ROUTES): string[] {
  const usable = routes
    .map((r) => r.trim())
    .filter(
      (r) =>
        r.startsWith('/') &&
        !r.startsWith('//') &&
        !r.includes(':') &&
        !r.includes('*') &&
        !r.includes('?') &&
        !r.includes('#')
    )
  return Array.from(new Set(['/', ...usable])).slice(0, Math.max(1, max))
}

/** מסך לבן: יש שורש אפליקציה והוא נשאר ריק */
const EMPTY_ROOT_FN = `() => {
  const root = document.querySelector('#root') || document.querySelector('#app')
  if (!root) return true
  return root.children.length > 0 || (root.textContent || '').trim().length > 0
}`

export interface ProbeOptions {
  baseUrl: string
  rootDir: string
  routes: string[]
  signal?: AbortSignal
}

export async function probeHealth(opts: ProbeOptions): Promise<HealthReport> {
  const session = await openBrowserSession({
    baseUrl: opts.baseUrl,
    rootDir: opts.rootDir,
    // רץ ברקע — לא קופץ חלון דפדפן למשתמש
    headed: false
  })

  const routes: RouteHealth[] = []
  const consoleErrors: string[] = []

  try {
    for (const route of opts.routes) {
      if (opts.signal?.aborted) break

      const before = session.consoleErrors.length
      const url = `${session.baseUrl}${route === '/' ? '/' : route}`
      let ok = true
      let reason: string | undefined

      try {
        const response = await session.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT_MS
        })
        const status = response?.status()
        if (typeof status === 'number' && status >= 400) {
          ok = false
          reason = `העמוד החזיר שגיאה ${status}`
        }
      } catch (err) {
        ok = false
        reason =
          err instanceof Error && /timeout/i.test(err.message)
            ? 'העמוד לא סיים להיטען'
            : 'העמוד לא נטען'
      }

      if (ok) {
        try {
          await session.page.waitForFunction(EMPTY_ROOT_FN, undefined, {
            timeout: RENDER_TIMEOUT_MS
          })
        } catch {
          ok = false
          reason = 'העמוד נשאר ריק (מסך לבן)'
        }
      }

      const fresh = session.consoleErrors.slice(before)
      if (ok && fresh.length > 0) {
        ok = false
        reason = `שגיאת ריצה: ${fresh[0]!.slice(0, 120)}`
      }
      for (const err of fresh) {
        const sig = normalizeConsoleError(err)
        if (sig && !consoleErrors.includes(sig)) consoleErrors.push(sig)
      }

      routes.push({ route, ok, ...(reason ? { reason } : {}) })
    }
  } finally {
    await session.close()
  }

  return {
    createdAt: new Date().toISOString(),
    routes,
    consoleErrors
  }
}
