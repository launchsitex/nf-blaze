/**
 * «בסיס ירוק» — טיפוסי בדיקת בריאות של הפרויקט אחרי סבב של הסוכן.
 * שלב א': מזהה ומדווח בלבד. אין החזרה אוטומטית.
 */

export interface RouteHealth {
  /** נתיב יחסי שנבדק, למשל `/` או `/about` */
  route: string
  ok: boolean
  /** למה נכשל — מוצג למשתמש כמו שהוא */
  reason?: string
}

export interface HealthReport {
  createdAt: string
  routes: RouteHealth[]
  /** חתימות מנורמלות של שגיאות קונסול (בלי מספרים/כתובות) */
  consoleErrors: string[]
}

export type RegressionKind = 'route' | 'console'

export interface Regression {
  kind: RegressionKind
  /** קיים רק ל-kind=route */
  route?: string
  detail: string
}

export type HealthCheckOutcome =
  | { skipped: true; reason: string }
  | {
      skipped: false
      report: HealthReport
      regressions: Regression[]
      /** true כשהדוח היה תקין ונשמר כבסיס החדש */
      baselineSaved: boolean
      /** true כשזו הבדיקה הראשונה — אין מול מה להשוות */
      firstRun: boolean
    }
