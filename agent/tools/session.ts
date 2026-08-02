import { normalizeRelPath } from './paths'
import { ToolError } from './types'

/** One declared edit scope (initial or expansion) — recorded for the user UI */
export interface ScopeDeclaration {
  files: string[]
  reason?: string
  expansion: boolean
  at: number
}

/** Per-request tool session: scope + files already read */
export interface ToolSession {
  scopedPaths: Set<string>
  readPaths: Set<string>
  scopeHistory: ScopeDeclaration[]
  /** כמה פעמים כתיבה לקובץ נחסמה על מערכת העיצוב (path → count) */
  designBlocks: Map<string, number>
}

export function createToolSession(): ToolSession {
  return {
    scopedPaths: new Set(),
    readPaths: new Set(),
    scopeHistory: [],
    designBlocks: new Map()
  }
}

/**
 * כמה פעמים חוסמים קובץ על מערכת העיצוב לפני שמוותרים.
 *
 * אכיפה היא הדבר הנכון, אבל היא **לא שווה פרויקט תקוע**. אם המודל לא
 * הצליח לתקן פעמיים, הכתיבה עוברת — האיכות נפגעת מעט, המשתמש לא נתקע.
 */
export const MAX_DESIGN_BLOCKS_PER_FILE = 2

/**
 * מחזיר true אם צריך לחסום, ומקדם את המונה.
 * מהניסיון השלישי והלאה מפסיקים לחסום את הקובץ הזה.
 */
export function shouldBlockOnDesign(
  session: ToolSession | undefined,
  relativePath: string
): boolean {
  if (!session) return true
  const key = sessionPathKey(relativePath)
  const used = session.designBlocks.get(key) ?? 0
  if (used >= MAX_DESIGN_BLOCKS_PER_FILE) return false
  session.designBlocks.set(key, used + 1)
  return true
}

export function sessionPathKey(relativePath: string): string {
  return normalizeRelPath(relativePath).replace(/\\/g, '/')
}

export function markFileRead(session: ToolSession, relativePath: string): void {
  session.readPaths.add(sessionPathKey(relativePath))
}

/**
 * Declare or expand the writable file scope for this request.
 * Expansion (any declaration after the first) requires a non-empty reason.
 */
export function declareScope(
  session: ToolSession,
  files: string[],
  reason?: string
): ScopeDeclaration {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ToolError('files חייב להיות מערך לא ריק של נתיבים', 'invalid_args')
  }

  const expansion = session.scopeHistory.length > 0
  if (expansion && !(typeof reason === 'string' && reason.trim())) {
    throw new ToolError(
      'להרחבת היקף נדרש נימוק (reason). הצהר היקף חדש עם נימוק.',
      'scope_reason_required'
    )
  }

  const normalized: string[] = []
  for (const f of files) {
    if (typeof f !== 'string' || !f.trim()) {
      throw new ToolError('כל קובץ בהיקף חייב להיות מחרוזת נתיב', 'invalid_args')
    }
    normalized.push(sessionPathKey(f))
  }

  for (const p of normalized) {
    session.scopedPaths.add(p)
  }

  const declaration: ScopeDeclaration = {
    files: normalized,
    reason: reason?.trim() || undefined,
    expansion,
    at: Date.now()
  }
  session.scopeHistory.push(declaration)
  return declaration
}

/** Fail if path is outside the declared writable scope */
export function assertInScope(session: ToolSession | undefined, relativePath: string): void {
  if (!session) {
    throw new ToolError('הקובץ לא בהיקף שהצהרת. הצהר היקף חדש עם נימוק.', 'out_of_scope')
  }
  const key = sessionPathKey(relativePath)
  if (!session.scopedPaths.has(key)) {
    throw new ToolError('הקובץ לא בהיקף שהצהרת. הצהר היקף חדש עם נימוק.', 'out_of_scope')
  }
}

/** Fail if edit_file target was not read in this session */
export function assertReadBeforeEdit(session: ToolSession | undefined, relativePath: string): void {
  if (!session) {
    throw new ToolError('קרא את הקובץ לפני עריכה.', 'read_before_edit')
  }
  const key = sessionPathKey(relativePath)
  if (!session.readPaths.has(key)) {
    throw new ToolError('קרא את הקובץ לפני עריכה.', 'read_before_edit')
  }
}
