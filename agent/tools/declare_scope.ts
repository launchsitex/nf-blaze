import type { ToolHandler } from './types'
import { ToolError } from './types'
import { createToolSession, declareScope } from './session'

export const declareScopeTool: ToolHandler = async (args, ctx) => {
  try {
    if (!ctx.session) {
      ctx.session = createToolSession()
    }

    const files = args.files
    if (!Array.isArray(files)) {
      throw new ToolError('files חייב להיות מערך של נתיבים', 'invalid_args')
    }

    const reason = typeof args.reason === 'string' ? args.reason : undefined
    const declaration = declareScope(ctx.session, files as string[], reason)

    const label = declaration.expansion ? 'היקף הורחב' : 'היקף מוצהר'
    const lines = [
      `${label}:`,
      ...declaration.files.map((f) => `- ${f}`),
      declaration.reason ? `נימוק: ${declaration.reason}` : null,
      `סה״כ בהיקף כעת: ${Array.from(ctx.session.scopedPaths).sort().join(', ')}`
    ].filter(Boolean)

    return {
      ok: true,
      content: lines.join('\n'),
      data: {
        declaration,
        allScoped: Array.from(ctx.session.scopedPaths).sort(),
        history: ctx.session.scopeHistory
      }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'declare_scope_failed'
    }
  }
}
