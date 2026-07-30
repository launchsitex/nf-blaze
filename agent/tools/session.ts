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
}

export function createToolSession(): ToolSession {
  return {
    scopedPaths: new Set(),
    readPaths: new Set(),
    scopeHistory: []
  }
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
    throw new ToolError(
      'הקובץ לא בהיקף שהצהרת. הצהר היקף חדש עם נימוק.',
      'out_of_scope'
    )
  }
  const key = sessionPathKey(relativePath)
  if (!session.scopedPaths.has(key)) {
    throw new ToolError(
      'הקובץ לא בהיקף שהצהרת. הצהר היקף חדש עם נימוק.',
      'out_of_scope'
    )
  }
}

/** Fail if edit_file target was not read in this session */
export function assertReadBeforeEdit(
  session: ToolSession | undefined,
  relativePath: string
): void {
  if (!session) {
    throw new ToolError('קרא את הקובץ לפני עריכה.', 'read_before_edit')
  }
  const key = sessionPathKey(relativePath)
  if (!session.readPaths.has(key)) {
    throw new ToolError('קרא את הקובץ לפני עריכה.', 'read_before_edit')
  }
}
