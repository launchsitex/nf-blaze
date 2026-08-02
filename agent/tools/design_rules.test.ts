import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ALLOW_MARKER,
  assertDesignSystem,
  findDesignViolations,
  hasDesignSystem,
  isStyledComponentFile
} from './design_rules'
import { createToolSession } from './session'

describe('findDesignViolations — catches the generic-AI defaults', () => {
  it('flags raw white and black backgrounds', () => {
    const found = findDesignViolations('<div className="bg-white p-4">x</div>')
    expect(found.map((f) => f.found)).toContain('bg-white')
  })

  it('flags gray scales', () => {
    const found = findDesignViolations('<p className="text-gray-500">x</p>')
    expect(found.some((f) => f.kind === 'color')).toBe(true)
  })

  it('flags arbitrary hex colors', () => {
    const found = findDesignViolations('<p className="bg-[#ff00aa]">x</p>')
    expect(found.some((f) => f.kind === 'color')).toBe(true)
  })

  it('flags physical direction utilities that break RTL', () => {
    const found = findDesignViolations('<div className="ml-4 text-left">x</div>')
    const kinds = found.filter((f) => f.kind === 'rtl').map((f) => f.found)
    expect(kinds).toContain('ml-4')
    expect(kinds).toContain('text-left')
  })
})

describe('findDesignViolations — does not fire on legitimate code', () => {
  it('accepts token classes', () => {
    expect(
      findDesignViolations(
        '<div className="bg-card text-foreground border-border ms-4 text-start">x</div>'
      )
    ).toEqual([])
  })

  it('ignores banned words outside className', () => {
    expect(findDesignViolations('const note = "use bg-white here"')).toEqual([])
  })

  it('ignores Hebrew content text', () => {
    expect(findDesignViolations('<p className="text-foreground">שמאל וימין</p>')).toEqual([])
  })

  it('does not flag ms-/me-/ps-/pe- logical utilities', () => {
    expect(findDesignViolations('<div className="ms-2 me-4 ps-1 pe-3">x</div>')).toEqual([])
  })

  it('honours the explicit escape hatch', () => {
    const content = `// ${ALLOW_MARKER}\n<div className="bg-white ml-4">x</div>`
    expect(findDesignViolations(content)).toEqual([])
  })

  it('reads template literal class names', () => {
    const found = findDesignViolations('<div className={`bg-white ${x}`}>y</div>')
    expect(found.some((f) => f.found === 'bg-white')).toBe(true)
  })
})

describe('file and project gating', () => {
  it('only checks component files', () => {
    expect(isStyledComponentFile('src/App.tsx')).toBe(true)
    expect(isStyledComponentFile('src/App.jsx')).toBe(true)
    expect(isStyledComponentFile('src/index.css')).toBe(false)
    expect(isStyledComponentFile('tailwind.config.cjs')).toBe(false)
  })

  describe('with a real folder', () => {
    let root: string

    beforeEach(() => {
      root = join(tmpdir(), `nf-design-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      mkdirSync(join(root, 'src'), { recursive: true })
    })

    afterEach(() => {
      rmSync(root, { recursive: true, force: true })
    })

    it('detects a token system', () => {
      writeFileSync(join(root, 'src', 'index.css'), ':root { --primary: 173 58% 28%; }', 'utf8')
      expect(hasDesignSystem(root)).toBe(true)
    })

    it('reports no token system for an imported project without one', () => {
      writeFileSync(join(root, 'src', 'index.css'), 'body { margin: 0 }', 'utf8')
      expect(hasDesignSystem(root)).toBe(false)
    })

    it('never blocks a project that has no design system', () => {
      writeFileSync(join(root, 'src', 'index.css'), 'body { margin: 0 }', 'utf8')
      expect(() =>
        assertDesignSystem(root, 'src/App.tsx', '<div className="bg-white ml-4" />')
      ).not.toThrow()
    })

    it('blocks a violation when the project does have tokens', () => {
      writeFileSync(join(root, 'src', 'index.css'), ':root { --primary: 1 2% 3%; }', 'utf8')
      expect(() => assertDesignSystem(root, 'src/App.tsx', '<div className="bg-white" />')).toThrow(
        /מערכת העיצוב/
      )
    })

    it('allows clean token usage', () => {
      writeFileSync(join(root, 'src', 'index.css'), ':root { --primary: 1 2% 3%; }', 'utf8')
      expect(() =>
        assertDesignSystem(root, 'src/App.tsx', '<div className="bg-primary ms-2" />')
      ).not.toThrow()
    })

    it('gives up after two blocks so the agent can never deadlock', () => {
      writeFileSync(join(root, 'src', 'index.css'), ':root { --primary: 1 2% 3%; }', 'utf8')
      const session = createToolSession()
      const bad = '<div className="bg-white" />'
      // שני ניסיונות נחסמים — הזדמנות אמיתית לתקן
      expect(() => assertDesignSystem(root, 'src/App.tsx', bad, session)).toThrow()
      expect(() => assertDesignSystem(root, 'src/App.tsx', bad, session)).toThrow()
      // מכאן הכתיבה עוברת: איכות נפגעת מעט, המשתמש לא נתקע
      expect(() => assertDesignSystem(root, 'src/App.tsx', bad, session)).not.toThrow()
    })

    it('counts each file separately', () => {
      writeFileSync(join(root, 'src', 'index.css'), ':root { --primary: 1 2% 3%; }', 'utf8')
      const session = createToolSession()
      const bad = '<div className="bg-white" />'
      assertDesignSystem.bind(null, root, 'src/A.tsx', bad, session)
      expect(() => assertDesignSystem(root, 'src/A.tsx', bad, session)).toThrow()
      expect(() => assertDesignSystem(root, 'src/A.tsx', bad, session)).toThrow()
      expect(() => assertDesignSystem(root, 'src/A.tsx', bad, session)).not.toThrow()
      // קובץ אחר מתחיל מאפס
      expect(() => assertDesignSystem(root, 'src/B.tsx', bad, session)).toThrow()
    })

    it('still blocks every time when no session is provided', () => {
      writeFileSync(join(root, 'src', 'index.css'), ':root { --primary: 1 2% 3%; }', 'utf8')
      const bad = '<div className="bg-white" />'
      for (let i = 0; i < 4; i++) {
        expect(() => assertDesignSystem(root, 'src/App.tsx', bad)).toThrow()
      }
    })

    it('never touches CSS files', () => {
      writeFileSync(join(root, 'src', 'index.css'), ':root { --primary: 1 2% 3%; }', 'utf8')
      expect(() => assertDesignSystem(root, 'src/index.css', '.x { color: white }')).not.toThrow()
    })
  })
})
