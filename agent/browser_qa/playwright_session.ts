/**
 * Playwright session — headless תמיד.
 *
 * ההתקנה אורזת רק את ה-headless shell (≈270MB). Chromium המלא היה
 * מוסיף ≈415MB נוספים למתקין רק כדי שאפשר יהיה לראות חלון נפתח —
 * מחיר שלא שווה את זה לבדיקה שרצה ברקע.
 */
import { mkdirSync } from 'fs'
import { join } from 'path'
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright'

export type BrowserSession = {
  browser: Browser
  page: Page
  baseUrl: string
  consoleErrors: string[]
  screenshotsDir: string
  close: () => Promise<void>
}

export async function openBrowserSession(opts: {
  baseUrl: string
  rootDir: string
  /** נשמר לתאימות; ההרצה תמיד headless בגלל הדפדפן המצורף */
  headed?: boolean
}): Promise<BrowserSession> {
  const screenshotsDir = join(opts.rootDir, '.nf-blaze', 'browser_qa')
  mkdirSync(screenshotsDir, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage']
  })

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'he-IL'
  })
  const page = await context.newPage()
  const consoleErrors: string[] = []

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message || String(err))
  })

  await page.goto(opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

  return {
    browser,
    page,
    baseUrl: opts.baseUrl.replace(/\/$/, ''),
    consoleErrors,
    screenshotsDir,
    close: async () => {
      try {
        await context.close()
      } catch {
        /* ignore */
      }
      try {
        await browser.close()
      } catch {
        /* ignore */
      }
    }
  }
}
