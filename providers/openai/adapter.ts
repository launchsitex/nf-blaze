import OpenAI from 'openai'
import type { CallParams, CallResult, ModelAdapter, ProviderId, StreamEvent, Usage } from '../types'
import { normalizeProviderError } from '../errors'
import { assertTools, emptyUsage, resolveApiKey, stripModelPrefix } from '../resolve'
import {
  fromOpenAIAssistant,
  mapOpenAIStopReason,
  toOpenAIMessages,
  toOpenAITools
} from './convert'

function usageFromOpenAI(u?: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number } | null
}): Usage {
  const inputTokens = u?.prompt_tokens ?? 0
  const outputTokens = u?.completion_tokens ?? 0
  // OpenAI ממטמן אוטומטית קידומת יציבה מעל ~1024 טוקנים — אין סמנים,
  // רק דיווח. הקידומת אצלנו יציבה (system → כלים → היסטוריה).
  const cacheReadTokens = u?.prompt_tokens_details?.cached_tokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: u?.total_tokens ?? inputTokens + outputTokens,
    ...(cacheReadTokens ? { cacheReadTokens } : {})
  }
}

export interface OpenAICompatOptions {
  id: ProviderId
  /** Custom endpoint (Ollama / LM Studio / OpenRouter). Undefined = api.openai.com */
  baseURL?: string | (() => string)
  /** Extra headers (e.g. OpenRouter attribution) */
  defaultHeaders?: Record<string, string>
}

/**
 * Factory for OpenAI-compatible chat-completions adapters.
 * The same streaming/tool_use logic serves OpenAI itself and every
 * OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter).
 * Model ids may carry a `<provider>:` prefix — stripped before the API call.
 */
export function createOpenAICompatAdapter(opts: OpenAICompatOptions): ModelAdapter {
  const adapter: ModelAdapter = {
    id: opts.id,

    async call(params: CallParams): Promise<CallResult> {
      return adapter.stream(params, () => undefined)
    },

    async stream(
      params: CallParams,
      onEvent: (event: StreamEvent) => void
    ): Promise<CallResult> {
      try {
        const apiKey = resolveApiKey(opts.id, params.apiKey)
        const tools = assertTools(params.tools)
        const baseURL =
          typeof opts.baseURL === 'function' ? opts.baseURL() : opts.baseURL
        const client = new OpenAI({
          apiKey,
          ...(baseURL ? { baseURL } : {}),
          ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {})
        })
        const model = stripModelPrefix(params.model)
        const messages = toOpenAIMessages(params.system, params.messages)

        const stream = await client.chat.completions.create(
          {
            model,
            messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
            max_completion_tokens: params.maxTokens ?? 8192,
            temperature: params.temperature,
            stream: true,
            stream_options: { include_usage: true },
            ...(tools.length ? { tools: toOpenAITools(tools) } : {})
          },
          { signal: params.signal }
        )

        let text = ''
        let finishReason: string | null | undefined
        let usage = emptyUsage()
        const toolAcc = new Map<
          number,
          { id: string; name: string; arguments: string; pathHint?: string }
        >()

        for await (const chunk of stream) {
          if (params.signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }

          if (chunk.usage) {
            usage = usageFromOpenAI(chunk.usage)
            onEvent({ type: 'usage', usage })
          }

          const choice = chunk.choices[0]
          if (!choice) continue
          if (choice.finish_reason) finishReason = choice.finish_reason

          const delta = choice.delta
          if (delta?.content) {
            text += delta.content
            onEvent({ type: 'text', delta: delta.content })
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              const cur = toolAcc.get(idx) || { id: '', name: '', arguments: '' }
              if (tc.id) cur.id = tc.id
              if (tc.function?.name) cur.name += tc.function.name
              if (tc.function?.arguments) {
                cur.arguments += tc.function.arguments
                if (!cur.pathHint) {
                  const m = cur.arguments.match(/"path"\s*:\s*"([^"]+)"/)
                  if (m) cur.pathHint = m[1]
                }
                onEvent({
                  type: 'tool_progress',
                  name: cur.name,
                  argChars: cur.arguments.length,
                  pathHint: cur.pathHint
                })
              }
              toolAcc.set(idx, cur)
            }
          }
        }

        const assembled = fromOpenAIAssistant({
          content: text,
          tool_calls: [...toolAcc.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => ({
              id: v.id || `call_${Math.random().toString(36).slice(2, 10)}`,
              function: { name: v.name, arguments: v.arguments }
            }))
        })

        for (const tc of assembled.toolCalls) {
          onEvent({ type: 'tool_call', toolCall: tc })
        }

        const result: CallResult = {
          text: assembled.text,
          toolCalls: assembled.toolCalls,
          stopReason: mapOpenAIStopReason(finishReason),
          usage
        }
        onEvent({ type: 'done', result })
        return result
      } catch (err) {
        const normalized = normalizeProviderError(err, opts.id)
        onEvent({ type: 'error', error: normalized })
        throw normalized
      }
    }
  }
  return adapter
}

export const openaiAdapter: ModelAdapter = createOpenAICompatAdapter({ id: 'openai' })
