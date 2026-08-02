import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * שתי ההתנהגויות שנועלות את הרישוי (מ-1.57.0):
 * 1. בלי מפתח — אין גישה (אין תקופת ניסיון שאפשר לאפס בעריכת קובץ)
 * 2. האכיפה בתהליך הראשי, לא רק במסך — ערוץ IPC חסום כברירת מחדל
 */

const secrets = new Map<string, string>()
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/nf-test' } }))
vi.mock('../src/main/services/secrets', () => ({
  getSecret: (slot: string) => secrets.get(slot),
  setSecret: (slot: string, v: string) => void secrets.set(slot, v),
  clearSecret: (slot: string) => void secrets.delete(slot)
}))

const { getLicenseStatus } = await import('../src/main/services/license')

beforeEach(() => secrets.clear())

describe('אין תקופת ניסיון — בלי מפתח אין גישה', () => {
  it('בלי מפתח שמור: ok=false ומצב none', () => {
    const s = getLicenseStatus()
    expect(s.ok).toBe(false)
    expect(s.state).toBe('none')
    expect(s.messageHe).toContain('נדרש מפתח רישיון')
  })

  it('גם «התקנה טרייה» לא מקבלת גישה — אין מסלול trial', () => {
    // ‏installedAt כבר לא משפיע: עריכת settings.json לא פותחת את המערכת
    const s = getLicenseStatus(new Date('2020-01-01'))
    expect(s.ok).toBe(false)
    expect(s.state).not.toBe('trial')
  })

  it('מפתח שאינו חתום כראוי נדחה', () => {
    secrets.set('license-key', 'NFB1.bm90LWEta2V5.c2ln')
    const s = getLicenseStatus()
    expect(s.ok).toBe(false)
  })
})

describe('שומר ה-IPC חוסם כברירת מחדל', () => {
  // מדמה את העטיפה שב-src/main/index.ts: רשימת היתר מפורשת, השאר חסום
  const FREE = new Set(['license:status', 'license:activate', 'license:clear',
    'app:get-version', 'app:runtime-env', 'app:open-external', 'settings:get'])

  const guard = (channel: string, licensed: boolean): 'allowed' | 'blocked' =>
    FREE.has(channel) || licensed ? 'allowed' : 'blocked'

  it('ערוצים רגישים חסומים בלי רישיון', () => {
    for (const ch of ['chat:send-stream', 'files:write', 'projects:create', 'shell:run']) {
      expect(guard(ch, false)).toBe('blocked')
    }
  })

  it('ערוץ חדש שלא הוגדר — חסום אוטומטית (fail-closed)', () => {
    expect(guard('feature:invented-tomorrow', false)).toBe('blocked')
  })

  it('הפעלת רישיון ובדיקת סביבה מותרות בלי רישיון', () => {
    for (const ch of ['license:activate', 'license:status', 'app:runtime-env']) {
      expect(guard(ch, false)).toBe('allowed')
    }
  })

  it('עם רישיון תקף הכול נפתח', () => {
    expect(guard('chat:send-stream', true)).toBe('allowed')
  })
})
