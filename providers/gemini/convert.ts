/**
 * Convert unified messages ↔ Gemini Generative AI format
 * - system via `systemInstruction`
 * - tools via `functionDeclarations`
 * - roles: user / model (assistant → model)
 * - tool results: functionResponse on a user turn
 *
 * Gemini accepts only a narrow OpenAPI subset for tool parameters —
 * full JSON Schema (additionalProperties, $ref, …) must be stripped here.
 */
import type { ToolCall, ToolDefinition, UnifiedMessage } from '../types'
import { parseToolArguments } from '../resolve'

export type GeminiPart =
  | { text: string }
  | {
      functionCall: { name: string; args?: Record<string, unknown> }
      /** Gemini 3 — חתימת חשיבה שמוחזרת עם ה-functionCall */
      thoughtSignature?: string
    }
  | {
      functionResponse: {
        name: string
        response: Record<string, unknown>
      }
    }

export type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/** Fields Gemini function-declaration schemas accept (whitelist). */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'nullable'
])

/**
 * Recursively strip unsupported JSON Schema / OpenAPI fields for Gemini.
 * Whitelist only — anything else (additionalProperties, $ref, default, …) is dropped.
 */
export function cleanGeminiSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined

  const src = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const key of Object.keys(src)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue
    const val = src[key]

    if (key === 'properties') {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue
      const props: Record<string, unknown> = {}
      for (const [name, propSchema] of Object.entries(val as Record<string, unknown>)) {
        const cleaned = cleanGeminiSchema(propSchema)
        if (cleaned) props[name] = cleaned
      }
      out.properties = props
      continue
    }

    if (key === 'items') {
      if (Array.isArray(val)) {
        // Gemini expects a single schema object for items
        const first = val.map(cleanGeminiSchema).find(Boolean)
        if (first) out.items = first
      } else {
        const cleaned = cleanGeminiSchema(val)
        if (cleaned) out.items = cleaned
      }
      continue
    }

    if (key === 'required') {
      if (Array.isArray(val)) {
        out.required = val.filter((x): x is string => typeof x === 'string')
      }
      continue
    }

    if (key === 'enum') {
      if (Array.isArray(val)) out.enum = val
      continue
    }

    if (key === 'nullable') {
      if (typeof val === 'boolean') out.nullable = val
      continue
    }

    // type, description
    if (val !== undefined) out[key] = val
  }

  // Keep required in sync with surviving properties
  if (Array.isArray(out.required) && out.properties && typeof out.properties === 'object') {
    const propNames = new Set(Object.keys(out.properties as Record<string, unknown>))
    out.required = (out.required as string[]).filter((r) => propNames.has(r))
    if ((out.required as string[]).length === 0) delete out.required
  }

  return out
}

function hasNonEmptyProperties(schema: Record<string, unknown> | undefined): boolean {
  if (!schema?.properties || typeof schema.properties !== 'object') return false
  if (Array.isArray(schema.properties)) return false
  return Object.keys(schema.properties as Record<string, unknown>).length > 0
}

export function toGeminiTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => {
        const cleaned = cleanGeminiSchema(t.parameters)
        const decl: {
          name: string
          description: string
          parameters?: Record<string, unknown>
        } = {
          name: t.name,
          description: t.description || ''
        }
        // Gemini rejects empty parameters objects — omit the field entirely
        if (cleaned && hasNonEmptyProperties(cleaned)) {
          decl.parameters = cleaned
        }
        return decl
      })
    }
  ]
}

export function toGeminiContents(messages: UnifiedMessage[]): GeminiContent[] {
  const out: GeminiContent[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const parts: GeminiPart[] = []
      for (const part of msg.content) {
        if (part.type === 'text') parts.push({ text: part.text })
        if (part.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: part.name || 'tool',
              response: {
                result: part.content,
                ...(part.isError ? { error: true } : {})
              }
            }
          })
        }
      }
      if (parts.length) out.push({ role: 'user', parts })
      continue
    }

    if (msg.role === 'assistant') {
      const parts: GeminiPart[] = []
      for (const part of msg.content) {
        if (part.type === 'text') parts.push({ text: part.text })
        if (part.type === 'tool_use') {
          parts.push({
            functionCall: {
              name: part.name,
              args: part.arguments ?? {}
            },
            // Gemini 3 מחייב thought_signature על functionCall שמוחזר בהיסטוריה
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {})
          } as GeminiPart)
        }
      }
      if (parts.length) out.push({ role: 'model', parts })
      continue
    }

    if (msg.role === 'tool') {
      const parts: GeminiPart[] = []
      for (const part of msg.content) {
        if (part.type !== 'tool_result') continue
        parts.push({
          functionResponse: {
            name: part.name || 'tool',
            response: {
              result: part.content,
              toolCallId: part.toolCallId,
              ...(part.isError ? { error: true } : {})
            }
          }
        })
      }
      if (parts.length) out.push({ role: 'user', parts })
    }
  }

  return out
}

export function fromGeminiParts(
  parts: Array<{
    text?: string
    functionCall?: { name?: string; args?: Record<string, unknown> }
    /** Gemini 3 — חובה להחזיר את החתימה עם ה-functionCall בהיסטוריה */
    thoughtSignature?: string
  }>,
  idPrefix = 'gemini'
): { text: string; toolCalls: ToolCall[] } {
  let text = ''
  const toolCalls: ToolCall[] = []
  let i = 0
  for (const part of parts || []) {
    if (part.text) text += part.text
    if (part.functionCall?.name) {
      i += 1
      const args = part.functionCall.args
      toolCalls.push({
        id: `${idPrefix}-fc-${i}`,
        name: part.functionCall.name,
        arguments:
          args && typeof args === 'object'
            ? args
            : parseToolArguments(JSON.stringify(args ?? {})),
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {})
      })
    }
  }
  return { text, toolCalls }
}

export function mapGeminiFinishReason(
  reason: string | null | undefined,
  hasToolCalls: boolean
): 'end' | 'tool_use' | 'length' | 'content_filter' | 'error' {
  if (hasToolCalls) return 'tool_use'
  switch (reason) {
    case 'MAX_TOKENS':
      return 'length'
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter'
    case 'STOP':
    case 'OTHER':
    default:
      return 'end'
  }
}
