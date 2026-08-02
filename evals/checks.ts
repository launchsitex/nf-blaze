/**
 * בדיקות קבלה לסוויטת ה-Evals.
 *
 * כל בדיקה היא **אורקל דטרמיניסטי** על תיקיית הפרויקט אחרי שהסוכן סיים —
 * לא שיפוט של מודל. זה מה שמאפשר להשוות ריצות ולראות אם שינוי בפרומפט
 * או בכלי שיפר או הרס.
 *
 * היגיינת מדידה: כשל של המשימה וכשל של הבדיקה עצמה נספרים בנפרד
 * (`status: 'error'`), אחרת timeout נראה כמו תשובה שגויה ומזהם את האות.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { findDesignViolations } from '../agent/tools/design_rules'

export type CheckStatus = 'pass' | 'fail' | 'error'

export interface CheckResult {
  name: string
  status: CheckStatus
  detail?: string
}

export type Check = (rootDir: string) => CheckResult

const SKIP_DIRS = new Set(['node_modules', '.git', '.nf-blaze', 'dist', 'build', 'out'])

export function walkSourceFiles(rootDir: string, exts = /\.(tsx|jsx|ts|js|css|html)$/i): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) visit(full)
      else if (exts.test(name)) out.push(full)
    }
  }
  visit(rootDir)
  return out
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** קובץ קיים ואינו ריק */
export function fileExists(relPath: string): Check {
  return (rootDir) => {
    const full = join(rootDir, relPath)
    if (!existsSync(full)) {
      return { name: `קיים ${relPath}`, status: 'fail', detail: 'הקובץ לא נוצר' }
    }
    if (read(full).trim().length < 10) {
      return { name: `קיים ${relPath}`, status: 'fail', detail: 'הקובץ ריק כמעט לגמרי' }
    }
    return { name: `קיים ${relPath}`, status: 'pass' }
  }
}

/** ביטוי מופיע איפשהו בקוד המקור */
export function sourceMatches(label: string, pattern: RegExp): Check {
  return (rootDir) => {
    for (const file of walkSourceFiles(rootDir)) {
      if (pattern.test(read(file))) {
        return { name: label, status: 'pass', detail: relative(rootDir, file) }
      }
    }
    return { name: label, status: 'fail', detail: `לא נמצא: ${pattern}` }
  }
}

/** ביטוי **לא** מופיע בשום מקום */
export function sourceLacks(label: string, pattern: RegExp): Check {
  return (rootDir) => {
    for (const file of walkSourceFiles(rootDir)) {
      const content = read(file)
      const hit = content.match(pattern)
      if (hit) {
        return {
          name: label,
          status: 'fail',
          detail: `${relative(rootDir, file)}: "${hit[0].slice(0, 60)}"`
        }
      }
    }
    return { name: label, status: 'pass' }
  }
}

/** אין טקסט ממלא — הכשל הכי נפוץ של פלט AI */
export const noPlaceholderText: Check = (rootDir) => {
  const patterns = [
    /lorem ipsum/i,
    /תכונה\s*[123]\b/,
    /כאן יבוא/,
    /\bTODO\b/,
    /placeholder text/i,
    /your text here/i
  ]
  for (const file of walkSourceFiles(rootDir, /\.(tsx|jsx|html)$/i)) {
    const content = read(file)
    for (const p of patterns) {
      const hit = content.match(p)
      if (hit) {
        return {
          name: 'אין טקסט ממלא',
          status: 'fail',
          detail: `${relative(rootDir, file)}: "${hit[0]}"`
        }
      }
    }
  }
  return { name: 'אין טקסט ממלא', status: 'pass' }
}

/** תוכן עברי אמיתי — לא אתר באנגלית בפרויקט עברי */
export const hasHebrewContent: Check = (rootDir) => {
  for (const file of walkSourceFiles(rootDir, /\.(tsx|jsx|html)$/i)) {
    if (/[֐-׿]{3,}/.test(read(file))) {
      return { name: 'תוכן בעברית', status: 'pass', detail: relative(rootDir, file) }
    }
  }
  return { name: 'תוכן בעברית', status: 'fail', detail: 'לא נמצא טקסט עברי' }
}

/** RTL מוגדר ברמת המסמך */
export const rtlDocument: Check = (rootDir) => {
  const html = read(join(rootDir, 'index.html'))
  if (/dir\s*=\s*["']rtl["']/.test(html) && /lang\s*=\s*["']he["']/.test(html)) {
    return { name: 'index.html עם lang=he ו-dir=rtl', status: 'pass' }
  }
  return {
    name: 'index.html עם lang=he ו-dir=rtl',
    status: 'fail',
    detail: 'חסר dir="rtl" או lang="he"'
  }
}

/** מערכת העיצוב נשמרה — אותם כללים שנאכפים בכתיבה */
export const respectsDesignSystem: Check = (rootDir) => {
  for (const file of walkSourceFiles(rootDir, /\.(tsx|jsx)$/i)) {
    const findings = findDesignViolations(read(file))
    if (findings.length) {
      return {
        name: 'מכבד את מערכת העיצוב',
        status: 'fail',
        detail: `${relative(rootDir, file)}: ${findings[0]!.found}`
      }
    }
  }
  return { name: 'מכבד את מערכת העיצוב', status: 'pass' }
}

/** לכל רשימה יש loading / empty / error */
export const listHasAllStates: Check = (rootDir) => {
  const files = walkSourceFiles(rootDir, /\.(tsx|jsx)$/i).filter((f) => {
    const c = read(f)
    return /\.map\s*\(/.test(c) && /useState|useEffect/.test(c)
  })
  if (!files.length) {
    return { name: 'מצבי רשימה', status: 'pass', detail: 'אין רשימות דינמיות' }
  }
  for (const file of files) {
    const c = read(file)
    const hasLoading = /loading|טוען|בטעינה/i.test(c)
    const hasEmpty = /empty|אין תוצאות|לא נמצאו|ריק/i.test(c)
    const hasError = /error|שגיאה/i.test(c)
    if (!hasLoading || !hasEmpty || !hasError) {
      const missing = [
        !hasLoading ? 'loading' : '',
        !hasEmpty ? 'empty' : '',
        !hasError ? 'error' : ''
      ]
        .filter(Boolean)
        .join(', ')
      return {
        name: 'מצבי רשימה',
        status: 'fail',
        detail: `${relative(rootDir, file)} — חסר: ${missing}`
      }
    }
  }
  return { name: 'מצבי רשימה', status: 'pass' }
}

/** אין סודות בקוד */
export const noHardcodedSecrets: Check = (rootDir) => {
  const patterns = [
    /sk-[A-Za-z0-9]{20,}/,
    /AIza[0-9A-Za-z_-]{30,}/,
    /(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i
  ]
  for (const file of walkSourceFiles(rootDir)) {
    const content = read(file)
    for (const p of patterns) {
      if (p.test(content)) {
        return {
          name: 'אין סודות בקוד',
          status: 'fail',
          detail: relative(rootDir, file)
        }
      }
    }
  }
  return { name: 'אין סודות בקוד', status: 'pass' }
}

export function runChecks(rootDir: string, checks: Check[]): CheckResult[] {
  return checks.map((check) => {
    try {
      return check(rootDir)
    } catch (err) {
      // כשל של הבדיקה עצמה — לא כשל של המשימה
      return {
        name: 'בדיקה נכשלה',
        status: 'error' as const,
        detail: err instanceof Error ? err.message : String(err)
      }
    }
  })
}

export function summarize(results: CheckResult[]): {
  passed: number
  failed: number
  errored: number
  ok: boolean
} {
  const passed = results.filter((r) => r.status === 'pass').length
  const failed = results.filter((r) => r.status === 'fail').length
  const errored = results.filter((r) => r.status === 'error').length
  return { passed, failed, errored, ok: failed === 0 && errored === 0 }
}
