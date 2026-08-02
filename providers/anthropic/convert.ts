/**
 * Convert unified messages ↔ Anthropic Messages API format
 * - system is a top-level request parameter (not a message)
 * - tools use `input_schema`
 * - tool_result blocks live inside a **user** message
 */
import type { ToolCall, ToolDefinition, UnifiedMessage } from '../types'
import { parseToolArguments } from '../resolve'
import { pickCacheBreakpoints } from '../cache'

/** סמן מטמון של Anthropic — נדבק לבלוק האחרון של קטע יציב */
export type CacheControl = { type: 'ephemeral' }

export type AnthropicContentBlock = (
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error?: boolean
    }
) & { cache_control?: CacheControl }

export type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export function toAnthropicTools(tools: ToolDefinition[], cache = false) {
  return tools.map((t, i) => {
    const schema = { ...t.parameters } as Record<string, unknown>
    if (!schema.type) schema.type = 'object'
    return {
      name: t.name,
      description: t.description || '',
      input_schema: schema as {
        type: 'object'
        properties?: Record<string, unknown>
        required?: string[]
      },
      // הסמן על הכלי האחרון ממטמן את **כל** בלוק ההגדרות שלפניו
      ...(cache && i === tools.length - 1
        ? { cache_control: { type: 'ephemeral' as const } }
        : {})
    }
  })
}

/** הפרומפט כמערך בלוקים — הצורה היחידה שמאפשרת סמן מטמון על ה-system */
export function toAnthropicSystem(
  system: string | undefined,
  cache: boolean
): string | Array<{ type: 'text'; text: string; cache_control?: CacheControl }> | undefined {
  const text = system?.trim()
  if (!text) return undefined
  if (!cache) return text
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

/**
 * מוסיף סמני מטמון להיסטוריה — נקודה מתגלגלת בסוף + נקודות ביניים,
 * כדי שסבב עמוס בלוקים לא יחרוג מחלון המבט לאחור של Anthropic.
 *
 * @param reserved כמה נקודות שבירה כבר תפוסות (system + tools)
 */
export function withMessageCacheControl(
  messages: AnthropicMessage[],
  reserved: number
): AnthropicMessage[] {
  const counts = messages.map((m) => (Array.isArray(m.content) ? m.content.length : 1))
  const marks = pickCacheBreakpoints(counts, reserved)
  if (!marks.size) return messages

  return messages.map((m, i) => {
    if (!marks.has(i) || !Array.isArray(m.content) || !m.content.length) return m
    const content = m.content.map((block, j) =>
      j === m.content.length - 1
        ? { ...block, cache_control: { type: 'ephemeral' as const } }
        : block
    )
    return { ...m, content }
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
