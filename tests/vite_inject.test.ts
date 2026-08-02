import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/nf', getAppPath: () => '/tmp/nf' } }))

const { injectNfSourceIntoConfig } = await import('../src/main/services/templates')

describe('injectNfSourceIntoConfig — הזרקת בורר האלמנטים ל-vite.config', () => {
  it('מזריק ל-config בסגנון Dyad (React + plugins array)', () => {
    const src = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`
    const out = injectNfSourceIntoConfig(src)
    expect(out).not.toBeNull()
    expect(out).toContain("from './plugins/nf-blaze-source/src/index.js'")
    expect(out).toContain('plugins: [nfSourcePlugin(), react()]')
    // ה-import נוסף אחרי ה-import האחרון
    expect(out!.indexOf('nfSourcePlugin')).toBeGreaterThan(out!.indexOf('@vitejs/plugin-react'))
  })

  it('מדלג אם ה-plugin כבר מוזרק', () => {
    const src = `import { nfSourcePlugin } from './plugins/nf-blaze-source/src/index.js'
export default { plugins: [nfSourcePlugin()] }`
    expect(injectNfSourceIntoConfig(src)).toBeNull()
  })

  it('מטפל ב-plugins בלי רווח', () => {
    const src = `import react from '@vitejs/plugin-react'
export default { plugins:[react()] }`
    const out = injectNfSourceIntoConfig(src)
    expect(out).toContain('plugins: [nfSourcePlugin(), react()]')
  })

  it('לא נוגע בקונפיג בלי מערך plugins', () => {
    const src = `export default { build: { outDir: 'dist' } }`
    expect(injectNfSourceIntoConfig(src)).toBeNull()
  })
})
