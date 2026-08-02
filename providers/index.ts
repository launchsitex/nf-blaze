import type { CallParams, CallResult, ModelAdapter, ProviderId, StreamEvent } from './types'
import { resolveProviderFromModel } from './resolve'
import { openaiAdapter } from './openai/adapter'
import { anthropicAdapter } from './anthropic/adapter'
import { geminiAdapter } from './gemini/adapter'
import { ollamaAdapter, lmstudioAdapter, openrouterAdapter } from './compat'

const ADAPTERS: Record<ProviderId, ModelAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
  lmstudio: lmstudioAdapter,
  openrouter: openrouterAdapter
}

/** Get adapter by provider id (agent code should prefer `call` / `stream`) */
export function getAdapter(provider: ProviderId): ModelAdapter {
  const adapter = ADAPTERS[provider]
  if (!adapter) throw new Error(`ספק לא נתמך: ${provider}`)
  return adapter
}

/**
 * Unified non-streaming call.
 * Provider is inferred from `model` — callers never pass openai/anthropic/gemini.
 *
 * @example
 * ```ts
 * const result = await call({
 *   model: 'claude-sonnet-5',
 *   system: 'You are helpful',
 *   messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
 *   tools: [],
 *   apiKey: process.env.ANTHROPIC_API_KEY
 * })
 * // → { text, toolCalls, stopReason, usage }
 * ```
 */
export async function call(params: CallParams): Promise<CallResult> {
  const provider = resolveProviderFromModel(params.model)
  return getAdapter(provider).call(params)
}

/**
 * Unified streaming call — same request shape as `call`.
 * Emits normalized StreamEvent; returns the final CallResult.
 */
export async function stream(
  params: CallParams,
  onEvent: (event: StreamEvent) => void
): Promise<CallResult> {
  const provider = resolveProviderFromModel(params.model)
  return getAdapter(provider).stream(params, onEvent)
}

export type {
  CallParams,
  CallResult,
  ModelAdapter,
  MessageContent,
  NormalizedProviderError,
  ProviderId,
  StopReason,
  StreamEvent,
  ToolCall,
  ToolDefinition,
  UnifiedMessage,
  Usage
} from './types'

export { ProviderError, normalizeProviderError } from './errors'
export {
  resolveProviderFromModel,
  stripModelPrefix,
  isLocalProvider,
  textMessage,
  extractText,
  resolveApiKey
} from './resolve'

export {
  repairToolArguments,
  coerceArgumentsToSchema,
  type RepairKind,
  type RepairResult
} from './repair'
export {
  pickCacheBreakpoints,
  worthCaching,
  CACHE_LOOKBACK_BLOCKS,
  MAX_CACHE_BREAKPOINTS
} from './cache'

export { ollamaAdapter, lmstudioAdapter, openrouterAdapter } from './compat'

export { toOpenAIMessages, toOpenAITools, fromOpenAIAssistant } from './openai/convert'
export {
  toAnthropicMessages,
  toAnthropicTools,
  fromAnthropicContent
} from './anthropic/convert'
export { toGeminiContents, toGeminiTools, fromGeminiParts } from './gemini/convert'

export { openaiAdapter } from './openai/adapter'
export { anthropicAdapter } from './anthropic/adapter'
export { geminiAdapter } from './gemini/adapter'
