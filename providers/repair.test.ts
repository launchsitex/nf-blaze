import { describe, expect, it } from 'vitest'
import { coerceArgumentsToSchema, repairToolArguments } from './repair'
import { parseToolArguments } from './resolve'

describe('repairToolArguments — valid input is never touched', () => {
  it('parses clean JSON without any repair', () => {
    const r = repairToolArguments('{"path":"src/App.tsx","content":"hi"}')
    expect(r.value).toEqual({ path: 'src/App.tsx', content: 'hi' })
    expect(r.repairs).toEqual([])
  })

  it('treats empty input as empty arguments', () => {
    expect(repairToolArguments('').value).toEqual({})
    expect(repairToolArguments('   ').value).toEqual({})
  })

  it('preserves Hebrew content exactly', () => {
    const r = repairToolArguments('{"content":"שלום עולם"}')
    expect(r.value).toEqual({ content: 'שלום עולם' })
  })

  it('preserves nested objects and arrays', () => {
    const r = repairToolArguments('{"files":["a.ts","b.ts"],"opts":{"deep":true}}')
    expect(r.value).toEqual({ files: ['a.ts', 'b.ts'], opts: { deep: true } })
  })
})

describe('repairToolArguments — real malformed shapes', () => {
  it('strips a markdown code fence', () => {
    const r = repairToolArguments('```json\n{"path":"a.ts"}\n```')
    expect(r.value).toEqual({ path: 'a.ts' })
    expect(r.repairs).toContain('code_fence')
  })

  it('drops prose around the object', () => {
    const r = repairToolArguments('Here are the arguments: {"path":"a.ts"} — done')
    expect(r.value).toEqual({ path: 'a.ts' })
    expect(r.repairs).toContain('surrounding_prose')
  })

  it('removes a trailing comma', () => {
    const r = repairToolArguments('{"path":"a.ts","recursive":true,}')
    expect(r.value).toEqual({ path: 'a.ts', recursive: true })
    expect(r.repairs).toContain('trailing_comma')
  })

  it('normalizes smart quotes', () => {
    const r = repairToolArguments('{\u201Cpath\u201D:\u201Ca.ts\u201D}')
    expect(r.value).toEqual({ path: 'a.ts' })
    expect(r.repairs).toContain('smart_quotes')
  })

  it('closes a truncated object', () => {
    const r = repairToolArguments('{"path":"a.ts","content":"start')
    expect(r.value).toEqual({ path: 'a.ts', content: 'start' })
    expect(r.repairs).toContain('unbalanced')
  })

  it('closes a truncated nested structure', () => {
    const r = repairToolArguments('{"files":["a.ts","b.ts"')
    expect(r.value).toEqual({ files: ['a.ts', 'b.ts'] })
  })

  it('does not mistake a brace inside a string for structure', () => {
    const r = repairToolArguments('{"content":"function f() { return 1 }"}')
    expect(r.value).toEqual({ content: 'function f() { return 1 }' })
    expect(r.repairs).toEqual([])
  })

  it('gives up on input with no object at all', () => {
    expect(repairToolArguments('not json at all').value).toBeNull()
  })
})

describe('parseToolArguments integration', () => {
  it('recovers malformed Gemini-style output instead of passing garbage on', () => {
    expect(parseToolArguments('{"path":"a.ts",}')).toEqual({ path: 'a.ts' })
  })

  it('still falls back to _raw when nothing can be recovered', () => {
    expect(parseToolArguments('total garbage')).toEqual({ _raw: 'total garbage' })
  })
})

describe('coerceArgumentsToSchema', () => {
  const params = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      max_lines: { type: 'number' },
      recursive: { type: 'boolean' }
    }
  }

  it('converts numeric strings to numbers', () => {
    expect(coerceArgumentsToSchema({ max_lines: '50' }, params)).toEqual({ max_lines: 50 })
  })

  it('converts boolean strings to booleans', () => {
    expect(coerceArgumentsToSchema({ recursive: 'true' }, params)).toEqual({ recursive: true })
    expect(coerceArgumentsToSchema({ recursive: 'false' }, params)).toEqual({ recursive: false })
  })

  it('fixes a parameter name that differs only by case or underscore', () => {
    expect(coerceArgumentsToSchema({ maxLines: 10 }, params)).toEqual({ max_lines: 10 })
    expect(coerceArgumentsToSchema({ Path: 'a.ts' }, params)).toEqual({ path: 'a.ts' })
  })

  it('leaves unknown parameters alone instead of dropping them', () => {
    expect(coerceArgumentsToSchema({ mystery: 1 }, params)).toEqual({ mystery: 1 })
  })

  it('does not coerce a non-numeric string', () => {
    expect(coerceArgumentsToSchema({ max_lines: 'many' }, params)).toEqual({ max_lines: 'many' })
  })

  it('passes through when there is no schema', () => {
    expect(coerceArgumentsToSchema({ a: '1' }, undefined)).toEqual({ a: '1' })
  })

  it('never invents a value', () => {
    expect(coerceArgumentsToSchema({}, params)).toEqual({})
  })
})
