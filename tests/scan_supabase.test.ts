import { describe, expect, it } from 'vitest'
import { tablesFromOpenApi } from '../src/main/services/security/scan_supabase'

describe('tablesFromOpenApi — חילוץ טבלאות מהסכמה', () => {
  it('מוצא טבלאות מתוך paths', () => {
    const tables = tablesFromOpenApi({
      paths: { '/customers': {}, '/orders': {}, '/': {} }
    })
    expect(tables).toEqual(expect.arrayContaining(['customers', 'orders']))
  })

  it('מוצא טבלאות מתוך definitions', () => {
    expect(tablesFromOpenApi({ definitions: { invoices: {} } })).toContain('invoices')
  })

  it('מסנן ערכים פנימיים של PostgREST', () => {
    const tables = tablesFromOpenApi({
      paths: { '/rpc/do_thing': {}, '/graphql': {}, '/real_table': {} }
    })
    expect(tables).toContain('real_table')
    expect(tables).not.toContain('graphql')
    expect(tables.some((t) => t.startsWith('rpc/'))).toBe(false)
  })

  it('מחזיר רשימה ריקה לסכמה ריקה — בלי לזרוק', () => {
    expect(tablesFromOpenApi({})).toEqual([])
  })
})
