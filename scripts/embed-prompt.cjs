/**
 * מטמיע את prompts/system.md כקבוע TypeScript לפני הבנייה, כדי שהפרומפט לא
 * יישלח כקובץ טקסט נפרד בהתקנה. מקור האמת נשאר prompts/system.md.
 *
 * ⚠️ **זו אינה הגנה.** קודם נכתב כאן ש«עם bytecode גם לא קריא» — לא נכון:
 * ‏V8 שומר string literals בטקסט מלא בתוך ה-.jsc, וה-base64 שורד בשלמותו.
 * אומת ב-02.08.2026 — הפרומפט חולץ מהבינארי המשוחרר בשלוש שורות קוד.
 * אם התוכן צריך להישאר סודי, המקום היחיד שבו זה אפשרי הוא בצד השרת.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'prompts', 'system.md')
const OUT = path.join(ROOT, 'src', 'main', 'services', 'ai', 'system_prompt.generated.ts')

const md = fs.readFileSync(SRC, 'utf-8').trim()
const encoded = Buffer.from(md, 'utf-8').toString('base64')

const file = `/* eslint-disable */
// קובץ נוצר אוטומטית מ-prompts/system.md על ידי scripts/embed-prompt.cjs
// אל תערוך כאן — ערוך את prompts/system.md והרץ בנייה מחדש.
const ENCODED =
  '${encoded}'

export const EMBEDDED_SYSTEM_PROMPT = Buffer.from(ENCODED, 'base64').toString('utf-8')
`

fs.writeFileSync(OUT, file, 'utf-8')
console.log(`  • embedded system prompt (${md.length} chars) → ${path.relative(ROOT, OUT)}`)
