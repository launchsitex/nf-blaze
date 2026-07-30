import { describe, expect, it, vi } from 'vitest'
import { assertAllowlistedCommand, staticServerCommand } from './allowlist'
import { normalizeRelPath, toAbsoluteInWorkdir } from './paths'
import { SessionRuntime, type E2BSandboxHandle } from './session'
import {
  createSession,
  destroyAllSessions,
  destroySession,
  getSession,
  listSessionIds
} from './index'

function mockSandbox(): E2BSandboxHandle {
  return {
    sandboxId: 'sbx-test-1',
    files: {
      makeDir: vi.fn(async () => true),
      writeFiles: vi.fn(async () => [])
    },
    commands: {
      run: vi.fn(async (cmd: string) => ({
        exitCode: 0,
        stdout: `ok:${cmd}`,
        stderr: ''
      }))
    },
    getHost: vi.fn((port: number) => `${port}-sbx-test-1.e2b.app`),
    kill: vi.fn(async () => undefined)
  }
}

describe('sandbox paths', () => {
  it('normalizes relative paths', () => {
    expect(normalizeRelPath('src/App.tsx')).toBe('src/App.tsx')
    expect(normalizeRelPath('./a/b')).toBe('a/b')
  })

  it('blocks traversal', () => {
    expect(() => normalizeRelPath('../etc/passwd')).toThrow(/לא תקין/)
    expect(() => normalizeRelPath('a/../../b')).toThrow(/לא תקין/)
  })

  it('builds absolute workdir paths', () => {
    expect(toAbsoluteInWorkdir('/home/user/project', 'index.html')).toBe(
      '/home/user/project/index.html'
    )
  })
})

describe('sandbox allowlist', () => {
  it('allows npm install / build / preview', () => {
    expect(assertAllowlistedCommand('npm install')).toBe('npm install')
    expect(assertAllowlistedCommand('  npm   run  build ')).toBe('npm run build')
  })

  it('rejects unsafe commands', () => {
    expect(() => assertAllowlistedCommand('rm -rf /')).toThrow(/לא מורשית/)
    expect(() => assertAllowlistedCommand('npx create-react-app')).toThrow(/לא מורשית/)
    expect(() => assertAllowlistedCommand('node -e "1"')).toThrow(/לא מורשית/)
  })

  it('builds static server command', () => {
    expect(staticServerCommand(3000)).toBe('python3 -m http.server 3000')
    expect(() => staticServerCommand(0)).toThrow(/פורט/)
  })
})

describe('SessionRuntime (mocked E2B)', () => {
  it('creates session, writes files, runs install/build, returns preview URL', async () => {
    const handle = mockSandbox()
    const runtime = await SessionRuntime.create(
      'user-session-1',
      { previewPort: 5173 },
      async () => handle
    )

    expect(runtime.sandboxId).toBe('sbx-test-1')
    expect(handle.files.makeDir).toHaveBeenCalledWith('/home/user/project')

    await runtime.writeFiles([
      { path: 'package.json', content: '{"name":"demo","scripts":{"build":"echo ok"}}' },
      { path: 'index.html', content: '<h1>hi</h1>' }
    ])
    expect(handle.files.writeFiles).toHaveBeenCalledWith([
      { path: '/home/user/project/package.json', data: expect.any(String) },
      { path: '/home/user/project/index.html', data: '<h1>hi</h1>' }
    ])

    const install = await runtime.npmInstall()
    expect(install.exitCode).toBe(0)
    expect(handle.commands.run).toHaveBeenCalledWith(
      'npm install',
      expect.objectContaining({ cwd: '/home/user/project' })
    )

    const build = await runtime.npmBuild()
    expect(build.exitCode).toBe(0)

    const url = await runtime.startPreview({ command: 'static', port: 5173 })
    expect(url).toBe('https://5173-sbx-test-1.e2b.app')
    expect(runtime.info().previewUrl).toBe(url)

    await runtime.destroy()
    expect(handle.kill).toHaveBeenCalled()
    expect(() => runtime.getPreviewUrl()).toThrow(/נהרס/)
  })

  it('rejects writing outside workdir via traversal', async () => {
    const handle = mockSandbox()
    const runtime = await SessionRuntime.create('s2', {}, async () => handle)
    await expect(
      runtime.writeFiles([{ path: '../secret.txt', content: 'x' }])
    ).rejects.toThrow(/לא תקין/)
  })
})

describe('session registry', () => {
  it('tracks sessions by id with injected factory', async () => {
    await destroyAllSessions()
    const handle = mockSandbox()
    const created = await createSession('reg-live', { previewPort: 4000 }, async () => handle)

    expect(getSession('reg-live')).toBe(created)
    expect(listSessionIds()).toEqual(['reg-live'])
    expect(await destroySession('reg-live')).toBe(true)
    expect(getSession('reg-live')).toBeUndefined()
    expect(await destroySession('missing')).toBe(false)
  })
})
