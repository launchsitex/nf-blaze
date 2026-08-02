/**
 * השוואת גרסאות ומניפסט העדכונים.
 *
 * לוגיקה טהורה בלבד — נבדקת ביחידות, בלי רשת ובלי Electron. ההחלטה
 * «האם חובה לעדכן» היא נקודה קריטית: טעות כאן נועלת לקוחות משלמים מחוץ
 * למערכת, ולכן כל ענף כאן מכוסה בבדיקות.
 */

export type UpdateStage = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

/**
 * דחיית עדכון חובה — «אני באמצע עבודה, תזכיר לי אחר כך».
 *
 * הצורך: עדכון חובה שקופץ באמצע בנייה של פרויקט סוגר למשתמש את העבודה.
 * 12 שעות מכסות יום עבודה שלם, והמכסה מונעת דחייה אינסופית.
 */
export const UPDATE_SNOOZE_MS = 12 * 3_600_000

/** כמה פעמים מותר לדחות **לכל גרסה**. 2 × 12ש' = יממה, ואז חובה לעדכן. */
export const MAX_UPDATE_SNOOZES = 2

export interface UpdateSnooze {
  /** הגרסה שנדחתה — גרסה חדשה יותר מאפסת את המונה */
  version: string
  /** עד מתי (ms) */
  untilMs: number
  /** כמה פעמים נדחתה הגרסה הזו */
  count: number
}

/** מצב העדכון כפי שה-renderer רואה אותו */
export interface UpdateState {
  stage: UpdateStage
  /**
   * חוסם **כרגע**. דחייה פעילה מכבה את זה גם בעדכון חובה — ולכן זה השדה
   * שקובע אם מסך החסימה מוצג ואם שכבת ה-IPC נעולה.
   */
  required: boolean
  /** השרת הכריז שהעדכון חובה — נשאר true גם בזמן דחייה, לניסוח ההודעה */
  mandatory: boolean
  currentVersion: string
  newVersion?: string
  /** אחוז ההורדה, כשהיא רצה */
  percent?: number
  /** הודעה למשתמש — ידידותית, בלי פרטים פנימיים */
  message?: string
  /** להציע הורדה ידנית אחרי כשלונות חוזרים */
  offerManual: boolean
  downloadUrl: string
  /** עד מתי העדכון נדחה (ms), אם נדחה */
  snoozedUntil?: number
  /** נותרו דחיות — האם להציג את כפתור «אחר כך» */
  canSnooze: boolean
}

export interface SnoozeVerdict {
  /** הדחייה בתוקף כרגע ולכן אין לחסום */
  active: boolean
  /** מתי היא נגמרת (ms), כשהיא פעילה */
  untilMs?: number
  /** מותר לדחות (שוב) */
  canSnooze: boolean
}

/**
 * האם דחייה קיימת עדיין תקפה, ואם מותר לדחות שוב. לוגיקה טהורה.
 *
 * שתי הגנות:
 * 1. **דחייה נקשרת לגרסה.** גרסה חדשה יותר מתחילה מונה נקי — אחרת דחייה
 *    אחת הייתה מכסה גם על גרסאות עתידיות.
 * 2. **שעון שהוחזר אחורה לא מאריך דחייה.** אם הזמן שנותר גדול מחלון
 *    הדחייה, הערך בהכרח שגוי (או נערך ידנית) והדחייה נחשבת גמורה.
 */
export function snoozeVerdict(opts: {
  snooze?: UpdateSnooze | null
  newVersion?: string
  nowMs: number
}): SnoozeVerdict {
  const version = (opts.newVersion || '').trim()
  const snooze = opts.snooze
  const sameVersion =
    Boolean(snooze) && Boolean(version) && compareVersions(snooze!.version, version) === 0

  const count = sameVersion ? Math.max(0, Number(snooze!.count) || 0) : 0
  const canSnooze = count < MAX_UPDATE_SNOOZES

  if (!sameVersion) return { active: false, canSnooze }

  const untilMs = Number(snooze!.untilMs) || 0
  const remaining = untilMs - opts.nowMs
  // נגמרה, או ערך לא-סביר שמעיד על שעון שהוחזר / עריכה ידנית
  if (remaining <= 0 || remaining > UPDATE_SNOOZE_MS) return { active: false, canSnooze }

  return { active: true, untilMs, canSnooze }
}

/** בונה את הדחייה הבאה. מחזיר null כשהמכסה נגמרה. */
export function nextSnooze(opts: {
  snooze?: UpdateSnooze | null
  newVersion?: string
  nowMs: number
}): UpdateSnooze | null {
  const version = (opts.newVersion || '').trim()
  if (!version) return null
  const verdict = snoozeVerdict(opts)
  if (!verdict.canSnooze) return null
  const sameVersion =
    Boolean(opts.snooze) && compareVersions(opts.snooze!.version, version) === 0
  const count = sameVersion ? Math.max(0, Number(opts.snooze!.count) || 0) : 0
  return { version, untilMs: opts.nowMs + UPDATE_SNOOZE_MS, count: count + 1 }
}

/** מניפסט שמתפרסם לצד המתקין (`download/version.json`) */
export interface UpdateManifest {
  /** הגרסה האחרונה שפורסמה */
  version: string
  /**
   * האם העדכון חובה. ברירת המחדל היא כן — אבל אפשר לכבות מרחוק
   * אם גרסה יצאה תקולה, בלי לחכות לגרסה מתקנת.
   */
  mandatory?: boolean
  /**
   * גרסה מינימלית שמותר להמשיך לעבוד איתה. אם קיימת — היא גוברת על
   * `mandatory`, ומאפשרת לחייב עדכון רק ממי שנמצא מתחת לרף מסוים.
   */
  minVersion?: string
  releasedAt?: string
}

/**
 * השוואת גרסאות סמנטיות. מחזיר שלילי אם a<b, חיובי אם a>b, ‏0 אם שוות.
 * מתעלם מסיומות pre-release — אין לנו כאלה בהפצה.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]!
      .split('.')
      .map((n) => {
        const num = parseInt(n, 10)
        return Number.isFinite(num) ? num : 0
      })

  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length, 3)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

export interface UpdateDecision {
  /** קיימת גרסה חדשה יותר */
  available: boolean
  /** אי אפשר להמשיך לעבוד בלי לעדכן */
  required: boolean
  newVersion?: string
}

/**
 * מה עושים עם המניפסט שהתקבל.
 *
 * **כלל ברזל: מניפסט חסר, פגום או לא נגיש לעולם אינו נועל את המשתמש.**
 * תקלת רשת או נפילה של האחסון היא בעיה שלנו, לא של הלקוח — הוא ימשיך
 * לעבוד כרגיל. חסימה מתרחשת רק כשהתקבלה תשובה תקינה שאומרת במפורש
 * שהגרסה שלו כבר לא נתמכת.
 */
export function decideUpdate(
  manifest: UpdateManifest | null | undefined,
  currentVersion: string
): UpdateDecision {
  if (!manifest || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    return { available: false, required: false }
  }

  const latest = manifest.version.trim()
  if (!isNewerVersion(latest, currentVersion)) {
    return { available: false, required: false }
  }

  // `minVersion` מדויק יותר מ-`mandatory` ולכן גובר עליו כשהוא קיים
  const required =
    typeof manifest.minVersion === 'string' && manifest.minVersion.trim()
      ? isNewerVersion(manifest.minVersion.trim(), currentVersion)
      : manifest.mandatory !== false

  return { available: true, required, newVersion: latest }
}
