#!/usr/bin/env node
/**
 * מכין את חבילת הפרסום להעלאה לאחסון.
 *
 * מריצים אחרי `npm run dist`. הסקריפט מייצר את `version.json` (המניפסט
 * שקובע אם עדכון הוא חובה) ומרכז לתיקייה אחת בדיוק את מה שצריך לעלות
 * ל-`public_html/download/` — כדי שלא יקרה שמעלים exe בלי latest.yml
 * ואז אף לקוח לא מקבל את העדכון.
 *
 *   node scripts/make-release.cjs              עדכון חובה (ברירת מחדל)
 *   node scripts/make-release.cjs --optional   עדכון מומלץ, לא חוסם
 */
const { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const version = pkg.version
const optional = process.argv.includes('--optional')

const releaseDir = join(root, 'release')
const outDir = join(releaseDir, 'upload')

const exeName = `NF-Blaze-Setup-${version}.exe`
const required = [
  { from: join(releaseDir, exeName), to: exeName },
  { from: join(releaseDir, `${exeName}.blockmap`), to: `${exeName}.blockmap` },
  { from: join(releaseDir, 'latest.yml'), to: 'latest.yml' }
]

const missing = required.filter((f) => !existsSync(f.from))
if (missing.length) {
  console.error('\n✗ חסרים קבצים. הרץ קודם `npm run dist`.\n')
  for (const m of missing) console.error('   ' + m.from)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
for (const f of required) copyFileSync(f.from, join(outDir, f.to))

/**
 * המניפסט. `mandatory: true` הוא ברירת המחדל — כל גרסה חדשה מחייבת
 * עדכון. אם גרסה יצאה תקולה, אפשר לערוך את הקובץ הזה על השרת ולשנות
 * ל-false; הלקוחות ישתחררו מהחסימה בבדיקה הבאה, בלי גרסה מתקנת.
 */
const manifest = {
  version,
  mandatory: !optional,
  releasedAt: new Date().toISOString().slice(0, 10),
  downloadUrl: `https://nf-blaze.dev/download/${exeName}`
}
writeFileSync(join(outDir, 'version.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

/** מונע מהאחסון להגיש version.json מהמטמון — עדכון חייב להגיע מיד */
writeFileSync(
  join(outDir, '.htaccess'),
  [
    '# NF-Blaze — הגשת קובצי העדכון',
    'AddType application/octet-stream .exe .blockmap',
    'AddType text/yaml .yml',
    '',
    '<FilesMatch "\\.(json|yml)$">',
    '  Header set Cache-Control "no-cache, no-store, must-revalidate"',
    '  Header set Pragma "no-cache"',
    '</FilesMatch>',
    ''
  ].join('\n'),
  'utf-8'
)

/**
 * מעדכן את קישור הגיבוי בדף הנחיתה. הכפתור באתר ממילא קורא את
 * `version.json` ומתעדכן לבד, אבל הגיבוי ב-config.js חייב להישאר תואם —
 * אחרת מבקר שהמניפסט לא נטען אצלו יקבל קישור לגרסה ישנה.
 */
const configPath = join(root, 'landing', 'config.js')
let landingUpdated = false
if (existsSync(configPath)) {
  const before = readFileSync(configPath, 'utf-8')
  const after = before.replace(
    /(downloadUrl:\s*')[^']*(')/,
    `$1https://nf-blaze.dev/download/${exeName}$2`
  )
  if (after !== before) {
    writeFileSync(configPath, after, 'utf-8')
    landingUpdated = true
  }
}

const sizeMb = (p) => (require('fs').statSync(p).size / 1024 / 1024).toFixed(1)

console.log(`\n✓ חבילת הפרסום מוכנה — גרסה ${version}${optional ? ' (לא חוסם)' : ' (עדכון חובה)'}`)
console.log(`\n  ${outDir}\n`)
for (const f of [...required.map((r) => r.to), 'version.json', '.htaccess']) {
  console.log(`   ${f}  ·  ${sizeMb(join(outDir, f))} MB`)
}
if (landingUpdated) {
  console.log(`\n✓ קישור ההורדה בדף הנחיתה עודכן ל-${exeName}`)
}

console.log('\n' + '─'.repeat(64))
console.log('  מה צריך להעלות לשרת — שני מקומות, אל תדלג על השני')
console.log('─'.repeat(64))
console.log(`
  1. public_html/download/     ← כל התוכן של release/upload/

     ⚠️  סדר: קודם ה-exe וה-blockmap, ורק כשהם עלו במלואם —
         latest.yml ו-version.json. הם אלה שמכריזים על הגרסה,
         ולקוח שיקבל הכרזה על קובץ שעוד באוויר יישאר חסום.

  2. public_html/config.js     ← עודכן זה עתה עם הקישור החדש
${landingUpdated ? '' : '     (לא השתנה הפעם — הקישור כבר היה מעודכן)'}
  אימות אחרי ההעלאה:
     irm https://nf-blaze.dev/download/version.json
`)
console.log('─'.repeat(64))
console.log('  תזכורת: לפני פרסום — לעדכן src/shared/release_notes.ts')
console.log('  בלשון תועלת. אין לחשוף פגמים או מבנה פנימי ללקוח.')
console.log('─'.repeat(64) + '\n')
