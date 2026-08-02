import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  compareHealth,
  healthFilePath,
  isHealthy,
  MAX_REPORTED_REGRESSIONS,
  normalizeConsoleError,
  readBaseline,
  saveBaselineIfHealthy,
  shouldRunHealthCheck
} from './index'
import { pickRoutes } from './probe'
import type { HealthReport } from './types'

function report(
  routes: Array<[string, boolean, string?]>,
  consoleErrors: string[] = []
): HealthReport {
  return {
    createdAt: '2026-07-31T00:00:00.000Z',
    routes: routes.map(([route, ok, reason]) => ({
      route,
      ok,
      ...(reason ? { reason } : {})
    })),
    consoleErrors
  }
}

describe('normalizeConsoleError', () => {
  it('same error from different builds gets one signature', () => {
    const a = normalizeConsoleError(
      'TypeError: x is not a function at http://127.0.0.1:5293/src/App.tsx:41:7'
    )
    const b = normalizeConsoleError(
      'TypeError: x is not a function at http://127.0.0.1:6100/src/App.tsx:88:2'
    )
    expect(a).toBe(b)
  })

  it('keeps different errors apart', () => {
    expect(normalizeConsoleError('TypeError: a is null')).not.toBe(
      normalizeConsoleError('ReferenceError: b is not defined')
    )
  })
})

describe('isHealthy', () => {
  it('healthy only when every route loaded and console is clean', () => {
    expect(isHealthy(report([['/', true]]))).toBe(true)
    expect(
      isHealthy(
        report([
          ['/', true],
          ['/about', false]
        ])
      )
    ).toBe(false)
    expect(isHealthy(report([['/', true]], ['boom']))).toBe(false)
  })

  it('an empty probe is not healthy', () => {
    expect(isHealthy(report([]))).toBe(false)
  })
})

describe('compareHealth', () => {
  it('reports nothing without a baseline', () => {
    expect(compareHealth(null, report([['/', false, 'מסך לבן']]))).toEqual([])
  })

  it('reports a route that worked before and broke now', () => {
    const before = report([
      ['/', true],
      ['/about', true]
    ])
    const after = report([
      ['/', true],
      ['/about', false, 'מסך לבן']
    ])
    expect(compareHealth(before, after)).toEqual([
      { kind: 'route', route: '/about', detail: 'מסך לבן' }
    ])
  })

  it('does not report a route that was already broken', () => {
    const before = report([
      ['/', true],
      ['/about', false, 'לא נטען']
    ])
    const after = report([
      ['/', true],
      ['/about', false, 'לא נטען']
    ])
    expect(compareHealth(before, after)).toEqual([])
  })

  it('does not report a route the user removed', () => {
    const before = report([
      ['/', true],
      ['/old', true]
    ])
    const after = report([['/', true]])
    expect(compareHealth(before, after)).toEqual([])
  })

  it('reports only console errors that are new', () => {
    const before = report([['/', true]], ['known noise'])
    const after = report([['/', false, 'שגיאת ריצה']], ['known noise', 'fresh boom'])
    expect(compareHealth(before, after)).toEqual([
      { kind: 'route', route: '/', detail: 'שגיאת ריצה' },
      { kind: 'console', detail: 'fresh boom' }
    ])
  })

  it('does not repeat a crash that already explains the route failure', () => {
    const before = report([['/', true]])
    const after = report([['/', false, 'שגיאת ריצה: boom at App.tsx:41']], ['boom at App.tsx'])
    expect(compareHealth(before, after)).toEqual([
      { kind: 'route', route: '/', detail: 'שגיאת ריצה: boom at App.tsx:41' }
    ])
  })

  it('still reports an unrelated console error alongside a route failure', () => {
    const before = report([['/', true]])
    const after = report([['/', false, 'מסך לבן']], ['unrelated warning blew up'])
    expect(compareHealth(before, after)).toHaveLength(2)
  })

  it('dedupes and caps what the user sees', () => {
    const before = report([['/', true]])
    const after = report(
      [['/', true]],
      Array.from({ length: 20 }, (_, i) => `err ${i}`)
    )
    expect(compareHealth(before, after)).toHaveLength(MAX_REPORTED_REGRESSIONS)
  })
})

describe('baseline file', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `nf-health-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('saves a healthy report and reads it back', () => {
    const healthy = report([['/', true]])
    expect(saveBaselineIfHealthy(root, healthy)).toBe(true)
    expect(readBaseline(root)?.routes).toEqual([{ route: '/', ok: true }])
  })

  it('never overwrites a good baseline with a broken one', () => {
    saveBaselineIfHealthy(root, report([['/', true]]))
    expect(saveBaselineIfHealthy(root, report([['/', false, 'מסך לבן']]))).toBe(false)
    expect(readBaseline(root)?.routes).toEqual([{ route: '/', ok: true }])
  })

  it('returns null on a corrupt file instead of throwing', () => {
    mkdirSync(join(root, '.nf-blaze'), { recursive: true })
    writeFileSync(healthFilePath(root), '{ not json', 'utf8')
    expect(readBaseline(root)).toBeNull()
  })

  it('writes valid JSON', () => {
    saveBaselineIfHealthy(root, report([['/', true]]))
    expect(() => JSON.parse(readFileSync(healthFilePath(root), 'utf8'))).not.toThrow()
  })
})

describe('pickRoutes', () => {
  it('always probes the home route first', () => {
    expect(pickRoutes(['/about'])[0]).toBe('/')
  })

  it('drops dynamic and non-relative routes', () => {
    expect(pickRoutes(['/users/:id', '/*', 'https://x.com', '/ok'])).toEqual(['/', '/ok'])
  })

  it('dedupes and caps', () => {
    const many = Array.from({ length: 30 }, (_, i) => `/p${i}`)
    expect(pickRoutes([...many, ...many]).length).toBe(6)
  })
})

describe('shouldRunHealthCheck', () => {
  it('runs only for BUILD with real writes', () => {
    expect(shouldRunHealthCheck({ workMode: 'BUILD', writtenPaths: ['src/App.tsx'] })).toBe(true)
    expect(shouldRunHealthCheck({ workMode: 'BUILD', writtenPaths: [] })).toBe(false)
    expect(shouldRunHealthCheck({ workMode: 'ASK', writtenPaths: ['src/App.tsx'] })).toBe(false)
    expect(shouldRunHealthCheck({ workMode: 'PLAN', writtenPaths: ['src/App.tsx'] })).toBe(false)
  })
})
