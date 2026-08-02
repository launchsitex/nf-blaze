/**
 * הבסיס הירוק — «המצב האחרון הידוע כתקין» של הפרויקט.
 *
 * נשמר ב-`.nf-blaze/health.json` ומתעדכן **רק** כשהדוח תקין לגמרי,
 * כך שדוח שבור לעולם לא הופך לבסיס להשוואה הבאה.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { HealthReport, Regression } from './types'

/** תקרת ממצאים שמוצגת למשתמש — מעבר לזה זה רעש */
export const MAX_REPORTED_REGRESSIONS = 5

export function healthFilePath(rootDir: string): string {
  return join(rootDir, '.nf-blaze', 'health.json')
}

/**
 * נרמול שגיאת קונסול לחתימה יציבה: מספרי שורה, כתובות והאשים משתנים
 * בכל build ואסור שייחשבו «שגיאה חדשה».
 */
export function normalizeConsoleError(raw: string): string {
  return raw
    .replace(/https?:\/\/[^\s)'"]+/g, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/** דוח תקין = כל המסלולים נטענו ואין שגיאות קונסול */
export function isHealthy(report: HealthReport): boolean {
  return (
    report.routes.length > 0 &&
    report.routes.every((r) => r.ok) &&
    report.consoleErrors.length === 0
  )
}

export function readBaseline(rootDir: string): HealthReport | null {
  const path = healthFilePath(rootDir)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HealthReport
    if (!Array.isArray(parsed?.routes) || !Array.isArray(parsed?.consoleErrors)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** שומר רק דוח תקין. מחזיר true אם נשמר. */
export function saveBaselineIfHealthy(rootDir: string, report: HealthReport): boolean {
  if (!isHealthy(report)) return false
  const path = healthFilePath(rootDir)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * רגרסיה = משהו שהיה **תקין** בבסיס ונשבר עכשיו.
 *
 * מה שלא נחשב רגרסיה, בכוונה:
 * - מסלול שלא היה תקין גם קודם (לא נשבר עכשיו)
 * - מסלול שנעלם מהפרויקט (סביר שהמשתמש ביקש להסיר)
 * - שגיאת קונסול שכבר הייתה בבסיס
 */
export function compareHealth(baseline: HealthReport | null, current: HealthReport): Regression[] {
  if (!baseline) return []

  const regressions: Regression[] = []
  const before = new Map(baseline.routes.map((r) => [r.route, r]))

  for (const route of current.routes) {
    if (route.ok) continue
    const prev = before.get(route.route)
    if (!prev?.ok) continue
    regressions.push({
      kind: 'route',
      route: route.route,
      detail: route.reason ?? 'העמוד לא נטען'
    })
  }

  // שגיאה שכבר הוסברה בשורת המסלול לא מדווחת שוב כשורת קונסול
  const alreadyShown = regressions.map((r) => normalizeConsoleError(r.detail)).filter(Boolean)

  const known = new Set(baseline.consoleErrors)
  const seen = new Set<string>()
  for (const err of current.consoleErrors) {
    if (known.has(err) || seen.has(err)) continue
    if (alreadyShown.some((shown) => shown.includes(err))) continue
    seen.add(err)
    regressions.push({ kind: 'console', detail: err })
  }

  return regressions.slice(0, MAX_REPORTED_REGRESSIONS)
}

/** טקסט קצר לצ'אט/סטטוס */
export function formatRegressions(regressions: Regression[]): string {
  return regressions
    .map((r) =>
      r.kind === 'route' ? `${r.route} — ${r.detail}` : `שגיאת קונסול חדשה: ${r.detail}`
    )
    .join('\n')
}
