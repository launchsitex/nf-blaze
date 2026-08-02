import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AiProvider } from '../../shared/types'

type KeySlot = 'openai' | 'anthropic' | 'gemini' | 'github' | string

function secretsDir(): string {
  const d = join(app.getPath('userData'), 'nf-blaze-data', 'secrets')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function secretPath(slot: KeySlot): string {
  const safe = String(slot).replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(secretsDir(), `${safe}.bin`)
}

function providerToSlot(provider: AiProvider): KeySlot {
  // slot = provider id (openai / anthropic / gemini / openrouter / ollama / lmstudio)
  return provider
}

function writeSecret(slot: KeySlot, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) {
    clearSecret(slot)
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(secretPath(slot), safeStorage.encryptString(trimmed))
  } else {
    console.warn(
      `[secrets] OS encryption unavailable — storing "${slot}" as plaintext on disk. ` +
        'This is a fallback for unsupported environments; secrets are not protected at rest.'
    )
    writeFileSync(secretPath(slot), Buffer.from(`plain:${trimmed}`, 'utf-8'))
  }
}

function readSecret(slot: KeySlot): string | null {
  const path = secretPath(slot)
  if (!existsSync(path)) return null
  try {
    const buf = readFileSync(path)
    const encryption = safeStorage.isEncryptionAvailable()
    if (buf.subarray(0, 6).toString('utf-8') === 'plain:') {
      /*
       * ‏`plain:` מתקבל **רק** כשההצפנה של מערכת ההפעלה אינה זמינה — כלומר
       * במצב ה-fallback שבו הוא גם נכתב. קודם הוא התקבל תמיד, וזה אפשר
       * לכל אחד לשתול קובץ סוד שהאפליקציה מקבלת בלי לעבור דרך safeStorage
       * — כולל את קובצי מצב הרישיון, שה-HMAC שלהם נגזר מערכים ידועים.
       */
      if (!encryption) return buf.subarray(6).toString('utf-8')
      return null
    }
    if (encryption) return safeStorage.decryptString(buf)
    return null
  } catch {
    return null
  }
}

export function clearSecret(slot: KeySlot): void {
  const path = secretPath(slot)
  if (existsSync(path)) unlinkSync(path)
}

export function setSecret(slot: KeySlot, value: string): void {
  writeSecret(slot, value)
}

export function getSecret(slot: KeySlot): string | null {
  return readSecret(slot)
}

export function hasSecret(slot: KeySlot): boolean {
  return Boolean(readSecret(slot))
}

export function setApiKey(provider: AiProvider, key: string): void {
  writeSecret(providerToSlot(provider), key)
}

export function getApiKey(provider: AiProvider): string | null {
  return readSecret(providerToSlot(provider))
}

export function hasApiKey(provider: AiProvider): boolean {
  return Boolean(getApiKey(provider))
}

export function clearApiKey(provider: AiProvider): void {
  clearSecret(providerToSlot(provider))
}

export function getKeyStatus(): {
  hasOpenaiKey: boolean
  hasAnthropicKey: boolean
  hasGeminiKey: boolean
  hasOpenrouterKey: boolean
  hasGithubToken: boolean
  hasVercelToken: boolean
  hasVercelPlatformToken: boolean
  encryptionAvailable: boolean
} {
  return {
    hasOpenaiKey: hasApiKey('openai'),
    hasAnthropicKey: hasApiKey('anthropic'),
    hasGeminiKey: hasApiKey('gemini'),
    hasOpenrouterKey: hasApiKey('openrouter'),
    hasGithubToken: hasSecret('github'),
    hasVercelToken: hasSecret('vercel'),
    hasVercelPlatformToken:
      hasSecret('vercel-platform') || Boolean(process.env.NF_BLAZE_VERCEL_TOKEN?.trim()),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

export function setGithubToken(token: string): void {
  writeSecret('github', token)
}

export function getGithubToken(): string | null {
  return readSecret('github')
}

export function clearGithubToken(): void {
  clearSecret('github')
}

export function setVercelToken(token: string): void {
  writeSecret('vercel', token)
}

export function getVercelToken(): string | null {
  return readSecret('vercel')
}

export function clearVercelToken(): void {
  clearSecret('vercel')
}

export function setVercelPlatformToken(token: string): void {
  writeSecret('vercel-platform', token)
}

export function getVercelPlatformToken(): string | null {
  return readSecret('vercel-platform')
}

export function clearVercelPlatformToken(): void {
  clearSecret('vercel-platform')
}

export function supabaseAnonSlot(projectId: string): string {
  return `supabase-anon-${projectId}`
}

export function supabaseServiceSlot(projectId: string): string {
  return `supabase-service-${projectId}`
}

/** Personal Access Token לגישת הסוכן ל-Management API (הרצת SQL) */
export function supabaseMgmtSlot(projectId: string): string {
  return `supabase-mgmt-${projectId}`
}
