import type {
  MessageContent,
  ToolDefinition,
  UnifiedMessage
} from './types'

export function textMessage(
  role: 'user' | 'assistant',
  text: string
): UnifiedMessage {
  return { role, content: [{ type: 'text', text }] }
}

export function extractText(message: UnifiedMessage): string {
  return message.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

export function flattenText(messages: UnifiedMessage[]): string {
  return messages.map(extractText).join('\n')
}

export function ensureContentArray(
  content: string | MessageContent[]
): MessageContent[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

import type { ProviderId } from './types'

/** ספקים מקומיים — רצים על המחשב, לא דורשים מפתח API אמיתי */
export function isLocalProvider(provider: ProviderId): boolean {
  return provider === 'ollama' || provider === 'lmstudio'
}

/** Resolve which env var holds the API key for a provider */
export function envKeyName(provider: ProviderId): string {
  if (provider === 'openai') return 'OPENAI_API_KEY'
  if (provider === 'anthropic') return 'ANTHROPIC_API_KEY'
  if (provider === 'openrouter') return 'OPENROUTER_API_KEY'
  if (provider === 'ollama') return 'OLLAMA_API_KEY'
  if (provider === 'lmstudio') return 'LMSTUDIO_API_KEY'
  return 'GEMINI_API_KEY'
}

export function resolveApiKey(provider: ProviderId, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim()
  const fromEnv = process.env[envKeyName(provider)]
  if (fromEnv?.trim()) return fromEnv.trim()
  // מקומיים לא צריכים מפתח — ה-SDK דורש מחרוזת לא ריקה, אז שולחים placeholder
  if (isLocalProvider(provider)) return 'local'
  throw new Error(`חסר apiKey עבור ${provider} (או משתנה ${envKeyName(provider)})`)
}

const MODEL_PREFIXES: Array<[string, ProviderId]> = [
  ['ollama:', 'ollama'],
  ['lmstudio:', 'lmstudio'],
  ['openrouter:', 'openrouter']
]

/** Strip a `<provider>:` prefix (ollama:/lmstudio:/openrouter:) from a model id */
export function stripModelPrefix(model: string): string {
  const trimmed = model.trim()
  const lower = trimmed.toLowerCase()
  for (const [prefix] of MODEL_PREFIXES) {
    if (lower.startsWith(prefix)) return trimmed.slice(prefix.length)
  }
  return trimmed
}

/**
 * Infer provider from model id so callers never pass a provider name.
 * `ollama:` / `lmstudio:` / `openrouter:` prefixes win;
 * otherwise gpt-* / o* → openai · claude-* → anthropic · gemini-* → gemini
 */
export function resolveProviderFromModel(model: string): ProviderId {
  const id = model.trim().toLowerCase()
  for (const [prefix, provider] of MODEL_PREFIXES) {
    if (id.startsWith(prefix)) return provider
  }
  if (id.startsWith('claude-')) return 'anthropic'
  if (id.startsWith('gemini-')) return 'gemini'
  if (
    id.startsWith('gpt-') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.startsWith('chatgpt-')
  ) {
    return 'openai'
  }
  throw new Error(
    `לא ניתן לזהות ספק מהמודל "${model}". השתמש ב-gpt-*, claude-*, gemini-*, או קידומת ollama:/lmstudio:/openrouter:.`
  )
}

export function emptyUsage(): { inputTokens: number; outputTokens: number; totalTokens: number } {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return { _raw: raw }
  }
}

export function assertTools(tools?: ToolDefinition[]): ToolDefinition[] {
  if (!tools?.length) return []
  for (const t of tools) {
    if (!t.name?.trim()) throw new Error('tool.name נדרש')
    if (!t.parameters || typeof t.parameters !== 'object') {
      throw new Error(`tool.parameters נדרש עבור ${t.name}`)
    }
  }
  return tools
}
