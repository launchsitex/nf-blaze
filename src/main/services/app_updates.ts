/**
 * עדכוני גרסה — כולל עדכון חובה שחוסם את המערכת עד להתקנה.
 *
 * שני מקורות מידע, בכוונה:
 *  1. `version.json` באתר — מחליט **האם** יש גרסה חדשה והאם היא חובה.
 *  2. `electron-updater` מול `latest.yml` — מבצע את ההורדה וההתקנה בפועל
 *     (כולל אימות sha512 ועדכון דיפרנציאלי).
 *
 * למה לא רק electron-updater: הוא יודע לומר «יש חדש», אבל לא «אסור להמשיך
 * בלי לעדכן», ואין דרך לבטל חיוב עדכון מרחוק אם גרסה יצאה תקולה.
 *
 * **בטוח-כשל לכיוון הפתוח:** תקלת רשת, אחסון שנפל או מניפסט פגום לעולם
 * לא נועלים את המשתמש. חסימה קורית רק כשהתקבלה תשובה תקינה שאומרת
 * במפורש שהגרסה הזו כבר לא נתמכת.
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '../../shared/ipc'
import {
  decideUpdate,
  nextSnooze,
  snoozeVerdict,
  type UpdateManifest,
  type UpdateSnooze,
  type UpdateState
} from '../../shared/version'
import { loadSettingsRaw, saveSettings } from './storage'

/** בסיס הפצה — נדרס ב-NF_BLAZE_UPDATE_BASE לבדיקות מול שרת אחר */
function updateBase(): string {
  return (process.env.NF_BLAZE_UPDATE_BASE?.trim() || 'https://nf-blaze.dev/download').replace(
    /\/+$/,
    ''
  )
}

const manifestUrl = (): string => `${updateBase()}/version.json`
export const downloadPageUrl = (): string => `${updateBase()}/`

const CHECK_INTERVAL_MS = 10 * 60 * 1000 // «חי» — בלי להציף אחסון משותף
const FIRST_CHECK_DELAY_MS = 6_000
const MANIFEST_TIMEOUT_MS = 8_000
/** אחרי כמה כשלונות מציעים למשתמש הורדה ידנית במקום להשאיר אותו תקוע */
const FAILURES_BEFORE_MANUAL = 2

let state: UpdateState = {
  stage: 'idle',
  required: false,
  mandatory: false,
  offerManual: false,
  canSnooze: false,
  currentVersion: app.getVersion(),
  downloadUrl: 'https://nf-blaze.dev/download/'
}

let started = false
let failures = 0
let downloadStarted = false

/**
 * מחשב מחדש את החסימה בפועל מתוך מה שהשרת הכריז + דחייה פעילה.
 * נקרא בכל קריאה למצב, כדי שדחייה שנגמרה תחזיר את החסימה גם בלי
 * שהמניפסט נבדק מחדש.
 */
function loadSnooze(): UpdateSnooze | null {
  try {
    return loadSettingsRaw().updateSnooze ?? null
  } catch {
    return null
  }
}

function resolveSnooze(): { required: boolean; snoozedUntil?: number; canSnooze: boolean } {
  if (!state.mandatory) {
    // עדכון לא-חובה: אין מה לדחות, וגם אין מה לחסום
    return { required: false, canSnooze: false }
  }
  const verdict = snoozeVerdict({
    snooze: loadSnooze(),
    newVersion: state.newVersion,
    nowMs: Date.now()
  })
  return {
    required: !verdict.active,
    snoozedUntil: verdict.untilMs,
    canSnooze: verdict.canSnooze
  }
}

export function getUpdateState(): UpdateState {
  const snooze = resolveSnooze()
  return {
    ...state,
    ...snooze,
    currentVersion: app.getVersion(),
    downloadUrl: downloadPageUrl()
  }
}

/**
 * האם לחסום את המערכת ברגע זה.
 *
 * ⚠️ זו הפונקציה ששומר ה-IPC נשען עליה — דחייה פעילה **פותחת** את המערכת
 * גם כשהעדכון חובה. זה מכוון: עדכון שקופץ באמצע בנייה סוגר למשתמש את
 * העבודה, והמכסה (`MAX_UPDATE_SNOOZES`) היא מה שמונע דחייה אינסופית.
 */
export function isUpdateRequired(): boolean {
  return resolveSnooze().required
}

/**
 * דחיית העדכון ב-12 שעות. מחזיר את המצב המעודכן; אם המכסה נגמרה, שום
 * דבר לא משתנה והחסימה נשארת.
 */
export function snoozeUpdate(): UpdateState {
  if (!state.mandatory || !state.newVersion) return getUpdateState()
  const next = nextSnooze({
    snooze: loadSnooze(),
    newVersion: state.newVersion,
    nowMs: Date.now()
  })
  if (!next) return getUpdateState()
  try {
    saveSettings({ updateSnooze: next })
  } catch {
    /* אי אפשר לשמור — הדחייה פשוט לא תיזכר */
  }
  broadcast()
  return getUpdateState()
}

function broadcast(): void {
  const payload = getUpdateState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.APP_UPDATE_EVENT, payload)
  }
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

async function fetchManifest(): Promise<UpdateManifest | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const resp = await fetch(`${manifestUrl()}?t=${Date.now()}`, {
      signal: controller.signal,
      // אחסון סטטי אוהב לשמור במטמון — עדכון חייב להגיע מיד
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    })
    if (!resp.ok) return null
    return (await resp.json()) as UpdateManifest
  } catch {
    // אין רשת / השרת לא זמין — לא מדווח למשתמש ולא חוסם
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function check(): Promise<void> {
  const manifest = await fetchManifest()
  const decision = decideUpdate(manifest, app.getVersion())

  if (!decision.available) {
    // הגרסה עדכנית (או שאין תשובה) — משחררים חסימה קודמת אם הייתה
    if (state.stage !== 'idle' || state.mandatory) {
      setState({
        stage: 'idle',
        required: false,
        mandatory: false,
        newVersion: undefined,
        message: undefined
      })
    }
    return
  }

  /*
   * `required` נגזר מ-`mandatory` בתוך getUpdateState/isUpdateRequired לפי
   * הדחייה, ולכן כאן נשמר רק מה שהשרת הכריז. ה-broadcast שנשלח מכאן הוא גם
   * מה שמחזיר את החסימה כשדחייה נגמרה — הבדיקה רצה כל 10 דקות.
   */
  setState({
    stage: state.stage === 'ready' ? 'ready' : 'available',
    mandatory: decision.required,
    newVersion: decision.newVersion
  })

  // ההורדה מתחילה פעם אחת ומתקדמת ברקע גם אם המשתמש עוד לא לחץ
  if (!downloadStarted && state.stage !== 'ready') {
    downloadStarted = true
    setState({ stage: 'downloading', percent: 0 })
    autoUpdater.checkForUpdates().catch(() => handleFailure())
  }
}

function handleFailure(): void {
  failures += 1
  downloadStarted = false
  setState({
    stage: 'error',
    percent: undefined,
    offerManual: failures >= FAILURES_BEFORE_MANUAL,
    message:
      failures >= FAILURES_BEFORE_MANUAL
        ? 'ההורדה לא הצליחה. אפשר להוריד את הגרסה החדשה ידנית ולהתקין.'
        : 'ההורדה נקטעה. אפשר לנסות שוב.'
  })
}

/** הפעלה ידנית מהשער — מנסה שוב אחרי כישלון */
export async function retryUpdate(): Promise<UpdateState> {
  downloadStarted = true
  setState({ stage: 'downloading', percent: 0, message: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    handleFailure()
  }
  return getUpdateState()
}

/** התקנה והפעלה מחדש — הכפתור «עדכן עכשיו» */
export function installUpdate(): void {
  if (state.stage !== 'ready') return
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

export function startAutoUpdates(): void {
  if (started) return
  started = true

  // בפיתוח אין app-update.yml — אין מה לבדוק, ולא חוסמים כלום
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('error', () => handleFailure())

  autoUpdater.on('download-progress', (p) => {
    setState({ stage: 'downloading', percent: Math.round(p.percent || 0), message: undefined })
  })

  autoUpdater.on('update-downloaded', (info) => {
    failures = 0
    setState({
      stage: 'ready',
      percent: 100,
      newVersion: info.version,
      offerManual: false,
      message: undefined
    })
  })

  const run = (): void => {
    void check()
  }
  setTimeout(run, FIRST_CHECK_DELAY_MS)
  setInterval(run, CHECK_INTERVAL_MS)
}

/** בדיקה מיידית לפי בקשת ה-renderer (חזרה לחלון / לחיצה) */
export async function checkNow(): Promise<UpdateState> {
  if (app.isPackaged) await check()
  return getUpdateState()
}
