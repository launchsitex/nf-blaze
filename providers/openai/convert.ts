/**
 * Convert unified messages ↔ OpenAI Chat Completions format
 * - system is a first message (handled by adapter, not here)
 * - tools use `parameters`
 * - tool results use role=tool
 */
import type { ToolCall, ToolDefinition, UnifiedMessage } from '../types'
import { parseToolArguments } from '../resolve'

export type OpenAIChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.parameters
    }
  }))
}

export function toOpenAIMessages(
  system: string | undefined,
  messages: UnifiedMessage[]
): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = []
  if (system?.trim()) {
    out.push({ role: 'system', content: system })
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('')
      // OpenAI: tool results that arrived as user-wrapped are unusual; prefer role=tool
      const toolResults = msg.content.filter((c) => c.type === 'tool_result')
      if (toolResults.length && !text) {
        for (const tr of toolResults) {
          if (tr.type !== 'tool_result') continue
          out.push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: tr.isError ? `ERROR: ${tr.content}` : tr.content
          })
        }
        continue
      }
      out.push({ role: 'user', content: text })
      continue
    }

    if (msg.role === 'assistant') {
      const textParts = msg.content.filter((c) => c.type === 'text')
      const toolUses = msg.content.filter((c) => c.type === 'tool_use')
      const content =
        textParts.map((c) => (c.type === 'text' ? c.text : '')).join('') || null
      const tool_calls =
        toolUses.length > 0
          ? toolUses.map((c) => {
              if (c.type !== 'tool_use') throw new Error('invariant')
              return {
                id: c.id,
                type: 'function' as const,
                function: {
                  name: c.name,
                  arguments: JSON.stringify(c.arguments ?? {})
                }
              }
            })
          : undefined
      out.push({
        role: 'assistant',
        content,
        ...(tool_calls ? { tool_calls } : {})
      })
      continue
    }

    if (msg.role === 'tool') {
      for (const part of msg.content) {
        if (part.type !== 'tool_result') continue
        out.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          content: part.isError ? `ERROR: ${part.content}` : part.content
        })
      }
    }
  }

  return out
}

export function fromOpenAIAssistant(message: {
  content?: string | null
  tool_calls?: Array<{
    id: string
    function?: { name?: string; arguments?: string }
  }>
}): { text: string; toolCalls: ToolCall[] } {
  const text = message.content ?? ''
  const toolCalls: ToolCall[] = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name || '',
    arguments: parseToolArguments(tc.function?.arguments || '')
  }))
  return { text, toolCalls }
}

export function mapOpenAIStopReason(
  reason: string | null | undefined
): 'end' | 'tool_use' | 'length' | 'content_filter' | 'error' {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'length':
      return 'length'
    case 'content_filter':
      return 'content_filter'
    case 'stop':
    default:
      return 'end'
  }
}
