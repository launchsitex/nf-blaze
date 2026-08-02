/**
 * תיקון ארגומנטים של קריאות כלים — הבדלי ספקים.
 *
 * מצבי הכשל שונים לחלוטין בין הספקים, ולכן טיפול אחיד מפספס:
 * - **Gemini** מייצר JSON פגום בשיעור ניכר בשרשראות כלים מורכבות.
 * - **GPT** קורא לכלי הנכון עם פרמטרים שגויים (שם/טיפוס).
 * - **Claude** נוטה לחקור במקום לבצע, אבל הארגומנטים שלו תקינים.
 *
 * המודול הזה מתקן את מה שניתן לתקן דטרמיניסטית, לפני שהשגיאה מגיעה
 * ללולאת הסוכן ועולה סבב שלם.
 */

/** תיקונים שהופעלו — לטלמטריה, לא לתצוגה למשתמש */
export type RepairKind =
  'code_fence' | 'surrounding_prose' | 'trailing_comma' | 'smart_quotes' | 'unbalanced'

export interface RepairResult {
  value: Record<string, unknown> | null
  repairs: RepairKind[]
}

function asObject(parsed: unknown): Record<string, unknown> | null {
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(text))
  } catch {
    return null
  }
}

/** ```json … ``` — נפוץ אצל מודלים שאומנו על markdown */
function stripCodeFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fence?.[1]?.trim() ?? text
}

/** טקסט לפני/אחרי האובייקט — «Here is the JSON: {…}» */
function extractOutermostObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return text
  return text.slice(start, end + 1)
}

/** פסיק אחרון לפני סוגר — לא חוקי ב-JSON, נפוץ מאוד בפלט מודלים */
function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1')
}

/** גרשיים «חכמים» שהמודל שאב מטקסט עברי/עיצובי */
function normalizeSmartQuotes(text: string): string {
  return text.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'")
}

/**
 * סגירת מבנה חתוך — קורה כשהתשובה נקטעה באמצע.
 * סורק תווים מחוץ למחרוזות, וסוגר את מה שנשאר פתוח.
 */
function closeUnbalanced(text: string): string {
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (const ch of text) {
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }

  let out = text
  if (inString) out += '"'
  // פסיק תלוי בסוף אחרי קטיעה
  out = out.replace(/,\s*$/, '')
  while (stack.length) {
    out += stack.pop() === '{' ? '}' : ']'
  }
  return out
}

/**
 * מנסה לחלץ אובייקט ארגומנטים תקין ממחרוזת גולמית.
 * מחזיר `value: null` רק כשגם אחרי כל התיקונים אין JSON שמייצג אובייקט.
 */
export function repairToolArguments(raw: string): RepairResult {
  const repairs: RepairKind[] = []
  const text = raw?.trim() ?? ''
  if (!text) return { value: {}, repairs }

  const direct = tryParse(text)
  if (direct) return { value: direct, repairs }

  let candidate = text

  const defenced = stripCodeFence(candidate)
  if (defenced !== candidate) {
    candidate = defenced
    repairs.push('code_fence')
    const parsed = tryParse(candidate)
    if (parsed) return { value: parsed, repairs }
  }

  const extracted = extractOutermostObject(candidate)
  if (extracted !== candidate) {
    candidate = extracted
    repairs.push('surrounding_prose')
    const parsed = tryParse(candidate)
    if (parsed) return { value: parsed, repairs }
  }

  const quoted = normalizeSmartQuotes(candidate)
  if (quoted !== candidate) {
    candidate = quoted
    repairs.push('smart_quotes')
    const parsed = tryParse(candidate)
    if (parsed) return { value: parsed, repairs }
  }

  const decommaed = removeTrailingCommas(candidate)
  if (decommaed !== candidate) {
    candidate = decommaed
    repairs.push('trailing_comma')
    const parsed = tryParse(candidate)
    if (parsed) return { value: parsed, repairs }
  }

  const balanced = closeUnbalanced(candidate)
  if (balanced !== candidate) {
    candidate = balanced
    repairs.push('unbalanced')
    const parsed = tryParse(removeTrailingCommas(candidate))
    if (parsed) return { value: parsed, repairs }
  }

  return { value: null, repairs }
}

/**
 * התאמת ארגומנטים לסכמה — מטפל בכשל האופייני של GPT: הכלי הנכון,
 * הפרמטר הלא נכון. מתקן רק מה שחד-משמעי:
 * - שם פרמטר בהבדל אותיות גדולות/קטנות או קו תחתון
 * - מספר/בוליאני שהגיעו כמחרוזת
 *
 * לעולם לא ממציא ערכים ולא מוחק פרמטרים לא מוכרים.
 */
export function coerceArgumentsToSchema(
  args: Record<string, unknown>,
  parameters: Record<string, unknown> | undefined
): Record<string, unknown> {
  const props = (parameters?.properties ?? null) as Record<string, { type?: string }> | null
  if (!props) return args

  const canonical = new Map<string, string>()
  for (const name of Object.keys(props)) {
    canonical.set(name.toLowerCase().replace(/[_-]/g, ''), name)
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    const target =
      key in props ? key : (canonical.get(key.toLowerCase().replace(/[_-]/g, '')) ?? key)
    out[target] = coerceValue(value, props[target]?.type)
  }
  return out
}

function coerceValue(value: unknown, type: string | undefined): unknown {
  if (typeof value !== 'string' || !type) return value
  if (type === 'number' || type === 'integer') {
    const n = Number(value)
    return value.trim() !== '' && Number.isFinite(n) ? n : value
  }
  if (type === 'boolean') {
    const v = value.trim().toLowerCase()
    if (v === 'true') return true
    if (v === 'false') return false
  }
  return value
}
