/**
 * הריגת עץ תהליכים.
 *
 * ב-Windows, `spawn(..., { shell: true })` מייצר cmd.exe שמריץ את npm,
 * ש-npm מריץ את vite. `child.kill()` הורג רק את ה-cmd — **vite נשאר חי**.
 * התוצאה: שרתי דיב יתומים שמצטברים אחרי כל בדיקה, מחזיקים פורטים וזיכרון,
 * ומונעים מהתהליך שקרא להם לצאת בכלל.
 *
 * `taskkill /T` הורג את כל העץ. ב-POSIX משתמשים ב-SIGTERM ואז SIGKILL.
 */
import { spawn, type ChildProcess } from 'child_process'

/** כמה לחכות ל-SIGTERM לפני SIGKILL (POSIX בלבד) */
export const SIGKILL_GRACE_MS = 1_500

export function killProcessTree(child: ChildProcess | null | undefined): void {
  if (!child || child.killed) return
  const pid = child.pid
  try {
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      return
    }
    child.kill('SIGTERM')
    setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, SIGKILL_GRACE_MS).unref?.()
  } catch {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
}
