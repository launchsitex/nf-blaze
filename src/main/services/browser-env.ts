/**
 * Chromium מצורף לבדיקות דפדפן.
 *
 * Playwright מחפש דפדפנים ב-`%LOCALAPPDATA%\ms-playwright`, שלא קיים
 * במחשב של לקוח. בלי זה גם בדיקת הדפדפן וגם «בסיס ירוק» פשוט מדלגות
 * בשקט — כלומר שתי תכונות שלא רצות אצל אף אחד.
 *
 * הפתרון: אורזים את ה-headless shell (≈270MB) ומצביעים אליו דרך
 * `PLAYWRIGHT_BROWSERS_PATH`. עובד אופליין, מהרגע הראשון, בלי הורדה.
 *
 * נארז רק ה-headless shell ולא Chromium המלא (≈415MB נוספים), ולכן
 * כל ההרצות חייבות להיות headless.
 */
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/** מיקומים אפשריים של הדפדפן המצורף, לפי סדר עדיפות */
function candidateDirs(): string[] {
  const list: string[] = []
  if (app.isPackaged) list.push(join(process.resourcesPath, 'playwright'))
  list.push(join(process.cwd(), 'resources', 'playwright'))
  try {
    list.push(join(app.getAppPath(), 'resources', 'playwright'))
  } catch {
    /* getAppPath unavailable in some contexts */
  }
  return list
}

/** תיקייה נחשבת תקינה רק אם יש בה באמת build של דפדפן */
function looksLikeBrowsersDir(dir: string): boolean {
  if (!existsSync(dir)) return false
  try {
    return readdirSync(dir).some((name) => name.startsWith('chromium'))
  } catch {
    return false
  }
}

/** נתיב הדפדפן המצורף, או null כשאין */
export function bundledBrowsersDir(): string | null {
  for (const dir of candidateDirs()) {
    if (looksLikeBrowsersDir(dir)) return dir
  }
  return null
}

/**
 * מפנה את Playwright לדפדפן המצורף.
 * נקרא פעם אחת בעליית האפליקציה, לפני כל שימוש בדפדפן.
 *
 * לא דורס הגדרה קיימת של המשתמש — מי שהתקין דפדפנים בעצמו ממשיך איתם.
 */
export function configureBundledBrowser(): { configured: boolean; dir: string | null } {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return { configured: false, dir: process.env.PLAYWRIGHT_BROWSERS_PATH }
  }
  const dir = bundledBrowsersDir()
  if (!dir) return { configured: false, dir: null }
  process.env.PLAYWRIGHT_BROWSERS_PATH = dir
  return { configured: true, dir }
}
