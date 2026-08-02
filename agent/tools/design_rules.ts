/**
 * אכיפת מערכת עיצוב — דטרמיניסטית, לא בקשה מנומסת מהמודל.
 *
 * מודלים למדו את **הממוצע** של עיצוב טוב, ולכן ברירת המחדל שלהם היא
 * `bg-white` / `text-black` / `text-gray-500`. התוצאה נראית «AI» ולא
 * מכבדת את הפלטה של הפרויקט — וגם נשברת במצב כהה.
 *
 * כאן חוסמים את זה לפני הכתיבה, ומחזירים את שם הטוקן הנכון.
 *
 * שתי הגנות מפני false positives:
 * 1. נאכף **רק** בפרויקט שבאמת יש בו מערכת טוקנים.
 * 2. נאכף רק על קבצי קומפוננטה (tsx/jsx), לא על CSS או קונפיג.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ToolError } from './types'
import { shouldBlockOnDesign, type ToolSession } from './session'

/** הערה שמאפשרת חריגה מודעת בקובץ מסוים */
export const ALLOW_MARKER = 'nf-blaze: allow-raw-style'

/** מחלקת צבע גולמית → הטוקן שמחליף אותה */
const COLOR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bbg-white\b/, 'bg-background או bg-card'],
  [/\bbg-black\b/, 'bg-foreground'],
  [/\btext-white\b/, 'text-primary-foreground (על רקע צבעוני) או text-background'],
  [/\btext-black\b/, 'text-foreground'],
  [/\bborder-white\b/, 'border-border'],
  [/\bborder-black\b/, 'border-border'],
  [
    /\b(?:bg|text|border)-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b/,
    'טוקן muted / muted-foreground / border'
  ],
  [/\b(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/, 'טוקן מהפלטה (primary / secondary / accent)']
]

/** תכונת CSS פיזית → המקבילה הלוגית (חובה ב-RTL) */
const RTL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:ml|mr)-(?:\d+|px|auto|\[[^\]]+\])/, 'ms-* / me-*'],
  [/\b(?:pl|pr)-(?:\d+|px|\[[^\]]+\])/, 'ps-* / pe-*'],
  [/\btext-(?:left|right)\b/, 'text-start / text-end'],
  [/\b(?:left|right)-(?:\d+|px|auto|\[[^\]]+\])/, 'start-* / end-*'],
  [/\bborder-(?:l|r)(?:-|\b)/, 'border-s-* / border-e-*'],
  [/\brounded-(?:l|r|tl|tr|bl|br)(?:-|\b)/, 'rounded-s-* / rounded-e-* (או ss/se/es/ee)']
]

export interface DesignFinding {
  kind: 'color' | 'rtl'
  found: string
  useInstead: string
}

/** האם הפרויקט מגדיר מערכת טוקנים — אחרת אין מה לאכוף */
export function hasDesignSystem(rootDir: string): boolean {
  for (const rel of ['src/index.css', 'src/App.css', 'src/styles/global.css']) {
    const file = join(rootDir, rel)
    if (!existsSync(file)) continue
    try {
      const css = readFileSync(file, 'utf8')
      if (/--(?:primary|background|foreground)\s*:/.test(css)) return true
    } catch {
      /* unreadable — treat as no design system */
    }
  }
  return false
}

/** האם הקובץ בכלל נבדק */
export function isStyledComponentFile(relPath: string): boolean {
  return /\.(tsx|jsx)$/i.test(relPath.replace(/\\/g, '/'))
}

/**
 * מחזיר רק את התוכן שבתוך className/class — כדי לא לסמן טקסט עברי
 * או מחרוזות תוכן שבמקרה מכילות את אותן מילים.
 */
function classNameStrings(content: string): string[] {
  const out: string[] = []
  const re = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g
  for (const m of content.matchAll(re)) {
    const value = m[1] ?? m[2] ?? m[3]
    if (value) out.push(value)
  }
  return out
}

export function findDesignViolations(content: string): DesignFinding[] {
  if (content.includes(ALLOW_MARKER)) return []

  const findings: DesignFinding[] = []
  const seen = new Set<string>()

  for (const classes of classNameStrings(content)) {
    for (const [re, useInstead] of COLOR_REPLACEMENTS) {
      const hit = classes.match(re)
      if (hit && !seen.has(hit[0])) {
        seen.add(hit[0])
        findings.push({ kind: 'color', found: hit[0], useInstead })
      }
    }
    for (const [re, useInstead] of RTL_REPLACEMENTS) {
      const hit = classes.match(re)
      if (hit && !seen.has(hit[0])) {
        seen.add(hit[0])
        findings.push({ kind: 'rtl', found: hit[0], useInstead })
      }
    }
  }

  return findings
}

export function formatDesignError(relPath: string, findings: DesignFinding[]): string {
  const colors = findings.filter((f) => f.kind === 'color')
  const rtl = findings.filter((f) => f.kind === 'rtl')
  const lines = [`הקובץ ${relPath} עוקף את מערכת העיצוב של הפרויקט.`]

  if (colors.length) {
    lines.push('צבעים גולמיים (נשברים במצב כהה ולא מכבדים את הפלטה):')
    for (const f of colors) lines.push(`  ${f.found} → ${f.useInstead}`)
  }
  if (rtl.length) {
    lines.push('תכונות פיזיות במקום לוגיות (נשברות ב-RTL):')
    for (const f of rtl) lines.push(`  ${f.found} → ${f.useInstead}`)
  }

  lines.push(`אם החריגה מכוונת — הוסף הערה עם "${ALLOW_MARKER}" בקובץ.`)
  return lines.join('\n')
}

/**
 * נקרא מ-assertWritableContent — זורק רק בפרויקט עם מערכת טוקנים.
 *
 * `session` אופציונלי: כשהוא קיים, קובץ נחסם לכל היותר פעמיים ואז
 * הכתיבה עוברת. אכיפה חשובה, אבל לא במחיר של סוכן תקוע מול לקוח.
 */
export function assertDesignSystem(
  rootDir: string,
  relPath: string,
  content: string,
  session?: ToolSession
): void {
  if (!isStyledComponentFile(relPath)) return
  if (!hasDesignSystem(rootDir)) return
  const findings = findDesignViolations(content)
  if (!findings.length) return
  if (!shouldBlockOnDesign(session, relPath)) return
  throw new ToolError(formatDesignError(relPath, findings), 'design_system')
}
