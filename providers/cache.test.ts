import { describe, expect, it } from 'vitest'
import {
  CACHE_LOOKBACK_BLOCKS,
  MAX_CACHE_BREAKPOINTS,
  pickCacheBreakpoints,
  worthCaching
} from './cache'
import {
  toAnthropicMessages,
  toAnthropicSystem,
  toAnthropicTools,
  withMessageCacheControl
} from './anthropic/convert'
import type { ToolDefinition, UnifiedMessage } from './types'

describe('pickCacheBreakpoints', () => {
  it('always marks the end of the conversation (the rolling breakpoint)', () => {
    const marks = pickCacheBreakpoints([1, 1, 1])
    expect(marks.has(2)).toBe(true)
  })

  it('never exceeds the provider breakpoint budget', () => {
    const counts = Array.from({ length: 200 }, () => 20)
    expect(pickCacheBreakpoints(counts).size).toBeLessThanOrEqual(MAX_CACHE_BREAKPOINTS)
  })

  it('respects breakpoints already reserved for system and tools', () => {
    const counts = Array.from({ length: 200 }, () => 20)
    expect(pickCacheBreakpoints(counts, 2).size).toBeLessThanOrEqual(MAX_CACHE_BREAKPOINTS - 2)
  })

  it('adds an intermediate breakpoint once enough blocks accumulate', () => {
    // הודעה אחת עם הרבה בלוקים — בלי נקודת ביניים הסבב הבא מפספס מטמון
    const counts = [CACHE_LOOKBACK_BLOCKS + 5, 1, 1]
    const marks = pickCacheBreakpoints(counts)
    expect(marks.size).toBeGreaterThan(1)
  })

  it('returns nothing when no budget is left', () => {
    expect(pickCacheBreakpoints([1, 2, 3], MAX_CACHE_BREAKPOINTS).size).toBe(0)
  })

  it('handles an empty conversation', () => {
    expect(pickCacheBreakpoints([]).size).toBe(0)
  })
})

describe('worthCaching', () => {
  it('caches a long system prompt', () => {
    expect(worthCaching('x'.repeat(5000), 0)).toBe(true)
  })

  it('caches when there are enough tool definitions', () => {
    expect(worthCaching('short', 11)).toBe(true)
  })

  it('skips tiny prompts with few tools', () => {
    expect(worthCaching('short', 1)).toBe(false)
  })
})

describe('anthropic cache markers', () => {
  const tools: ToolDefinition[] = [
    { name: 'a', description: 'A', parameters: { type: 'object' } },
    { name: 'b', description: 'B', parameters: { type: 'object' } }
  ]

  it('marks only the last tool — it caches everything before it', () => {
    const out = toAnthropicTools(tools, true) as Array<{ cache_control?: unknown }>
    expect(out[0]!.cache_control).toBeUndefined()
    expect(out[1]!.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('leaves tools untouched when caching is off', () => {
    const out = toAnthropicTools(tools, false) as Array<{ cache_control?: unknown }>
    expect(out.every((t) => t.cache_control === undefined)).toBe(true)
  })

  it('sends system as a plain string when caching is off', () => {
    expect(toAnthropicSystem('hello', false)).toBe('hello')
  })

  it('sends system as a marked block when caching is on', () => {
    expect(toAnthropicSystem('hello', true)).toEqual([
      { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }
    ])
  })

  it('keeps an empty system undefined either way', () => {
    expect(toAnthropicSystem('   ', true)).toBeUndefined()
    expect(toAnthropicSystem(undefined, false)).toBeUndefined()
  })

  it('marks the last block of the final message only', () => {
    const unified: UnifiedMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'two' }] }
    ]
    const marked = withMessageCacheControl(toAnthropicMessages(unified), 2)
    const last = marked[marked.length - 1]!
    const blocks = last.content as Array<{ cache_control?: unknown }>
    expect(blocks[blocks.length - 1]!.cache_control).toEqual({ type: 'ephemeral' })
    const first = marked[0]!.content as Array<{ cache_control?: unknown }>
    expect(first[0]!.cache_control).toBeUndefined()
  })

  it('does not change message content or order', () => {
    const unified: UnifiedMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'two' }] }
    ]
    const plain = toAnthropicMessages(unified)
    const marked = withMessageCacheControl(plain, 2)
    expect(marked.length).toBe(plain.length)
    expect(marked.map((m) => m.role)).toEqual(plain.map((m) => m.role))
    expect(JSON.stringify(marked).replace(/,?"cache_control":\{"type":"ephemeral"\}/g, '')).toBe(
      JSON.stringify(plain)
    )
  })
})
