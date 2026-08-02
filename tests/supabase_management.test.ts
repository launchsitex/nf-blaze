import { describe, expect, it, vi } from 'vitest'

// חוסמים את שרשרת ה-import של electron/סודות כדי לבדוק את הלוגיקה הטהורה
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/nf-test' } }))
vi.mock('../src/main/services/secrets', () => ({
  getSecret: () => undefined,
  supabaseMgmtSlot: (id: string) => `supabase-mgmt-${id}`
}))
vi.mock('../src/main/services/storage', () => ({ getProject: () => undefined }))
vi.mock('../src/main/services/integrations/store', () => ({
  loadIntegrations: () => ({ supabase: { connected: false } })
}))

const { isDestructiveSql, projectRefFromUrl, buildSupabaseSqlTool } = await import(
  '../src/main/services/integrations/supabase_management'
)

describe('isDestructiveSql — זיהוי פעולות הרסניות לאזהרה', () => {
  it('מזהה DROP / TRUNCATE / DELETE / ALTER DROP', () => {
    expect(isDestructiveSql('drop table foo')).toBe(true)
    expect(isDestructiveSql('DROP TABLE public.users')).toBe(true)
    expect(isDestructiveSql('truncate orders')).toBe(true)
    expect(isDestructiveSql('delete from customers where id = 1')).toBe(true)
    expect(isDestructiveSql('alter table x drop column y')).toBe(true)
    expect(isDestructiveSql('drop policy p on t')).toBe(true)
  })

  it('לא מסמן פעולות בטוחות', () => {
    expect(isDestructiveSql('create table foo (id serial primary key)')).toBe(false)
    expect(isDestructiveSql('insert into foo (n) values (1)')).toBe(false)
    expect(isDestructiveSql('select * from foo')).toBe(false)
    expect(isDestructiveSql('alter table x add column y text')).toBe(false)
    expect(isDestructiveSql('update foo set n = 2 where id = 1')).toBe(false)
  })

  it('לא מתבלבל ממילת מפתח בתוך מחרוזת או הערה', () => {
    expect(isDestructiveSql("insert into logs (msg) values ('drop table x')")).toBe(false)
    expect(isDestructiveSql('-- drop table x\nselect 1')).toBe(false)
    expect(isDestructiveSql('/* delete from x */ select 1')).toBe(false)
  })
})

describe('projectRefFromUrl', () => {
  it('מחלץ ref מכתובת תקינה', () => {
    expect(projectRefFromUrl('https://abcd1234.supabase.co')).toBe('abcd1234')
    expect(projectRefFromUrl('https://abcd1234.supabase.co/')).toBe('abcd1234')
    expect(projectRefFromUrl('  https://Ilsidpix.supabase.co  ')).toBe('Ilsidpix')
  })

  it('מחזיר null לכתובת לא תקינה', () => {
    expect(projectRefFromUrl('not a url')).toBeNull()
    expect(projectRefFromUrl('https://example.com')).toBeNull()
    expect(projectRefFromUrl('')).toBeNull()
  })
})

describe('buildSupabaseSqlTool — בלי token מחזיר null', () => {
  it('אין access token → אין כלי run_sql (fallback ל«כתוב SQL למשתמש»)', () => {
    expect(buildSupabaseSqlTool('proj-1')).toBeNull()
  })
})
