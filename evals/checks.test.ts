import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fileExists,
  hasHebrewContent,
  listHasAllStates,
  noHardcodedSecrets,
  noPlaceholderText,
  respectsDesignSystem,
  rtlDocument,
  runChecks,
  sourceLacks,
  sourceMatches,
  summarize,
  walkSourceFiles
} from './checks'
import { EVAL_TASKS, getTask, isReadOnlyTask } from './tasks'

let root: string

function write(rel: string, content: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

beforeEach(() => {
  root = join(tmpdir(), `nf-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('walkSourceFiles', () => {
  it('skips node_modules and build output', () => {
    write('src/App.tsx', 'x')
    write('node_modules/pkg/index.js', 'x')
    write('dist/bundle.js', 'x')
    const files = walkSourceFiles(root)
    expect(files.some((f) => f.includes('App.tsx'))).toBe(true)
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes('dist'))).toBe(false)
  })
})

describe('fileExists', () => {
  it('fails when the file is missing', () => {
    expect(fileExists('src/App.tsx')(root).status).toBe('fail')
  })

  it('fails on an essentially empty file', () => {
    write('src/App.tsx', ' ')
    expect(fileExists('src/App.tsx')(root).status).toBe('fail')
  })

  it('passes on real content', () => {
    write('src/App.tsx', 'export default function App() { return null }')
    expect(fileExists('src/App.tsx')(root).status).toBe('pass')
  })
})

describe('noPlaceholderText', () => {
  it('catches lorem ipsum', () => {
    write('src/App.tsx', '<p>Lorem ipsum dolor</p>')
    expect(noPlaceholderText(root).status).toBe('fail')
  })

  it('catches Hebrew filler', () => {
    write('src/App.tsx', '<p>תכונה 1</p>')
    expect(noPlaceholderText(root).status).toBe('fail')
  })

  it('passes on real copy', () => {
    write('src/App.tsx', '<p>ייעוץ משפטי לעסקים קטנים</p>')
    expect(noPlaceholderText(root).status).toBe('pass')
  })
})

describe('hasHebrewContent', () => {
  it('fails on an English-only build', () => {
    write('src/App.tsx', '<h1>Welcome to our site</h1>')
    expect(hasHebrewContent(root).status).toBe('fail')
  })

  it('passes with Hebrew copy', () => {
    write('src/App.tsx', '<h1>ברוכים הבאים</h1>')
    expect(hasHebrewContent(root).status).toBe('pass')
  })
})

describe('rtlDocument', () => {
  it('fails without dir=rtl', () => {
    write('index.html', '<html lang="he"><body></body></html>')
    expect(rtlDocument(root).status).toBe('fail')
  })

  it('passes with both attributes', () => {
    write('index.html', '<html lang="he" dir="rtl"><body></body></html>')
    expect(rtlDocument(root).status).toBe('pass')
  })
})

describe('respectsDesignSystem', () => {
  it('fails on raw colors', () => {
    write('src/App.tsx', '<div className="bg-white">x</div>')
    expect(respectsDesignSystem(root).status).toBe('fail')
  })

  it('passes on tokens', () => {
    write('src/App.tsx', '<div className="bg-card text-foreground ms-2">x</div>')
    expect(respectsDesignSystem(root).status).toBe('pass')
  })
})

describe('listHasAllStates', () => {
  it('passes when there is no dynamic list at all', () => {
    write('src/App.tsx', 'export default function App(){ return <div>שלום</div> }')
    expect(listHasAllStates(root).status).toBe('pass')
  })

  it('fails a list missing empty and error states', () => {
    write(
      'src/List.tsx',
      'const [rows,setRows]=useState([]); useEffect(()=>{},[]); return rows.map(r=><li>{r}</li>)'
    )
    expect(listHasAllStates(root).status).toBe('fail')
  })

  it('passes a list with all three states', () => {
    write(
      'src/List.tsx',
      `const [rows,setRows]=useState([]); useEffect(()=>{},[]);
       if (loading) return <p>טוען…</p>
       if (error) return <p>שגיאה</p>
       if (!rows.length) return <p>לא נמצאו תוצאות</p>
       return rows.map(r=><li>{r}</li>)`
    )
    expect(listHasAllStates(root).status).toBe('pass')
  })
})

describe('noHardcodedSecrets', () => {
  it('catches an OpenAI-style key', () => {
    write('src/api.ts', 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456"')
    expect(noHardcodedSecrets(root).status).toBe('fail')
  })

  it('catches an assigned api key', () => {
    write('src/api.ts', 'const config = { apiKey: "abcd1234efgh5678ijkl" }')
    expect(noHardcodedSecrets(root).status).toBe('fail')
  })

  it('passes on env usage', () => {
    write('src/api.ts', 'const key = import.meta.env.VITE_API_KEY')
    expect(noHardcodedSecrets(root).status).toBe('pass')
  })
})

describe('sourceMatches / sourceLacks', () => {
  it('finds a required pattern', () => {
    write('src/App.tsx', '<form onSubmit={x}></form>')
    expect(sourceMatches('form', /<form[\s>]/i)(root).status).toBe('pass')
  })

  it('reports a forbidden pattern with its location', () => {
    write('src/App.tsx', '<img src="https://cdn.example.com/a.png" />')
    const r = sourceLacks('no external images', /src=["']https?:\/\//)(root)
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('App.tsx')
  })
})

describe('runChecks / summarize', () => {
  it('separates a broken check from a failed task', () => {
    const results = runChecks(root, [
      () => {
        throw new Error('boom')
      }
    ])
    expect(results[0]!.status).toBe('error')
    expect(summarize(results).errored).toBe(1)
    expect(summarize(results).ok).toBe(false)
  })

  it('counts a clean run as ok', () => {
    write('index.html', '<html lang="he" dir="rtl"></html>')
    const results = runChecks(root, [rtlDocument])
    expect(summarize(results).ok).toBe(true)
  })
})

describe('task suite integrity', () => {
  it('has a meaningful number of reference tasks', () => {
    expect(EVAL_TASKS.length).toBeGreaterThanOrEqual(15)
  })

  it('uses unique ids', () => {
    const ids = EVAL_TASKS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every build task carries acceptance checks', () => {
    for (const t of EVAL_TASKS.filter((t) => t.workMode === 'BUILD')) {
      expect(t.checks.length, t.id).toBeGreaterThan(0)
    }
  })

  it('every prompt is written in Hebrew', () => {
    for (const t of EVAL_TASKS) {
      expect(/[֐-׿]/.test(t.prompt), t.id).toBe(true)
    }
  })

  it('looks tasks up by id', () => {
    expect(getTask('landing-lawyer')?.workMode).toBe('BUILD')
    expect(getTask('nope')).toBeUndefined()
  })

  it('marks non-build tasks read-only', () => {
    expect(isReadOnlyTask(getTask('ask-mode-no-writes')!)).toBe(true)
    expect(isReadOnlyTask(getTask('landing-lawyer')!)).toBe(false)
  })
})
