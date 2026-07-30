/**
 * Convert unified messages ↔ Anthropic Messages API format
 * - system is a top-level request parameter (not a message)
 * - tools use `input_schema`
 * - tool_result blocks live inside a **user** message
 */
import type { ToolCall, ToolDefinition, UnifiedMessage } from '../types'
import { parseToolArguments } from '../resolve'

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error?: boolean
    }

export type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const schema = { ...t.parameters } as Record<string, unknown>
    if (!schema.type) schema.type = 'object'
    return {
      name: t.name,
      description: t.description || '',
      input_schema: schema as {
        type: 'object'
        properties?: Record<string, unknown>
        required?: string[]
      }
    }
  })
}

export function toAnthropicMessages(messages: UnifiedMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const blocks: AnthropicContentBlock[] = []
      for (const part of msg.content) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text })
        } else if (part.type === 'tool_result') {
          blocks.push({
            type: 'tool_result',
            tool_use_id: part.toolCallId,
            content: part.content,
            is_error: part.isError
          })
        }
      }
      if (blocks.length) out.push({ role: 'user', content: blocks })
      continue
    }

    if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      for (const part of msg.content) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text })
        } else if (part.type === 'tool_use') {
          blocks.push({
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.arguments ?? {}
          })
        }
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks })
      continue
    }

    if (msg.role === 'tool') {
      // Anthropic requires tool_result inside user turn
      const blocks: AnthropicContentBlock[] = []
      for (const part of msg.content) {
        if (part.type !== 'tool_result') continue
        blocks.push({
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: part.content,
          is_error: part.isError
        })
      }
      if (blocks.length) out.push({ role: 'user', content: blocks })
    }
  }

  return mergeAdjacentSameRole(out)
}

function mergeAdjacentSameRole(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = []
  for (const m of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role && Array.isArray(last.content) && Array.isArray(m.content)) {
      last.content = [...last.content, ...m.content]
    } else {
      merged.push({
        role: m.role,
        content: Array.isArray(m.content) ? [...m.content] : m.content
      })
    }
  }
  return merged
}

export function fromAnthropicContent(
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>
): { text: string; toolCalls: ToolCall[] } {
  let text = ''
  const toolCalls: ToolCall[] = []
  for (const block of content || []) {
    if (block.type === 'text' && block.text) text += block.text
    if (block.type === 'tool_use' && block.id && block.name) {
      const input =
        block.input && typeof block.input === 'object' && !Array.isArray(block.input)
          ? (block.input as Record<string, unknown>)
          : parseToolArguments(JSON.stringify(block.input ?? {}))
      toolCalls.push({ id: block.id, name: block.name, arguments: input })
    }
  }
  return { text, toolCalls }
}

export function mapAnthropicStopReason(
  reason: string | null | undefined
): 'end' | 'tool_use' | 'length' | 'content_filter' | 'error' {
  switch (reason) {
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'length'
    case 'refusal':
      return 'content_filter'
    case 'end_turn':
    case 'stop_sequence':
    case 'pause_turn':
    default:
      return 'end'
  }
}
