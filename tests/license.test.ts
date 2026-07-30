import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  formatLicenseKey,
  parseLicenseKey,
  signingInput,
  daysUntil,
  LICENSE_PREFIX,
  type LicensePayload
} from '../src/shared/license'

/** מנפיק מפתח לבדיקה עם זוג מפתחות זמני */
function issue(payload: LicensePayload, privateKeyPem: string): string {
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const sig = cryptoSign(null, signingInput(payloadB64), createPrivateKey(privateKeyPem))
  return formatLicenseKey(payloadB64, base64urlEncode(sig))
}

describe('license key format', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  const payload: LicensePayload = {
    id: 'abc12345',
    n: 'משרד תיווך אולמו',
    e: 'dani@example.com',
    exp: '2027-01-01',
    t: 'full',
    iat: '2026-07-30'
  }

  it('round-trips payload through issue → parse (including Hebrew)', () => {
    const key = issue(payload, pem)
    expect(key.startsWith(`${LICENSE_PREFIX}.`)).toBe(true)
    const parsed = parseLicenseKey(key)
    expect(parsed).not.toBeNull()
    expect(parsed!.payload.n).toBe('משרד תיווך אולמו')
    expect(parsed!.payload.exp).toBe('2027-01-01')
    expect(parsed!.payload.id).toBe('abc12345')
  })

  it('tolerates whitespace from copy-paste', () => {
    const key = issue(payload, pem)
    const messy = `  ${key.slice(0, 20)}\n${key.slice(20)}  `
    expect(parseLicenseKey(messy)?.payload.id).toBe('abc12345')
  })

  it('rejects malformed keys', () => {
    expect(parseLicenseKey('')).toBeNull()
    expect(parseLicenseKey('nonsense')).toBeNull()
    expect(parseLicenseKey('WRONG.aaa.bbb')).toBeNull()
    expect(parseLicenseKey(`${LICENSE_PREFIX}.notbase64json.bbb`)).toBeNull()
    // payload חוקי כ-base64 אבל בלי שדות חובה
    const empty = base64urlEncode(Buffer.from('{}', 'utf-8'))
    expect(parseLicenseKey(`${LICENSE_PREFIX}.${empty}.sig`)).toBeNull()
  })

  it('signature covers the payload — tampering breaks verification input', () => {
    const key = issue(payload, pem)
    const parts = key.split('.')
    const tampered: LicensePayload = { ...payload, exp: '2099-01-01' }
    const tamperedB64 = base64urlEncode(Buffer.from(JSON.stringify(tampered), 'utf-8'))
    // אותה חתימה על payload אחר → קלט החתימה שונה, ולכן האימות ייכשל
    expect(signingInput(tamperedB64).toString()).not.toBe(signingInput(parts[1]!).toString())
  })
})

describe('daysUntil', () => {
  it('counts remaining days and goes negative after expiry', () => {
    const now = new Date('2026-07-30T10:00:00')
    expect(daysUntil('2026-08-09', now)).toBe(11)
    expect(daysUntil('2026-07-30', now)).toBe(1)
    expect(daysUntil('2026-07-29', now)).toBeLessThan(1)
    expect(daysUntil('2026-01-01', now)).toBeLessThan(0)
  })
})
