/**
 * Work-mode intent detection.
 * Short call to a fast model → ASK | PLAN | BUILD (doubt → ASK).
 */
import { call, resolveProviderFromModel } from '../providers'

export type WorkMode = 'ASK' | 'PLAN' | 'BUILD'

/** Manual override from the UI, or `auto` to run detection */
export type WorkModeSelection = WorkMode | 'auto'

const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'grep', 'web_search', 'web_fetch'])
// כלי מטא — לא נוגעים בקבצי הפרויקט; מותרים גם בתכנון (שמירת תוכנית/החלטות)
const META_TOOLS = new Set(['update_plan', 'save_memory'])

export const INTENT_SYSTEM = `You classify a coding-agent user request into exactly one intent.
Return ONLY valid JSON: {"intent":"ASK"} or {"intent":"PLAN"} or {"intent":"BUILD"}

Definitions (Hebrew and English):
- ASK — question, recommendation, opinion, review, explanation; phrases like "מה אתה חושב", "מה עוד כדאי", "מה דעתך", "למה", "how does X work". No code changes requested.
- PLAN — user wants a plan/design/approach before changing code; phrases like "תכנן", "מה הדרך הכי טובה", "איך הייתי עושה", "תכנון". No implementation yet.
- BUILD — explicit instruction to create/edit files, fix bugs, implement features, run commands ("תוסיף", "תתקן", "תיישם", "build", "fix", "add").

When unsure, always choose ASK. Prefer ASK over BUILD if the user might only want advice.`

/** Fast model per provider family of the user's selected model */
export function pickFastIntentModel(userModel: string): string {
  try {
    const provider = resolveProviderFromModel(userModel)
    if (provider === 'openai') return 'gpt-5.6-luna'
    if (provider === 'anthropic') return 'claude-haiku-4-5-20251001'
    if (provider === 'gemini') return 'gemini-2.5-flash-lite'
    // מקומיים / OpenRouter — אין «אח מהיר» מובטח; משתמשים באותו מודל
    return userModel
  } catch {
    return 'gemini-2.5-flash-lite'
  }
}

/** Same-provider fast sibling for legacy callLlm (avoids cross-provider key mismatch). */
export function pickFastIntentModelForProvider(
  provider: 'openai' | 'anthropic' | 'gemini'
): string {
  if (provider === 'openai') return 'gpt-5.6-luna'
  if (provider === 'anthropic') return 'claude-haiku-4-5-20251001'
  return 'gemini-2.5-flash-lite'
}

export function parseIntentJson(raw: string): WorkMode {
  const trimmed = (raw || '').trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  const body = jsonMatch ? jsonMatch[0] : trimmed
  try {
    const parsed = JSON.parse(body) as { intent?: string }
    const intent = String(parsed.intent || '')
      .trim()
      .toUpperCase()
    if (intent === 'ASK' || intent === 'PLAN' || intent === 'BUILD') {
      return intent
    }
  } catch {
    /* fall through */
  }
  // Loose fallback from plain text
  if (/\bBUILD\b/i.test(trimmed) && !/\bASK\b/i.test(trimmed)) return 'BUILD'
  if (/\bPLAN\b/i.test(trimmed)) return 'PLAN'
  return 'ASK'
}

/**
 * Detect intent via a short fast-model call.
 * On any failure or ambiguity → ASK.
 * Optional `complete` lets the legacy path use callLlm with the same provider key.
 */
export async function detectWorkMode(opts: {
  userMessage: string
  /** User-selected model (used to pick a fast sibling) */
  model: string
  apiKey?: string
  signal?: AbortSignal
  /** Optional text completion — preferred when provided (legacy / same-provider). */
  complete?: (args: {
    system: string
    user: string
    model: string
    signal?: AbortSignal
  }) => Promise<string>
}): Promise<WorkMode> {
  const message = opts.userMessage.trim()
  if (!message) return 'ASK'

  try {
    if (opts.complete) {
      const fastModel = opts.model
      const text = await opts.complete({
        system: INTENT_SYSTEM,
        user: message.slice(0, 4000),
        model: fastModel,
        signal: opts.signal
      })
      return parseIntentJson(text || '')
    }

    const fastModel = pickFastIntentModel(opts.model)
    const result = await call({
      model: fastModel,
      apiKey: opts.apiKey,
      system: INTENT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: message.slice(0, 4000) }]
        }
      ],
      tools: [],
      maxTokens: 64,
      temperature: 0,
      signal: opts.signal
    })
    return parseIntentJson(result.text || '')
  } catch {
    return 'ASK'
  }
}

/** Resolve manual override vs auto-detection. Missing / invalid → ASK. Manual always wins. */
export async function resolveWorkMode(opts: {
  selection?: WorkModeSelection | null
  userMessage: string
  model: string
  apiKey?: string
  signal?: AbortSignal
  complete?: (args: {
    system: string
    user: string
    model: string
    signal?: AbortSignal
  }) => Promise<string>
}): Promise<{ mode: WorkMode; source: 'manual' | 'auto' }> {
  const selection = opts.selection
  if (
    selection !== 'auto' &&
    selection !== 'ASK' &&
    selection !== 'PLAN' &&
    selection !== 'BUILD'
  ) {
    return { mode: 'ASK', source: 'manual' }
  }
  if (selection !== 'auto') {
    return { mode: selection, source: 'manual' }
  }
  const mode = await detectWorkMode(opts)
  return { mode, source: 'auto' }
}

export function isReadOnlyMode(mode: WorkMode): boolean {
  return mode === 'ASK' || mode === 'PLAN'
}

export function isWriteToolName(name: string): boolean {
  // כלי MCP חיצוניים (mcp_*) אינם כלי כתיבה לקבצי הפרויקט
  if (name.startsWith('mcp_')) return false
  return !READ_ONLY_TOOLS.has(name) && !META_TOOLS.has(name)
}

/** Filter tool definitions for the active mode (ASK = read-only; PLAN = read-only + plan/memory) */
export function filterToolsForMode<T extends { name: string }>(
  tools: T[],
  mode: WorkMode
): T[] {
  if (mode === 'BUILD') return tools
  if (mode === 'PLAN') {
    return tools.filter((t) => READ_ONLY_TOOLS.has(t.name) || META_TOOLS.has(t.name))
  }
  return tools.filter((t) => READ_ONLY_TOOLS.has(t.name))
}

export function modeSystemAppendix(mode: WorkMode): string {
  if (mode === 'ASK') {
    return [
      '',
      '## מצב עבודה: שאלה',
      'המשתמש בחר מצב שאלה. אתה לא יכול לשנות קבצים בבקשה הזו.',
      "קרא את הפרויקט וענה לו במילים בלבד. אל תכתוב 'אני אצור' או 'אני אוסיף' — אין לך אפשרות כזו כרגע.",
      'כלים מותרים בלבד: read_file, list_dir, grep.',
      'אל תקרא ל-edit_file, write_file, declare_scope, או run_command.'
    ].join('\n')
  }
  if (mode === 'PLAN') {
    return [
      '',
      '## מצב עבודה: תכנון',
      'המשתמש בחר מצב תכנון. אתה לא יכול לשנות קבצים בבקשה הזו.',
      "קרא את הפרויקט וענה לו במילים בלבד. אל תכתוב 'אני אצור' או 'אני אוסיף' — אין לך אפשרות כזו כרגע.",
      'הפלט הוא תוכנית ממוספרת בלבד, בלי קוד — או שאלות הבהרה אם חסר מידע מהותי.',
      'אם חסר מידע: פלוט JSON עם {"type":"clarify","questions":[{"q":"...","options":["א","ב"],"multi":false}]} בלבד (מקסימום 3 שאלות, עדיף 1).',
      'קודם קרא את הפרויקט; אל תשאל על מה שכבר ברור מהקוד. סבב שאלות אחד בלבד.',
      'אחרי שגיבשת תוכנית לבנייה גדולה — שמור אותה עם update_plan (goal + שלבים) כדי שסבב הביצוע ימשיך ממנה.',
      'כלים מותרים בלבד: read_file, list_dir, grep, update_plan, save_memory.',
      'אל תקרא ל-edit_file, write_file, declare_scope, או run_command.'
    ].join('\n')
  }
  return [
    '',
    '## Work mode: BUILD',
    'Implement the request. Use declare_scope before edits, read before edit_file, and finish only when checks pass.',
    'Large multi-part request → first call update_plan with stages, then implement stage by stage, updating stage status as you go.',
    'An existing plan in the system prompt means you are mid-build: continue from the first non-done stage.',
    'Before finishing: update_plan with final statuses, and save_memory with decisions the next turn must know (architecture, schemas, conventions).'
  ].join('\n')
}
