/**
 * אמון מדורג.
 *
 * ההרשאה אינה מתג קבוע — היא **נבנית**. משתמש שאישר עשרה סבבים ברצף
 * לא צריך להמשיך לאשר כל שינוי קטן; משתמש שביטל סבב חוזר לשאלה.
 *
 * שני עקרונות מנחים:
 * 1. **סיכון משוקלל-הפיכות** — אוטונומיה גדלה רק על שינויים קטנים
 *    והפיכים. שינוי גדול, או סבב שנמצאה בו רגרסיה, תמיד חוזר לשאלה.
 * 2. **קובץ שקוף** — הכול ב-`.nf-blaze/trust.json` בתיקיית הפרויקט,
 *    קריא ובר-מחיקה על ידי המשתמש, לא DB אטום.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type TrustLevel = 0 | 1 | 2

export interface TrustState {
  /** אישורים רצופים ללא ביטול */
  streak: number
  approved: number
  rejected: number
  level: TrustLevel
  updatedAt: string
}

/** כמה אישורים רצופים נדרשים לכל דרגה */
export const LEVEL_THRESHOLDS: Record<Exclude<TrustLevel, 0>, number> = {
  1: 3,
  2: 10
}

/** מעל זה שינוי נחשב גדול ותמיד דורש אישור, בכל דרגה */
export const LARGE_CHANGE_FILES = 5

export function trustFilePath(rootDir: string): string {
  return join(rootDir, '.nf-blaze', 'trust.json')
}

export function emptyTrust(): TrustState {
  return {
    streak: 0,
    approved: 0,
    rejected: 0,
    level: 0,
    updatedAt: new Date().toISOString()
  }
}

export function readTrust(rootDir: string): TrustState {
  const path = trustFilePath(rootDir)
  if (!existsSync(path)) return emptyTrust()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<TrustState>
    return {
      streak: Number(parsed.streak) || 0,
      approved: Number(parsed.approved) || 0,
      rejected: Number(parsed.rejected) || 0,
      level: levelForStreak(Number(parsed.streak) || 0),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    }
  } catch {
    return emptyTrust()
  }
}

export function levelForStreak(streak: number): TrustLevel {
  if (streak >= LEVEL_THRESHOLDS[2]) return 2
  if (streak >= LEVEL_THRESHOLDS[1]) return 1
  return 0
}

/**
 * רישום החלטה של המשתמש.
 * ביטול **מאפס** את הרצף — אמון נבנה לאט ונשבר מיד.
 */
export function recordDecision(rootDir: string, approved: boolean): TrustState {
  const current = readTrust(rootDir)
  const streak = approved ? current.streak + 1 : 0
  const next: TrustState = {
    streak,
    approved: current.approved + (approved ? 1 : 0),
    rejected: current.rejected + (approved ? 0 : 1),
    level: levelForStreak(streak),
    updatedAt: new Date().toISOString()
  }
  try {
    const path = trustFilePath(rootDir)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* אי אפשר לכתוב — האמון פשוט לא נצבר */
  }
  return next
}

export interface AutoApproveInput {
  level: TrustLevel
  filesChanged: number
  /** נמצאה שבירה של מה שעבד — תמיד חוזר לשאלה */
  hasRegressions: boolean
}

/**
 * האם הסבב הזה יכול להיסגר בלי לשאול.
 * שים לב: כל תשובה שלילית מחזירה את המשתמש לשליטה מלאה — זו ברירת המחדל.
 */
export function shouldAutoApprove(input: AutoApproveInput): boolean {
  if (input.hasRegressions) return false
  if (input.filesChanged <= 0) return false
  if (input.level === 0) return false
  if (input.level === 1) return input.filesChanged < LARGE_CHANGE_FILES
  return input.filesChanged < LARGE_CHANGE_FILES * 2
}

/** הסבר קצר למשתמש למה הוא לא נשאל הפעם */
export function explainAutoApprove(state: TrustState): string {
  return `אושר אוטומטית — ${state.streak} סבבים רצופים אושרו. אפשר לבטל בכל רגע מהיסטוריית הגרסאות.`
}
