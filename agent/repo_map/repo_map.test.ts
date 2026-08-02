import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildGraph,
  impactedFiles,
  listCodeFiles,
  pageRank,
  rankFiles,
  touchesRenderableOutput
} from './graph'
import { buildRepoMap, REPO_MAP_MAX_CHARS } from './index'

let root: string

function write(rel: string, content: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

/** פרויקט קטן: App מייבא הכול, Button מיובא מכולם */
function scaffold(): void {
  write('package.json', '{"name":"t"}')
  write(
    'src/App.tsx',
    `import Header from './components/Header'
     import Hero from './components/Hero'
     import Footer from './components/Footer'
     export default function App() { return null }`
  )
  write(
    'src/components/Header.tsx',
    `import Button from './Button'
     export default function Header() { return null }`
  )
  write(
    'src/components/Hero.tsx',
    `import Button from './Button'
     export default function Hero() { return null }`
  )
  write(
    'src/components/Footer.tsx',
    `import Button from './Button'
     export default function Footer() { return null }`
  )
  write('src/components/Button.tsx', 'export default function Button() { return null }')
  write('src/lib/unused.ts', 'export const helper = 1')
}

beforeEach(() => {
  root = join(tmpdir(), `nf-map-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listCodeFiles', () => {
  it('collects source files and skips build output and tests', () => {
    scaffold()
    write('node_modules/x/index.js', 'x')
    write('dist/out.js', 'x')
    write('src/App.test.tsx', 'x')
    const files = listCodeFiles(root)
    expect(files).toContain('src/App.tsx')
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes('dist/'))).toBe(false)
    expect(files.some((f) => f.includes('.test.'))).toBe(false)
  })

  it('respects the cap', () => {
    for (let i = 0; i < 30; i++) write(`src/f${i}.ts`, 'export const x = 1')
    expect(listCodeFiles(root, 10).length).toBe(10)
  })
})

describe('buildGraph', () => {
  it('resolves local imports into edges', () => {
    scaffold()
    const g = buildGraph(root)
    expect(g.edges.get('src/App.tsx')).toEqual(
      expect.arrayContaining([
        'src/components/Header.tsx',
        'src/components/Hero.tsx',
        'src/components/Footer.tsx'
      ])
    )
  })

  it('ignores external packages', () => {
    write('package.json', '{"name":"t"}')
    write('src/a.ts', "import React from 'react'\nexport const a = 1")
    write('src/b.ts', 'export const b = 1')
    write('src/c.ts', 'export const c = 1')
    write('src/d.ts', 'export const d = 1')
    write('src/e.ts', 'export const e = 1')
    write('src/f.ts', 'export const f = 1')
    const g = buildGraph(root)
    expect(g.edges.get('src/a.ts')).toEqual([])
  })

  it('never records a self-edge', () => {
    scaffold()
    const g = buildGraph(root)
    for (const [from, targets] of g.edges) expect(targets).not.toContain(from)
  })
})

describe('pageRank', () => {
  it('produces a normalized, deterministic ranking', () => {
    scaffold()
    const g = buildGraph(root)
    const a = pageRank(g)
    const b = pageRank(g)
    expect([...a.entries()]).toEqual([...b.entries()])
    const total = [...a.values()].reduce((n, v) => n + v, 0)
    expect(total).toBeGreaterThan(0.95)
    expect(total).toBeLessThan(1.05)
  })

  it('scores a widely-imported file above an unused one', () => {
    scaffold()
    const scores = pageRank(buildGraph(root))
    expect(scores.get('src/components/Button.tsx')!).toBeGreaterThan(
      scores.get('src/lib/unused.ts')!
    )
  })

  it('handles an empty project without throwing', () => {
    expect(pageRank({ files: [], edges: new Map() }).size).toBe(0)
  })
})

describe('rankFiles', () => {
  it('puts the entry point first', () => {
    scaffold()
    expect(rankFiles(buildGraph(root))[0]!.file).toBe('src/App.tsx')
  })

  it('counts how many files import each file', () => {
    scaffold()
    const button = rankFiles(buildGraph(root)).find((r) => r.file.endsWith('Button.tsx'))
    expect(button!.importedBy).toBe(3)
  })
})

describe('impactedFiles', () => {
  it('includes the changed file itself', () => {
    scaffold()
    const impacted = impactedFiles(buildGraph(root), ['src/components/Button.tsx'])
    expect(impacted.has('src/components/Button.tsx')).toBe(true)
  })

  it('walks importers transitively', () => {
    scaffold()
    // Button ← Header/Hero/Footer ← App
    const impacted = impactedFiles(buildGraph(root), ['src/components/Button.tsx'])
    expect(impacted.has('src/components/Header.tsx')).toBe(true)
    expect(impacted.has('src/App.tsx')).toBe(true)
  })

  it('excludes files that cannot be affected', () => {
    scaffold()
    const impacted = impactedFiles(buildGraph(root), ['src/components/Button.tsx'])
    expect(impacted.has('src/lib/unused.ts')).toBe(false)
  })

  it('does not walk downward into dependencies', () => {
    scaffold()
    // שינוי ב-App לא יכול לשבור את Button
    const impacted = impactedFiles(buildGraph(root), ['src/App.tsx'])
    expect(impacted.has('src/components/Button.tsx')).toBe(false)
  })

  it('survives a cycle without hanging', () => {
    write('package.json', '{"name":"t"}')
    write('src/a.ts', "import { b } from './b'\nexport const a = b")
    write('src/b.ts', "import { a } from './a'\nexport const b = a")
    write('src/c.ts', 'export const c = 1')
    write('src/d.ts', 'export const d = 1')
    write('src/e.ts', 'export const e = 1')
    write('src/f.ts', 'export const f = 1')
    const impacted = impactedFiles(buildGraph(root), ['src/a.ts'])
    expect(impacted.has('src/b.ts')).toBe(true)
  })

  it('tolerates an unknown path', () => {
    scaffold()
    expect(() => impactedFiles(buildGraph(root), ['nope.ts'])).not.toThrow()
  })
})

describe('touchesRenderableOutput', () => {
  it('is true for UI files', () => {
    expect(touchesRenderableOutput(['src/App.tsx'])).toBe(true)
    expect(touchesRenderableOutput(['src/index.css'])).toBe(true)
  })

  it('is false for pure logic and config', () => {
    expect(touchesRenderableOutput(['src/lib/utils.ts', 'README.md'])).toBe(false)
  })

  it('is false for nothing at all', () => {
    expect(touchesRenderableOutput([])).toBe(false)
  })
})

describe('buildRepoMap', () => {
  it('stays inside its character budget', () => {
    scaffold()
    for (let i = 0; i < 80; i++) write(`src/extra/f${i}.ts`, `export const f${i} = ${i}`)
    const map = buildRepoMap(root)
    expect(map.length).toBeLessThanOrEqual(REPO_MAP_MAX_CHARS + 120)
  })

  it('lists the most central file first', () => {
    scaffold()
    const map = buildRepoMap(root)
    const firstEntry = map.split('\n').find((l) => l.startsWith('- '))
    expect(firstEntry).toContain('src/App.tsx')
  })

  it('says how many files were omitted instead of truncating silently', () => {
    scaffold()
    for (let i = 0; i < 80; i++) write(`src/extra/f${i}.ts`, `export const f${i} = ${i}`)
    expect(buildRepoMap(root)).toMatch(/ועוד \d+ קבצים/)
  })

  it('returns nothing for a tiny project', () => {
    write('package.json', '{"name":"t"}')
    write('src/App.tsx', 'export default function App(){return null}')
    expect(buildRepoMap(root)).toBe('')
  })

  it('skips files already in context', () => {
    scaffold()
    const map = buildRepoMap(root, { exclude: ['src/App.tsx'] })
    expect(map).not.toContain('- src/App.tsx')
  })

  it('never throws on an unreadable project', () => {
    expect(() => buildRepoMap(join(root, 'does-not-exist'))).not.toThrow()
  })
})
