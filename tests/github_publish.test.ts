import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/nf-test' } }))
vi.mock('../src/main/services/secrets', () => ({ getGithubToken: () => undefined }))
vi.mock('../src/main/services/storage', () => ({ getProject: () => undefined }))
vi.mock('../src/main/services/integrations/store', () => ({
  loadIntegrations: () => ({ github: { connected: false } }),
  updateIntegrations: () => undefined
}))

const { sanitizeBranchName, generateBranchName, buildGithubPublishTool } = await import(
  '../src/main/services/integrations/github'
)

describe('sanitizeBranchName', () => {
  it('רווחים הופכים למקפים ותווים לא חוקיים מוסרים', () => {
    expect(sanitizeBranchName('My Feature 123')).toBe('My-Feature-123')
    // עברית (לא \w) מוסרת; מה שנשאר הוא החלק הלטיני
    expect(sanitizeBranchName('שם עברי feature')).toBe('feature')
  })

  it('שומר על תווים חוקיים ב-git (._-/)', () => {
    expect(sanitizeBranchName('feature/new-thing_v2.1')).toBe('feature/new-thing_v2.1')
  })

  it('חותך מקפים/נקודות בקצוות ומגביל אורך', () => {
    expect(sanitizeBranchName('--abc--')).toBe('abc')
    expect(sanitizeBranchName('a'.repeat(200)).length).toBeLessThanOrEqual(80)
  })
})

describe('generateBranchName', () => {
  it('בפורמט nf-blaze-<hex>', () => {
    const b = generateBranchName()
    expect(b).toMatch(/^nf-blaze-[0-9a-f]{6}$/)
  })
  it('ייחודי בין קריאות', () => {
    expect(generateBranchName()).not.toBe(generateBranchName())
  })
})

describe('buildGithubPublishTool — בלי חשבון GitHub מחזיר null', () => {
  it('אין token → אין כלי publish_github', () => {
    expect(buildGithubPublishTool('proj-1')).toBeNull()
  })
})
