import { describe, expect, it } from 'vitest'
import { normalizeProviderError, ProviderError } from './errors'
import {
  resolveProviderFromModel,
  resolveApiKey,
  stripModelPrefix,
  isLocalProvider,
  textMessage,
  parseToolArguments
} from './resolve'
import { toOpenAIMessages, toOpenAITools, mapOpenAIStopReason } from './openai/convert'
import {
  toAnthropicMessages,
  toAnthropicTools,
  mapAnthropicStopReason
} from './anthropic/convert'
import { toGeminiContents, toGeminiTools, mapGeminiFinishReason, fromGeminiParts } from './gemini/convert'
import type { UnifiedMessage } from './types'

const sampleTools = [
  {
    name: 'get_weather',
    description: 'Get weather',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city']
    }
  }
]

const historyWithTools: UnifiedMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'Weather in TLV?' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Checking…' },
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'get_weather',
        arguments: { city: 'Tel Aviv' }
      }
    ]
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool_result',
        toolCallId: 'call_1',
        name: 'get_weather',
        content: '{"temp":28}'
      }
    ]
  },
  { role: 'user', content: [{ type: 'text', text: 'Thanks' }] }
]

describe('resolveProviderFromModel', () => {
  it('infers provider from model id', () => {
    expect(resolveProviderFromModel('gpt-5.6-sol')).toBe('openai')
    expect(resolveProviderFromModel('claude-opus-4-8')).toBe('anthropic')
    expect(resolveProviderFromModel('gemini-2.5-flash')).toBe('gemini')
  })

  it('rejects unknown models', () => {
    expect(() => resolveProviderFromModel('llama-3')).toThrow(/לא ניתן לזהות/)
  })

  it('infers local / aggregator providers from model prefix', () => {
    expect(resolveProviderFromModel('ollama:qwen2.5-coder:14b')).toBe('ollama')
    expect(resolveProviderFromModel('lmstudio:qwen2.5-coder-14b-instruct')).toBe('lmstudio')
    expect(resolveProviderFromModel('openrouter:deepseek/deepseek-chat-v3.1')).toBe('openrouter')
  })
})

describe('local providers (Ollama / LM Studio / OpenRouter)', () => {
  it('strips the provider prefix from model ids', () => {
    expect(stripModelPrefix('ollama:qwen2.5-coder:14b')).toBe('qwen2.5-coder:14b')
    expect(stripModelPrefix('lmstudio:model-x')).toBe('model-x')
    expect(stripModelPrefix('openrouter:deepseek/deepseek-chat-v3.1')).toBe(
      'deepseek/deepseek-chat-v3.1'
    )
    expect(stripModelPrefix('claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('local providers do not require an API key', () => {
    expect(isLocalProvider('ollama')).toBe(true)
    expect(isLocalProvider('lmstudio')).toBe(true)
    expect(isLocalProvider('openrouter')).toBe(false)
    expect(resolveApiKey('ollama')).toBe('local')
    expect(resolveApiKey('lmstudio')).toBe('local')
    expect(resolveApiKey('ollama', 'explicit-key')).toBe('explicit-key')
  })

  it('openrouter still requires a key', () => {
    const saved = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    try {
      expect(() => resolveApiKey('openrouter')).toThrow(/חסר apiKey/)
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved
    }
  })
})

describe('message conversion — same history, three shapes', () => {
  it('OpenAI: system message + tool role + parameters', () => {
    const msgs = toOpenAIMessages('You are helpful', historyWithTools)
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are helpful' })
    expect(msgs.some((m) => m.role === 'tool')).toBe(true)
    const assistant = msgs.find((m) => m.role === 'assistant' && 'tool_calls' in m)
    expect(assistant && 'tool_calls' in assistant && assistant.tool_calls?.[0].function.name).toBe(
      'get_weather'
    )

    const tools = toOpenAITools(sampleTools)
    expect(tools[0].type).toBe('function')
    expect(tools[0].function.parameters).toEqual(sampleTools[0].parameters)
  })

  it('Anthropic: no system in messages; tools use input_schema; tool_result in user', () => {
    const msgs = toAnthropicMessages(historyWithTools)
    expect(msgs.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true)
    const userWithTool = msgs.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_result')
    )
    expect(userWithTool).toBeTruthy()

    const tools = toAnthropicTools(sampleTools)
    expect(tools[0].input_schema.type).toBe('object')
    expect(tools[0].name).toBe('get_weather')
  })

  it('Gemini: model role + functionDeclarations + functionResponse', () => {
    const contents = toGeminiContents(historyWithTools)
    expect(contents.some((c) => c.role === 'model')).toBe(true)
    expect(
      contents.some((c) => c.parts.some((p) => 'functionCall' in p))
    ).toBe(true)
    expect(
      contents.some((c) => c.parts.some((p) => 'functionResponse' in p))
    ).toBe(true)

    const tools = toGeminiTools(sampleTools)
    expect(tools[0].functionDeclarations?.[0].name).toBe('get_weather')
  })
})

describe('Gemini schema cleaning', () => {
  it('strips unsupported fields and keeps whitelist only', () => {
    const tools = toGeminiTools([
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          additionalProperties: false,
          $schema: 'http://json-schema.org/draft-07/schema#',
          $id: 'read_file',
          default: {},
          properties: {
            path: {
              type: 'string',
              description: 'Relative path',
              minLength: 1,
              pattern: '^[^.].*'
            },
            offset: {
              type: 'integer',
              minimum: 0,
              description: 'Line offset'
            }
          },
          required: ['path', 'missing_after_clean']
        }
      }
    ])
    const decl = tools[0].functionDeclarations?.[0]
    expect(decl?.name).toBe('read_file')
    const params = decl?.parameters as Record<string, unknown>
    expect(params).toBeDefined()
    expect(params).not.toHaveProperty('additionalProperties')
    expect(params).not.toHaveProperty('$schema')
    expect(params).not.toHaveProperty('$id')
    expect(params).not.toHaveProperty('default')
    expect(params.type).toBe('object')
    const pathProp = (params.properties as Record<string, Record<string, unknown>>).path
    expect(pathProp).not.toHaveProperty('minLength')
    expect(pathProp).not.toHaveProperty('pattern')
    expect(pathProp.type).toBe('string')
    expect(pathProp.description).toBe('Relative path')
    expect(params.required).toEqual(['path'])
  })

  it('omits parameters when properties are empty after clean', () => {
    const tools = toGeminiTools([
      {
        name: 'noop',
        description: 'No args',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: []
        }
      }
    ])
    const decl = tools[0].functionDeclarations?.[0]
    expect(decl?.name).toBe('noop')
    expect(decl).not.toHaveProperty('parameters')
  })

  it('preserves every tool name — none drop on the way to Gemini', () => {
    const allTools = [
      { name: 'read_file', description: 'a', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
      { name: 'list_dir', description: 'b', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
      { name: 'grep', description: 'c', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'], additionalProperties: false } },
      { name: 'declare_scope', description: 'd', parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } }, required: ['files'], additionalProperties: false } },
      { name: 'edit_file', description: 'e', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'], additionalProperties: false } },
      { name: 'write_file', description: 'f', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
      { name: 'run_command', description: 'g', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } }
    ]
    const decls = toGeminiTools(allTools)[0].functionDeclarations ?? []
    expect(decls).toHaveLength(allTools.length)
    expect(decls.map((d) => d.name)).toEqual(allTools.map((t) => t.name))
    for (const decl of decls) {
      expect(JSON.stringify(decl)).not.toMatch(/additionalProperties/)
    }
  })
})

describe('Gemini 3 thought signatures', () => {
  it('fromGeminiParts captures thoughtSignature on function calls', () => {
    const { toolCalls } = fromGeminiParts([
      { functionCall: { name: 'update_plan', args: { goal: 'x' } }, thoughtSignature: 'sig-abc' }
    ])
    expect(toolCalls[0].thoughtSignature).toBe('sig-abc')
  })

  it('toGeminiContents replays thoughtSignature on assistant functionCall parts', () => {
    const history: UnifiedMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'בנה CRM' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'fc-1',
            name: 'update_plan',
            arguments: { goal: 'x' },
            thoughtSignature: 'sig-abc'
          }
        ]
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolCallId: 'fc-1', name: 'update_plan', content: 'ok' }]
      }
    ]
    const contents = toGeminiContents(history)
    const modelTurn = contents.find((c) => c.role === 'model')
    const fcPart = modelTurn?.parts.find((p) => 'functionCall' in p) as
      | { functionCall: { name: string }; thoughtSignature?: string }
      | undefined
    expect(fcPart?.thoughtSignature).toBe('sig-abc')
  })

  it('omits thoughtSignature when absent', () => {
    const history: UnifiedMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'fc-1', name: 'grep', arguments: {} }]
      }
    ]
    const contents = toGeminiContents(history)
    const fcPart = contents[0]?.parts[0] as { thoughtSignature?: string }
    expect('thoughtSignature' in fcPart).toBe(false)
  })
})

describe('stop reason mapping', () => {
  it('maps provider-specific reasons to unified StopReason', () => {
    expect(mapOpenAIStopReason('tool_calls')).toBe('tool_use')
    expect(mapOpenAIStopReason('length')).toBe('length')
    expect(mapAnthropicStopReason('tool_use')).toBe('tool_use')
    expect(mapAnthropicStopReason('max_tokens')).toBe('length')
    expect(mapGeminiFinishReason('STOP', false)).toBe('end')
    expect(mapGeminiFinishReason('STOP', true)).toBe('tool_use')
    expect(mapGeminiFinishReason('MAX_TOKENS', false)).toBe('length')
  })
})

describe('error normalization', () => {
  it('normalizes rate limits', () => {
    const err = normalizeProviderError({ status: 429, message: 'Too Many Requests' }, 'openai')
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.code).toBe('rate_limit')
    expect(err.retryable).toBe(true)
    expect(err.retryAfterMs).toBeGreaterThan(0)
  })

  it('normalizes auth errors', () => {
    const err = normalizeProviderError({ status: 401, message: 'Invalid API key' }, 'anthropic')
    expect(err.code).toBe('auth')
    expect(err.retryable).toBe(false)
  })

  it('normalizes aborts', () => {
    const err = normalizeProviderError(new DOMException('Aborted', 'AbortError'), 'gemini')
    expect(err.code).toBe('aborted')
  })
})

describe('helpers', () => {
  it('builds text messages and parses tool args', () => {
    expect(textMessage('user', 'hi').content[0]).toEqual({ type: 'text', text: 'hi' })
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 })
    expect(parseToolArguments('not-json')).toEqual({ _raw: 'not-json' })
  })
})
