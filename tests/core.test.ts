import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSafePath, writeProjectFile, readProjectFile } from '../src/main/services/filesystem'
import { parseAgentResponse } from '../src/main/services/ai/llm'
import { getDefaultModel, AI_PROVIDERS, coerceWorkModeSelection } from '../src/shared/types'
import { buildAgentSystemPrompt } from '../src/shared/prompts'
import { resolveWorkMode, modeSystemAppendix } from '../agent/intent'

describe('work mode enforcement', () => {
  it('coerceWorkModeSelection: missing → ASK', () => {
    expect(coerceWorkModeSelection(undefined)).toBe('ASK')
    expect(coerceWorkModeSelection(null)).toBe('ASK')
    expect(coerceWorkModeSelection('auto')).toBe('auto')
    expect(coerceWorkModeSelection('BUILD')).toBe('BUILD')
  })

  it('resolveWorkMode: missing selection → ASK without calling a model', async () => {
    const r = await resolveWorkMode({
      selection: undefined,
      userMessage: 'תוסיף כפתור',
      model: 'gpt-test'
    })
    expect(r).toEqual({ mode: 'ASK', source: 'manual' })
  })

  it('resolveWorkMode: auto uses complete callback (real detection)', async () => {
    const r = await resolveWorkMode({
      selection: 'auto',
      userMessage: 'מה אתה חושב על המבנה?',
      model: 'fast',
      complete: async () => '{"intent":"ASK"}'
    })
    expect(r).toEqual({ mode: 'ASK', source: 'auto' })
  })

  it('resolveWorkMode: manual BUILD wins over any detection', async () => {
    const r = await resolveWorkMode({
      selection: 'BUILD',
      userMessage: 'מה אתה חושב?',
      model: 'fast',
      complete: async () => '{"intent":"ASK"}'
    })
    expect(r).toEqual({ mode: 'BUILD', source: 'manual' })
  })

  it('ASK/PLAN system prompt has no nfblaze write format', () => {
    const ask = buildAgentSystemPrompt('p', 'a.ts', '', '', '', 'ASK')
    const plan = buildAgentSystemPrompt('p', 'a.ts', '', '', '', 'PLAN')
    const build = buildAgentSystemPrompt('p', 'a.ts', '', '', '', 'BUILD')
    expect(ask.toLowerCase()).not.toContain('nfblaze')
    expect(plan.toLowerCase()).not.toContain('nfblaze')
    expect(ask).toContain('המשתמש בחר מצב שאלה')
    expect(plan).toContain('תוכנית ממוספרת')
    expect(plan).toContain('clarify')
    expect(build.toLowerCase()).toContain('nfblaze')
    expect(modeSystemAppendix('ASK')).toContain('מצב שאלה')
    expect(modeSystemAppendix('PLAN')).toContain('תוכנית ממוספרת')
  })

  it('strips action blocks from history content', async () => {
    const { sanitizeHistoryContentForReadOnly } = await import('../src/main/services/ai/llm')
    const raw =
      'סיכום\n```nfblaze\n{"actions":[{"type":"write","path":"a.ts","content":"x"}]}\n```'
    expect(sanitizeHistoryContentForReadOnly(raw)).toBe('סיכום')
  })

  it('parses clarify and ignores write actions when both present', async () => {
    const { parseAgentResponse } = await import('../src/main/services/ai/llm')
    const raw = `רגע\n\`\`\`clarify\n{"type":"clarify","questions":[{"q":"איזה סגנון?","options":["מינימלי","עשיר"],"multi":false}]}\n\`\`\`\n\`\`\`nfblaze\n{"actions":[{"type":"write","path":"x.ts","content":"1"}]}\n\`\`\``
    const parsed = parseAgentResponse(raw)
    expect(parsed.clarify?.questions).toHaveLength(1)
    expect(parsed.clarify?.questions[0].q).toBe('איזה סגנון?')
    expect(parsed.actions).toHaveLength(0)
    expect(parsed.message).not.toMatch(/nfblaze|clarify/i)
  })
})

describe('resolveSafePath', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `nf-blaze-test-${Date.now()}`)
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('allows files inside the project', () => {
    const full = resolveSafePath(root, 'src/index.html')
    expect(full).toBe(join(root, 'src', 'index.html'))
  })

  it('blocks path traversal with ..', () => {
    expect(() => resolveSafePath(root, '../secret.txt')).toThrow(/חסומה|מחוץ/)
  })

  it('blocks absolute-looking escapes', () => {
    expect(() => resolveSafePath(root, '..\\..\\Windows\\System32')).toThrow()
  })

  it('writes and reads files safely', () => {
    writeProjectFile(root, 'hello.txt', 'שלום')
    expect(readProjectFile(root, 'hello.txt')).toBe('שלום')
    expect(existsSync(join(root, 'hello.txt'))).toBe(true)
  })
})

describe('parseAgentResponse', () => {
  it('parses nfblaze block and keeps live narrative', () => {
    const raw = `הנה האתר\n\`\`\`nfblaze\n{"message":"נוצר דף","previewFile":"index.html","actions":[{"type":"write","path":"index.html","content":"<html></html>"}]}\n\`\`\``
    const parsed = parseAgentResponse(raw)
    expect(parsed.message).toBe('הנה האתר')
    expect(parsed.previewFile).toBe('index.html')
    expect(parsed.actions).toHaveLength(1)
    expect(parsed.actions[0].type).toBe('write')
    expect(parsed.actions[0].path).toBe('index.html')
  })

  it('rejects traversal in actions', () => {
    const raw = `\`\`\`nfblaze\n{"actions":[{"type":"write","path":"../evil.js","content":"x"}]}\n\`\`\``
    const parsed = parseAgentResponse(raw)
    expect(parsed.actions).toHaveLength(0)
  })

  it('parses edit actions', () => {
    const raw = `\`\`\`nfblaze\n{"actions":[{"type":"edit","path":"a.js","old_string":"foo","new_string":"bar"}]}\n\`\`\``
    const parsed = parseAgentResponse(raw)
    expect(parsed.actions).toHaveLength(1)
    expect(parsed.actions[0].type).toBe('edit')
    expect(parsed.actions[0].old_string).toBe('foo')
    expect(parsed.actions[0].new_string).toBe('bar')
  })
})

describe('stripActionBlocksForDisplay', () => {
  it('hides nfblaze block from live chat text', async () => {
    const { stripActionBlocksForDisplay } = await import('../src/main/services/ai/llm')
    const raw =
      'אני בונה דף נחיתה\n```nfblaze\n{"message":"ok","actions":[]}\n```'
    expect(stripActionBlocksForDisplay(raw)).toBe('אני בונה דף נחיתה')
  })
})

describe('model catalog (24/07/2026)', () => {
  it('includes current frontier models', () => {
    const openai = AI_PROVIDERS.find((p) => p.id === 'openai')!
    const anthropic = AI_PROVIDERS.find((p) => p.id === 'anthropic')!
    const gemini = AI_PROVIDERS.find((p) => p.id === 'gemini')!

    expect(openai.models.some((m) => m.id === 'gpt-5.6-sol')).toBe(true)
    expect(anthropic.models.some((m) => m.id === 'claude-opus-4-8')).toBe(true)
    expect(anthropic.models.some((m) => m.id === 'claude-fable-5')).toBe(true)
    expect(gemini.models.some((m) => m.id === 'gemini-3.6-flash')).toBe(true)
    expect(gemini.models.some((m) => m.id === 'gemini-2.5-pro')).toBe(true)
  })

  it('default models are recommended', () => {
    expect(getDefaultModel('openai')).toBe('gpt-5.6-sol')
    expect(getDefaultModel('anthropic')).toBe('claude-opus-4-8')
    expect(getDefaultModel('gemini')).toBe('gemini-3.1-pro-preview')
  })

  it('every model declares a context window', () => {
    for (const p of AI_PROVIDERS) {
      for (const m of p.models) {
        expect(m.contextWindow).toBeGreaterThan(10_000)
      }
    }
  })
})

describe('context usage helpers', () => {
  it('estimates tokens and builds a usage breakdown', async () => {
    const { estimateTokens, buildContextUsage, formatTokenCount } = await import(
      '../src/shared/context'
    )
    expect(estimateTokens('hello world')).toBeGreaterThan(0)
    expect(estimateTokens('שלום עולם בעברית ארוכה יותר')).toBeGreaterThan(2)
    const usage = buildContextUsage({
      modelId: 'gpt-5.6-sol',
      contextWindow: 256000,
      systemPrompt: 'system ' + 'x'.repeat(400),
      fileContext: 'files ' + 'y'.repeat(800),
      integrations: 'integ',
      conversation: 'chat ' + 'z'.repeat(2000),
      activeFile: 'active file content'
    })
    expect(usage.percent).toBeGreaterThan(0)
    expect(usage.usedTokens).toBeLessThan(usage.contextWindow)
    expect(usage.buckets.length).toBeGreaterThanOrEqual(2)
    expect(formatTokenCount(9700)).toBe('9.7K')
    expect(formatTokenCount(488)).toBe('488')
  })
})

describe('shell allowlist', () => {
  it('parses safe npm scripts only', async () => {
    const { parseSafeNpmScript } = await import('../src/main/services/shell')
    expect(parseSafeNpmScript('npm install')?.args).toEqual(['install'])
    expect(parseSafeNpmScript('npm run build')?.args).toEqual(['run', 'build'])
    expect(parseSafeNpmScript('rm -rf /')).toBeNull()
  })

  it('rejects npx and node as commands', async () => {
    const { runAllowlistedShell } = await import('../src/main/services/shell')
    await expect(
      runAllowlistedShell({ projectId: 'x', command: 'npx', args: ['create-react-app'] })
    ).rejects.toThrow(/לא מורשית/)
    await expect(
      runAllowlistedShell({ projectId: 'x', command: 'node', args: ['-e', '1'] })
    ).rejects.toThrow(/לא מורשית/)
  })
})

describe('preview protocol URL', () => {
  it('builds nfblaze preview urls with encoded paths', async () => {
    const { buildPreviewUrl } = await import('../src/main/services/preview-protocol')
    const url = buildPreviewUrl('proj-123', 'css/style.css')
    expect(url).toBe('nfblaze://preview/proj-123/css/style.css')
    const nested = buildPreviewUrl('proj-123', 'pages/about.html')
    expect(nested).toContain('nfblaze://preview/')
    expect(nested).toContain('pages/about.html')
  })
})

describe('supabase url + env helpers', () => {
  it('normalizes valid supabase urls and rejects bad ones', async () => {
    const { normalizeSupabaseUrl } = await import('../src/main/services/integrations/supabase')
    expect(normalizeSupabaseUrl('https://abcd.supabase.co/')).toBe('https://abcd.supabase.co')
    expect(() => normalizeSupabaseUrl('https://evil.com')).toThrow(/לא חוקית/)
  })

  it('writes .env and .gitignore without leaking service key to .env', async () => {
    const { mkdirSync, readFileSync, rmSync, existsSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { writeSupabaseEnvFiles } = await import('../src/main/services/integrations/supabase')

    const root = join(tmpdir(), `nf-blaze-sb-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    writeSupabaseEnvFiles(
      root,
      'https://abcd.supabase.co',
      'anon-key-value',
      'service-secret-value'
    )

    const env = readFileSync(join(root, '.env'), 'utf-8')
    expect(env).toContain('VITE_SUPABASE_URL=https://abcd.supabase.co')
    expect(env).toContain('VITE_SUPABASE_ANON_KEY=anon-key-value')
    expect(env).not.toContain('service-secret-value')
    expect(env).not.toContain('SERVICE_ROLE')

    const envLocal = readFileSync(join(root, '.env.local'), 'utf-8')
    expect(envLocal).toContain('SUPABASE_SERVICE_ROLE_KEY=service-secret-value')

    const gi = readFileSync(join(root, '.gitignore'), 'utf-8')
    expect(gi).toContain('.env')
    expect(gi).toContain('.env.local')
    expect(existsSync(join(root, 'src', 'lib', 'supabase.js'))).toBe(false) // scaffold separate

    rmSync(root, { recursive: true, force: true })
  })
})

describe('github clone url auth helper', () => {
  it('accepts only github https clone urls via regex used in link', () => {
    const re = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/i
    expect(re.test('https://github.com/acme/app.git')).toBe(true)
    expect(re.test('https://evil.com/acme/app.git')).toBe(false)
    expect(re.test('git@github.com:acme/app.git')).toBe(false)
  })
})

describe('html preview discovery', () => {
  it('finds index.html preferentially from a tree', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { buildFileTree } = await import('../src/main/services/filesystem')

    const root = join(tmpdir(), `nf-blaze-html-${Date.now()}`)
    mkdirSync(join(root, 'css'), { recursive: true })
    writeFileSync(join(root, 'about.html'), '<html>about</html>', 'utf-8')
    writeFileSync(join(root, 'index.html'), '<html>home</html>', 'utf-8')
    writeFileSync(join(root, 'css', 'style.css'), 'body{}', 'utf-8')

    const tree = buildFileTree(root)
    const all: string[] = []
    function walk(nodes: typeof tree): void {
      for (const n of nodes) {
        if (!n.isDirectory && /\.html?$/i.test(n.name)) all.push(n.relativePath)
        if (n.children) walk(n.children)
      }
    }
    walk(tree)
    const preferred = ['index.html', 'index.htm', 'home.html']
    let found: string | null = null
    for (const p of preferred) {
      const hit = all.find((x) => x.replace(/\\/g, '/').toLowerCase() === p)
      if (hit) {
        found = hit
        break
      }
    }
    if (!found) found = all[0] || null

    expect(found?.replace(/\\/g, '/')).toBe('index.html')
    rmSync(root, { recursive: true, force: true })
  })

  it('serves preview content via resolveSafePath after write', async () => {
    const { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { writeProjectFile, readProjectFile, resolveSafePath } = await import(
      '../src/main/services/filesystem'
    )

    const root = join(tmpdir(), `nf-blaze-prev-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    writeProjectFile(
      root,
      'index.html',
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="css/style.css"></head><body><h1>שלום</h1></body></html>'
    )
    writeProjectFile(root, 'css/style.css', 'h1{color:red}')

    const htmlPath = resolveSafePath(root, 'index.html')
    expect(existsSync(htmlPath)).toBe(true)
    const html = readProjectFile(root, 'index.html')
    expect(html).toContain('שלום')
    expect(html).toContain('css/style.css')
    expect(readFileSync(resolveSafePath(root, 'css/style.css'), 'utf-8')).toContain('color:red')

    rmSync(root, { recursive: true, force: true })
  })
})

// mock משותף ל-storage — הטסטים של snapshots מכוונים אותו לתיקייה זמנית
const snapshotTestHolder = vi.hoisted(() => ({ folderPath: '' }))
vi.mock('../src/main/services/storage', () => ({
  getProject: () => ({ id: 'p1', folderPath: snapshotTestHolder.folderPath })
}))

describe('version history — restore to any checkpoint', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('restores cumulatively from newest down to the chosen point', async () => {
    const { createSnapshot, listSnapshots, restoreToSnapshot, undoLatestSnapshot, getLatestSnapshotId } =
      await import('../src/main/services/snapshots')

    const root = join(tmpdir(), `nf-blaze-hist-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    snapshotTestHolder.folderPath = root

    // סבב 1: יצירת a.txt
    const s1 = createSnapshot('p1', [{ type: 'write', path: 'a.txt' }])
    writeProjectFile(root, 'a.txt', 'v1')
    await wait(10)

    // סבב 2: שינוי a.txt + יצירת b.txt
    const s2 = createSnapshot('p1', [
      { type: 'write', path: 'a.txt' },
      { type: 'write', path: 'b.txt' }
    ])
    writeProjectFile(root, 'a.txt', 'v2')
    writeProjectFile(root, 'b.txt', 'b1')
    await wait(10)

    // סבב 3: שינוי a.txt
    const s3 = createSnapshot('p1', [{ type: 'write', path: 'a.txt' }])
    writeProjectFile(root, 'a.txt', 'v3')

    expect(s1 && s2 && s3).toBeTruthy()
    const list = listSnapshots('p1')
    expect(list.map((s) => s.id)).toEqual([s3!.id, s2!.id, s1!.id])

    // שחזור לנקודה 2 = מצב שלפני סבב 2: a=v1, b לא קיים
    const res = restoreToSnapshot('p1', s2!.id)
    expect(res.ok).toBe(true)
    expect(readProjectFile(root, 'a.txt')).toBe('v1')
    expect(existsSync(join(root, 'b.txt'))).toBe(false)

    // נשארה רק נקודה 1, והיא ה-latest (בטל עדיין עובד)
    expect(listSnapshots('p1').map((s) => s.id)).toEqual([s1!.id])
    expect(getLatestSnapshotId('p1')).toBe(s1!.id)

    // בטל אחרון → a.txt נמחק (לא היה קיים לפני סבב 1)
    const undo = undoLatestSnapshot('p1')
    expect(undo.ok).toBe(true)
    expect(existsSync(join(root, 'a.txt'))).toBe(false)

    rmSync(root, { recursive: true, force: true })
  })
})

describe('snapshot diff — before vs after per round', () => {
  it('returns real changes only, marking created files, skipping untouched', async () => {
    const { createSnapshot, getSnapshotDiff } = await import('../src/main/services/snapshots')

    const root = join(tmpdir(), `nf-blaze-diff-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    snapshotTestHolder.folderPath = root

    writeProjectFile(root, 'kept.txt', 'old content')
    writeProjectFile(root, 'same.txt', 'unchanged')

    const s = createSnapshot('p1', [
      { type: 'write', path: 'kept.txt' },
      { type: 'write', path: 'same.txt' },
      { type: 'write', path: 'new.txt' },
      { type: 'write', path: 'gone.txt' }
    ])
    expect(s).toBeTruthy()

    writeProjectFile(root, 'kept.txt', 'new content')
    writeProjectFile(root, 'new.txt', 'created')

    const diff = getSnapshotDiff('p1', s!.id)
    expect(diff.ok).toBe(true)
    const byPath = Object.fromEntries(diff.files.map((f) => [f.path, f]))
    expect(byPath['kept.txt']).toEqual({ path: 'kept.txt', before: 'old content', after: 'new content' })
    expect(byPath['new.txt']).toEqual({ path: 'new.txt', before: null, after: 'created' })
    expect(byPath['same.txt']).toBeUndefined() // לא השתנה
    expect(byPath['gone.txt']).toBeUndefined() // לא היה ולא נוצר

    expect(getSnapshotDiff('p1', 'missing-id').ok).toBe(false)

    rmSync(root, { recursive: true, force: true })
  })
})

describe('multi-element selection context', () => {
  it('formats one element without numbering and many with numbered sections', async () => {
    const { formatSelectedElementsContext } = await import('../src/main/services/preview-select')

    expect(formatSelectedElementsContext(null)).toBe('')
    expect(formatSelectedElementsContext([])).toBe('')
    // אלמנט בלי שום מזהה — מסונן
    expect(formatSelectedElementsContext([{ file: '', line: 0 }])).toBe('')

    const single = formatSelectedElementsContext([
      { file: 'src/App.tsx', line: 12, component: 'Hero', tag: 'button' }
    ])
    expect(single).toContain('## אלמנט שנבחר')
    expect(single).toContain('src/App.tsx')
    expect(single).not.toContain('### אלמנט 1')

    const multi = formatSelectedElementsContext([
      { file: 'src/App.tsx', line: 12, component: 'Hero' },
      { file: '', line: 0, selector: 'div.card > button', text: 'הרשמה' },
      { file: 'src/Footer.tsx', line: 3, tag: 'footer' }
    ])
    expect(multi).toContain('3 אלמנטים שנבחרו')
    expect(multi).toContain('### אלמנט 1')
    expect(multi).toContain('### אלמנט 2')
    expect(multi).toContain('### אלמנט 3')
    expect(multi).toContain('div.card > button')
    expect(multi).toContain('«הרשמה»'.replace('«','"').replace('»','"'))
    expect(multi).toContain('כל האלמנטים')
  })
})

describe('line change stats (git --stat style)', () => {
  it('counts added/removed lines with multiset diff', async () => {
    const { lineChangeStats } = await import('../src/main/services/snapshots')
    expect(lineChangeStats(null, 'a\nb')).toEqual({ added: 2, removed: 0 })
    expect(lineChangeStats('a\nb', null)).toEqual({ added: 0, removed: 2 })
    expect(lineChangeStats('a\nb\nc', 'a\nX\nc')).toEqual({ added: 1, removed: 1 })
    expect(lineChangeStats('same', 'same')).toEqual({ added: 0, removed: 0 })
    expect(lineChangeStats('a\na\nb', 'a\nb')).toEqual({ added: 0, removed: 1 })
  })
})
