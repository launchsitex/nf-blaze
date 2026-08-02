/**
 * «בסיס ירוק» — שלב א': מזהה שבירה של מה שעבד, ומדווח. בלי החזרה אוטומטית.
 *
 * הרעיון: אחרי כל סבב כתיבה מריצים בדיקה דטרמיניסטית קצרה, ומשווים
 * ל«מצב האחרון הידוע כתקין». נשבר משהו שעבד → המשתמש מקבל התראה
 * ליד כפתור «בטל שינויים» הקיים, ומחליט בעצמו.
 */
import { buildScreenMap } from '../browser_qa/screen_map'
import { ensureQaPreview } from '../browser_qa/preview'
import { buildGraph, impactedFiles, touchesRenderableOutput } from '../repo_map'
import { compareHealth, readBaseline, saveBaselineIfHealthy } from './baseline'
import { pickRoutes, probeHealth } from './probe'
import type { HealthCheckOutcome } from './types'
import type { WorkMode } from '../intent'

export {
  compareHealth,
  formatRegressions,
  isHealthy,
  normalizeConsoleError,
  readBaseline,
  saveBaselineIfHealthy,
  healthFilePath,
  MAX_REPORTED_REGRESSIONS
} from './baseline'
export { pickRoutes, probeHealth, MAX_PROBE_ROUTES } from './probe'
export type { HealthReport, HealthCheckOutcome, Regression, RouteHealth } from './types'

/** רצה רק אחרי בנייה אמיתית שכתבה קבצים */
export function shouldRunHealthCheck(opts: {
  workMode: WorkMode
  writtenPaths: string[]
}): boolean {
  if (opts.workMode !== 'BUILD') return false
  return opts.writtenPaths.some((p) => Boolean(p?.trim()))
}

export interface HealthCheckParams {
  rootDir: string
  writtenPaths: string[]
  /** שימוש חוזר בתצוגה החיה של Electron כשקיימת */
  getPreviewUrl?: () => Promise<string | null>
  signal?: AbortSignal
}

/**
 * כשל תשתיתי (אין Vite / node_modules / Chromium) מסתיים ב-skipped בשקט —
 * בדיקת בריאות לעולם לא מכשילה בקשה ולא מפחידה את המשתמש.
 */
export async function runHealthCheck(params: HealthCheckParams): Promise<HealthCheckOutcome> {
  if (params.signal?.aborted) return { skipped: true, reason: 'בוטל' }

  // ניתוח השפעה: אם שום דבר שיכול להשפיע על התצוגה לא נגע בשינוי
  // (ולא בקבצים שתלויים בו) — אין מה לבדוק בדפדפן.
  try {
    const graph = buildGraph(params.rootDir)
    const impacted = impactedFiles(graph, params.writtenPaths)
    if (impacted.size && !touchesRenderableOutput(impacted)) {
      return { skipped: true, reason: 'השינוי לא נוגע במה שמוצג בדפדפן' }
    }
  } catch {
    /* ניתוח השפעה הוא אופטימיזציה — כישלון בו לא מונע בדיקה */
  }

  let preview: Awaited<ReturnType<typeof ensureQaPreview>>
  try {
    preview = await ensureQaPreview(params.rootDir, params.getPreviewUrl)
  } catch (err) {
    return {
      skipped: true,
      reason: err instanceof Error ? err.message : 'אין תצוגה מקדימה לבדיקה'
    }
  }

  try {
    const screenMap = buildScreenMap(params.rootDir, params.writtenPaths)
    const routes = pickRoutes(screenMap.routes)
    const report = await probeHealth({
      baseUrl: preview.url,
      rootDir: params.rootDir,
      routes,
      signal: params.signal
    })

    const baseline = readBaseline(params.rootDir)
    const regressions = compareHealth(baseline, report)
    const baselineSaved = saveBaselineIfHealthy(params.rootDir, report)

    return {
      skipped: false,
      report,
      regressions,
      baselineSaved,
      firstRun: baseline === null
    }
  } catch (err) {
    return {
      skipped: true,
      reason: err instanceof Error ? err.message : 'בדיקת הבריאות נכשלה'
    }
  } finally {
    preview.stop()
  }
}
