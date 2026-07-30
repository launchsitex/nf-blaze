import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearIndexCache,
  composeSystemPrompt,
  ensureProjectIndex,
  MATCH_EXISTING_CODE_INSTRUCTION,
  refreshProjectIndex,
  getCachedIndex
} from './index'

describe('project convention index', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `nf-index-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(join(root, 'src', 'components'), { recursive: true })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { react: '19', zustand: '5', tailwindcss: '4' }
      })
    )
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: true } })
    )
    writeFileSync(
      join(root, 'src', 'components', 'UserCard.tsx'),
      `import { useState } from 'react'\nexport function UserCard(){ const [x,setX]=useState(0); try { return <div className="flex p-2">{x}</div> } catch(e){ return null } }\n`
    )
    writeFileSync(
      join(root, 'src', 'store.ts'),
      `import { create } from 'zustand'\nexport const useStore = create(() => ({ n: 0 }))\n`
    )
  })

  afterEach(() => {
    clearIndexCache(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('scans once and reuses cache', () => {
    const a = ensureProjectIndex(root)
    expect(a.conventions.exports).toBe('named')
    expect(a.conventions.fileNaming).toBe('PascalCase')
    expect(a.conventions.stateManagement).toContain('zustand')
    expect(a.conventions.styling).toContain('tailwind')
    expect(a.conventions.typescript.strict).toBe(true)
    expect(a.conventions.typescript.anyAllowed).toBe(false)

    const b = ensureProjectIndex(root)
    expect(b.scannedAt).toBe(a.scannedAt)
    expect(getCachedIndex(root)?.scannedAt).toBe(a.scannedAt)
  })

  it('refresh rebuilds index', () => {
    const a = ensureProjectIndex(root)
    const b = refreshProjectIndex(root)
    expect(b.scannedAt >= a.scannedAt).toBe(true)
  })

  it('injects match-existing instruction into system prompt', () => {
    const index = ensureProjectIndex(root)
    const prompt = composeSystemPrompt(index, 'BASE PROMPT')
    expect(prompt.startsWith('BASE PROMPT')).toBe(true)
    expect(prompt).toContain(MATCH_EXISTING_CODE_INSTRUCTION)
    expect(prompt).toContain('Project conventions')
    expect(prompt).toContain('zustand')
  })
})
