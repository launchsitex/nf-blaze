/** Unified provider-agnostic types for model adapters */

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'

export type StopReason = 'end' | 'tool_use' | 'length' | 'content_filter' | 'error' | 'aborted'

export interface Usage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** טוקנים שנקראו ממטמון הפרומפט (עלות ~10% מקלט רגיל) */
  cacheReadTokens?: number
  /** טוקנים שנכתבו למטמון בסבב הזה (חד-פעמי) */
  cacheWriteTokens?: number
}

/** JSON-Schema style parameters (provider adapters translate as needed) */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  /** Gemini 3: חתימת חשיבה שחובה להחזיר עם ה-functionCall בהיסטוריה */
  thoughtSignature?: string
}

export type TextContent = { type: 'text'; text: string }

export type ToolUseContent = {
  type: 'tool_use'
  id: string
  name: string
  arguments: Record<string, unknown>
  /** Gemini 3: חתימת חשיבה שחובה להחזיר עם ה-functionCall בהיסטוריה */
  thoughtSignature?: string
}

export type ToolResultContent = {
  type: 'tool_result'
  toolCallId: string
  /** Tool name — required by some providers (Gemini) */
  name?: string
  content: string
  isError?: boolean
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent

/**
 * Internal unified message format.
 * Adapters convert this to/from OpenAI / Anthropic / Gemini shapes.
 */
export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'tool'
  content: MessageContent[]
}

export interface CallParams {
  model: string
  system?: string
  messages: UnifiedMessage[]
  tools?: ToolDefinition[]
  /** Required unless the matching `*_API_KEY` / `OPENAI_API_KEY` env is set */
  apiKey?: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface CallResult {
  text: string
  toolCalls: ToolCall[]
  stopReason: StopReason
  usage: Usage
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  /** התקדמות בזמן שהמודל מזרים ארגומנטים של כלי (כתיבת קובץ ארוך) — לנראות חיה */
  | { type: 'tool_progress'; name: string; argChars: number; pathHint?: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'error'; error: NormalizedProviderError }
  | { type: 'done'; result: CallResult }

export interface NormalizedProviderError {
  code:
    | 'rate_limit'
    | 'auth'
    | 'invalid_request'
    | 'server'
    | 'timeout'
    | 'aborted'
    | 'unknown'
  message: string
  provider: ProviderId
  status?: number
  retryable: boolean
  /** Suggested wait before retry (from Retry-After / provider hints) */
  retryAfterMs?: number
  cause?: unknown
}

export interface ModelAdapter {
  readonly id: ProviderId
  call(params: CallParams): Promise<CallResult>
  stream(params: CallParams, onEvent: (event: StreamEvent) => void): Promise<CallResult>
}
