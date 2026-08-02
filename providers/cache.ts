/**
 * Prompt caching — משותף לכל המתאמים.
 *
 * בלולאת סוכן, אותו פרומפט מערכת + הגדרות כלים נשלחים מחדש בכל איטרציה.
 * שלושת הספקים מוזילים קלט מטמון ב-~90%, אבל כל אחד בדרך אחרת:
 *
 * - **Anthropic** — מפורש: סמני `cache_control` בתוך הבקשה.
 * - **OpenAI** — אוטומטי מעל ~1024 טוקנים, תלוי **קידומת יציבה** בלבד.
 * - **Gemini** — מטמון משתמע ב-2.5+, גם הוא תלוי קידומת יציבה.
 *
 * מכאן שני כללים שחלים על כולם:
 * 1. סדר «יציב ראשון, משתנה אחרון» — מערכת → כלים → היסטוריה → הבקשה.
 * 2. אין לשנות את הקידומת בין איטרציות (גם לא רווח אחד).
 */

/**
 * Anthropic בודק עד 20 בלוקים אחורה מנקודת שבירה. סבב שמוסיף יותר מזה
 * מפספס מטמון **בלי שגיאה** — לכן נקודת ביניים כל 15 בלוקים.
 */
export const CACHE_LOOKBACK_BLOCKS = 15

/** Anthropic מתיר 4 נקודות שבירה לכל בקשה */
export const MAX_CACHE_BREAKPOINTS = 4

/** מתחת לזה אין מטמון אצל אף ספק — לא שווה סמן */
export const MIN_CACHEABLE_CHARS = 2_000

export interface CacheMetrics {
  /** טוקנים שנקראו ממטמון (זול פי ~10) */
  cacheReadTokens: number
  /** טוקנים שנכתבו למטמון (יקר מעט יותר מקלט רגיל, פעם אחת) */
  cacheWriteTokens: number
}

export function emptyCacheMetrics(): CacheMetrics {
  return { cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/**
 * אילו אינדקסים של הודעות מקבלים נקודת שבירה.
 *
 * הרעיון: נקודה אחת «מתגלגלת» בסוף השיחה (הקידומת של הסבב הבא תיפגע בה),
 * ונקודות ביניים כל CACHE_LOOKBACK_BLOCKS כדי שסבב עמוס בלוקים לא יחרוג
 * מחלון המבט לאחור.
 *
 * @param blockCounts מספר בלוקי התוכן בכל הודעה, לפי הסדר
 * @param reserved כמה נקודות שבירה כבר תפוסות (system / tools)
 */
export function pickCacheBreakpoints(blockCounts: number[], reserved = 0): Set<number> {
  const picks = new Set<number>()
  const budget = MAX_CACHE_BREAKPOINTS - reserved
  if (budget <= 0 || blockCounts.length === 0) return picks

  // הנקודה המתגלגלת — סוף השיחה הנוכחית
  picks.add(blockCounts.length - 1)

  // נקודות ביניים לאחור, כל CACHE_LOOKBACK_BLOCKS בלוקים
  let sinceMark = 0
  for (let i = blockCounts.length - 2; i >= 0 && picks.size < budget; i--) {
    sinceMark += blockCounts[i] ?? 0
    if (sinceMark >= CACHE_LOOKBACK_BLOCKS) {
      picks.add(i)
      sinceMark = 0
    }
  }

  return picks
}

/** האם בכלל שווה למטמן את הקידומת הזו */
export function worthCaching(system: string | undefined, toolCount: number): boolean {
  const systemChars = system?.length ?? 0
  // הגדרות כלים תופסות מקום משמעותי בפני עצמן
  return systemChars >= MIN_CACHEABLE_CHARS || toolCount >= 5
}
