import type {
  AiProvider,
  AgentResponse,
  AgentFileAction,
  ClarifyBlock,
  ClarifyQuestion
} from '../../../shared/types'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallOptions {
  provider: AiProvider
  model: string
  apiKey: string
  messages: LlmMessage[]
  maxTokens?: number
  /** Called for each text chunk while streaming */
  onToken?: (chunk: string) => void
  signal?: AbortSignal
}

export async function callLlm(options: LlmCallOptions): Promise<string> {
  switch (options.provider) {
    case 'openai':
      return callOpenAI(options)
    case 'anthropic':
      return callAnthropic(options)
    case 'gemini':
      return callGemini(options)
    default:
      throw new Error('ספק AI לא נתמך')
  }
}

async function callOpenAI(options: LlmCallOptions): Promise<string> {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: options.apiKey })
  const stream = await client.chat.completions.create(
    {
      model: options.model,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content
      })),
      max_completion_tokens: options.maxTokens ?? 16384,
      stream: true
    },
    { signal: options.signal }
  )

  let text = ''
  for await (const chunk of stream) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      text += delta
      options.onToken?.(delta)
    }
  }
  if (!text && options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!text) throw new Error('תשובה ריקה מ-OpenAI')
  return text
}

async function callAnthropic(options: LlmCallOptions): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: options.apiKey })
  const system = options.messages.find((m) => m.role === 'system')?.content
  const msgs = options.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: options.maxTokens ?? 16384,
      system: system || undefined,
      messages: msgs
    },
    { signal: options.signal }
  )

  let text = ''
  stream.on('text', (delta: string) => {
    text += delta
    options.onToken?.(delta)
  })

  await stream.finalMessage()
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!text) throw new Error('תשובה ריקה מ-Anthropic')
  return text
}

async function callGemini(options: LlmCallOptions): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(options.apiKey)
  const model = genAI.getGenerativeModel({ model: options.model })

  const system = options.messages.find((m) => m.role === 'system')?.content || ''
  const history = options.messages.filter((m) => m.role !== 'system')

  const parts: string[] = []
  if (system) parts.push(`SYSTEM:\n${system}\n`)
  for (const m of history) {
    parts.push(`${m.role.toUpperCase()}:\n${m.content}\n`)
  }
  parts.push('ASSISTANT:')

  const result = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: parts.join('\n') }] }],
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? 16384
    }
  })

  let text = ''
  for await (const chunk of result.stream) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const delta = chunk.text()
    if (delta) {
      text += delta
      options.onToken?.(delta)
    }
  }
  if (!text) throw new Error('תשובה ריקה מ-Gemini')
  return text
}

/** Strip nfblaze / clarify / action JSON blocks from live display text */
export function stripActionBlocksForDisplay(raw: string): string {
  return raw
    .replace(/```nfblaze[\s\S]*?(```|$)/gi, '')
    .replace(/```clarify[\s\S]*?(```|$)/gi, '')
    .replace(/```json\s*\{[\s\S]*?"actions"[\s\S]*?(```|$)/gi, '')
    .replace(/```json\s*\{[\s\S]*?"type"\s*:\s*"clarify"[\s\S]*?(```|$)/gi, '')
    .replace(/\{[\s\S]*?"type"\s*:\s*"clarify"[\s\S]*?"questions"\s*:\s*\[[\s\S]*\][\s\S]*\}/gi, '')
    .trimEnd()
}

/**
 * History hygiene for ASK/PLAN: remove write-action blocks so the model
 * does not imitate them. Clarify JSON is also stripped (UI holds structured data).
 */
export function sanitizeHistoryContentForReadOnly(content: string): string {
  return stripActionBlocksForDisplay(content).trim()
}

function sanitizeClarifyQuestions(raw: unknown): ClarifyQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: ClarifyQuestion[] = []
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue
    const q = String((item as ClarifyQuestion).q || '').trim()
    if (!q) continue
    const optsRaw = (item as ClarifyQuestion).options
    const options = Array.isArray(optsRaw)
      ? optsRaw
          .map((o) => String(o || '').trim())
          .filter(Boolean)
          .slice(0, 4)
      : []
    if (options.length < 2) continue
    out.push({
      q,
      options,
      multi: Boolean((item as ClarifyQuestion).multi)
    })
  }
  return out
}

/** Parse clarify block — not a file-write action */
export function parseClarifyBlock(raw: string): ClarifyBlock | undefined {
  const blockMatch =
    raw.match(/```clarify\s*([\s\S]*?)```/i) ||
    raw.match(/```json\s*(\{[\s\S]*?"type"\s*:\s*"clarify"[\s\S]*?\})\s*```/i)

  let body: string | undefined
  if (blockMatch) {
    body = blockMatch[1]
  } else {
    const loose = raw.match(
      /\{[\s\S]*?"type"\s*:\s*"clarify"[\s\S]*?"questions"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/
    )
    if (loose) body = loose[0]
  }
  if (!body) return undefined
  try {
    const parsed = JSON.parse(body) as { type?: string; questions?: unknown }
    if (String(parsed.type || '').toLowerCase() !== 'clarify') return undefined
    const questions = sanitizeClarifyQuestions(parsed.questions)
    if (!questions.length) return undefined
    return { type: 'clarify', questions }
  } catch {
    return undefined
  }
}

/** Parse nfblaze JSON block from model output (+ optional clarify) */
export function parseAgentResponse(raw: string): AgentResponse {
  const clarify = parseClarifyBlock(raw)

  const blockMatch =
    raw.match(/```nfblaze\s*([\s\S]*?)```/i) ||
    raw.match(/```json\s*(\{[\s\S]*?"actions"[\s\S]*?\})\s*```/i)

  let message = raw
  let actions: AgentFileAction[] = []
  let previewFile: string | undefined

  // Remove clarify fence from narrative first
  message = message
    .replace(/```clarify\s*[\s\S]*?```/gi, '')
    .replace(/```json\s*\{[\s\S]*?"type"\s*:\s*"clarify"[\s\S]*?\}\s*```/gi, '')
    .replace(/\{[\s\S]*?"type"\s*:\s*"clarify"[\s\S]*?"questions"\s*:\s*\[[\s\S]*\][\s\S]*\}/gi, '')
    .trim()

  if (blockMatch) {
    message = message
      .replace(/```nfblaze[\s\S]*?```/gi, '')
      .replace(/```json\s*\{[\s\S]*?"actions"[\s\S]*?\}\s*```/gi, '')
      .trim()
    // Only parse write actions when there is no clarify (clarify wins)
    if (!clarify) {
      try {
        const parsed = JSON.parse(blockMatch[1]) as {
          message?: string
          actions?: AgentFileAction[]
          previewFile?: string
        }
        if (parsed.message) {
          message = message || parsed.message
        }
        if (Array.isArray(parsed.actions)) actions = sanitizeActions(parsed.actions)
        if (parsed.previewFile) previewFile = String(parsed.previewFile)
      } catch {
        // keep raw message, no actions
      }
    }
  } else if (!clarify) {
    const jsonMatch = raw.match(/\{[\s\S]*"actions"\s*:\s*\[[\s\S]*\][\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          message?: string
          actions?: AgentFileAction[]
          previewFile?: string
        }
        if (parsed.message) message = parsed.message
        if (Array.isArray(parsed.actions)) actions = sanitizeActions(parsed.actions)
        if (parsed.previewFile) previewFile = String(parsed.previewFile)
      } catch {
        /* ignore */
      }
    }
  }

  // Clarify + write → ignore writes completely
  if (clarify) {
    actions = []
    previewFile = undefined
  }

  if (!message) {
    message = clarify
      ? ''
      : actions.length
        ? 'הקבצים עודכנו בהצלחה.'
        : stripActionBlocksForDisplay(raw) || raw
  }

  return { message, actions, previewFile, clarify }
}

function sanitizeActions(actions: AgentFileAction[]): AgentFileAction[] {
  const out: AgentFileAction[] = []
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue
    if (!['write', 'delete', 'mkdir', 'edit'].includes(a.type)) continue
    if (typeof a.path !== 'string' || !a.path.trim()) continue
    const path = a.path.replace(/\\/g, '/').replace(/^\/+/, '').trim()
    if (path.includes('..') || path.includes('\0')) continue
    if (a.type === 'write') {
      if (typeof a.content !== 'string') continue
      out.push({ type: 'write', path, content: a.content })
    } else if (a.type === 'edit') {
      if (typeof a.old_string !== 'string' || typeof a.new_string !== 'string') continue
      if (!a.old_string) continue
      out.push({ type: 'edit', path, old_string: a.old_string, new_string: a.new_string })
    } else if (a.type === 'mkdir') {
      out.push({ type: 'mkdir', path })
    } else {
      out.push({ type: 'delete', path })
    }
  }
  return out
}
