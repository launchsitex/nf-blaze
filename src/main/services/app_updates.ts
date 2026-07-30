/**
 * עדכונים אוטומטיים — electron-updater מול שרת העדכונים שב-package.json (build.publish).
 * בטוח-כשל: כל שגיאה (אין רשת / שרת לא קיים עדיין) נבלעת בשקט ולא מפריעה למשתמש.
 */
import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // כל 4 שעות
let started = false

export function startAutoUpdates(): void {
  if (started) return
  started = true

  // בפיתוח אין app-update.yml — אין מה לבדוק
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('error', () => {
    /* אין רשת / שרת עדכונים עוד לא הוקם — שקט */
  })

  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        title: 'עדכון זמין',
        message: `גרסה חדשה של NF-Blaze ירדה (${info.version}).`,
        detail: 'העדכון יותקן אוטומטית בסגירת האפליקציה, או עכשיו בלחיצה.',
        buttons: ['התקן והפעל מחדש', 'אחר כך'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      .then(({ response }) => {
        if (response === 0) {
          setImmediate(() => autoUpdater.quitAndInstall())
        }
      })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }

  // בדיקה ראשונה קצת אחרי העלייה — לא מתחרה בטעינת החלון
  setTimeout(check, 10_000)
  setInterval(check, CHECK_INTERVAL_MS)
}
