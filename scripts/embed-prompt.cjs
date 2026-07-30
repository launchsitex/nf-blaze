/**
 * מטמיע את prompts/system.md כקבוע TypeScript לפני הבנייה.
 * כך הפרומפט לא נשלח כקובץ טקסט גלוי בהתקנה — הוא נכנס ל-bundle
 * (ועם bytecode, גם לא קריא). מקור האמת נשאר prompts/system.md.
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
