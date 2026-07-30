import Anthropic from '@anthropic-ai/sdk'
import type { CallParams, CallResult, ModelAdapter, StreamEvent, Usage } from '../types'
import { normalizeProviderError } from '../errors'
import { assertTools, resolveApiKey } from '../resolve'
import {
  fromAnthropicContent,
  mapAnthropicStopReason,
  toAnthropicMessages,
  toAnthropicTools
} from './convert'

function usageFromAnthropic(u?: {
  input_tokens?: number
  output_tokens?: number
}): Usage {
  const inputTokens = u?.input_tokens ?? 0
  const outputTokens = u?.output_tokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  }
}

export const anthropicAdapter: ModelAdapter = {
  id: 'anthropic',

  async call(params: CallParams): Promise<CallResult> {
    return anthropicAdapter.stream(params, () => undefined)
  },

  async stream(params: CallParams, onEvent: (event: StreamEvent) => void): Promise<CallResult> {
    try {
      const apiKey = resolveApiKey('anthropic', params.apiKey)
      const tools = assertTools(params.tools)
      const client = new Anthropic({ apiKey })
      const messages = toAnthropicMessages(params.messages)

      const stream = client.messages.stream(
        {
          model: params.model,
          max_tokens: params.maxTokens ?? 8192,
          temperature: params.temperature,
          system: params.system?.trim() || undefined,
          messages: messages as Anthropic.MessageParam[],
          ...(tools.length ? { tools: toAnthropicTools(tools) as Anthropic.Tool[] } : {})
        },
        { signal: params.signal }
      )

      stream.on('text', (delta: string) => {
        onEvent({ type: 'text', delta })
      })

      // התקדמות חיה בזמן שהמודל כותב ארגומנטים של כלי (קבצים ארוכים = דקות של שקט בלי זה)
      let progressToolName = ''
      let progressArgs = ''
      let progressPathHint: string | undefined
      stream.on('streamEvent', (event) => {
        const ev = event as {
          type: string
          content_block?: { type?: string; name?: string }
          delta?: { type?: string; partial_json?: string }
        }
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          progressToolName = ev.content_block.name || ''
          progressArgs = ''
          progressPathHint = undefined
        } else if (
          ev.type === 'content_block_delta' &&
          ev.delta?.type === 'input_json_delta' &&
          typeof ev.delta.partial_json === 'string'
        ) {
          progressArgs += ev.delta.partial_json
          if (!progressPathHint) {
            const m = progressArgs.match(/"path"\s*:\s*"([^"]+)"/)
            if (m) progressPathHint = m[1]
          }
          onEvent({
            type: 'tool_progress',
            name: progressToolName,
            argChars: progressArgs.length,
            pathHint: progressPathHint
          })
        }
      })

      const final = await stream.finalMessage()
      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const assembled = fromAnthropicContent(
        (final.content || []) as Array<{
          type: string
          text?: string
          id?: string
          name?: string
          input?: unknown
        }>
      )

      for (const tc of assembled.toolCalls) {
        onEvent({ type: 'tool_call', toolCall: tc })
      }

      const usage = usageFromAnthropic(final.usage)
      onEvent({ type: 'usage', usage })

      const result: CallResult = {
        text: assembled.text,
        toolCalls: assembled.toolCalls,
        stopReason: mapAnthropicStopReason(final.stop_reason),
        usage
      }
      onEvent({ type: 'done', result })
      return result
    } catch (err) {
      const normalized = normalizeProviderError(err, 'anthropic')
      onEvent({ type: 'error', error: normalized })
      throw normalized
    }
  }
}
