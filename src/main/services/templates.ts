import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { spawn } from 'child_process'
import { getNpmCommand, getRuntimeSpawnEnv } from './runtime-env'

export type TemplateId = 'web-app' | 'data-app'

export interface TemplateInfo {
  id: TemplateId
  nameHe: string
  descriptionHe: string
  hasSupabase: boolean
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'web-app',
    nameHe: 'אתר / אפליקציה',
    descriptionHe: 'Vite + React + TypeScript + Tailwind + shadcn · עברית ו-RTL מובנים',
    hasSupabase: false
  },
  {
    id: 'data-app',
    nameHe: 'אפליקציה עם נתונים',
    descriptionHe: 'אותו בסיס + לקוח Supabase מוכן',
    hasSupabase: true
  }
]

const SKIP_COPY = new Set([
  'node_modules',
  'dist',
  '.git',
  '.nf-blaze',
  'dist-ssr'
])

/** Config files the agent must not touch unless the user explicitly asks */
export const TEMPLATE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  'components.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.js'
]

export function resolveTemplatesRoot(): string {
  const candidates: string[] = []
  try {
    if (process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'templates'))
    }
  } catch {
    /* ignore */
  }
  try {
    candidates.push(join(app.getAppPath(), 'templates'))
  } catch {
    /* ignore */
  }
  candidates.push(join(process.cwd(), 'templates'))
  // When running from out/main
  candidates.push(join(__dirname, '..', '..', '..', 'templates'))
  candidates.push(join(__dirname, '..', '..', 'templates'))

  for (const p of candidates) {
    if (existsSync(join(p, 'web-app', 'package.json'))) return p
  }
  throw new Error('תיקיית templates לא נמצאה. ודא ש-templates/ קיימת בשורש הפרויקט.')
}

/**
 * סנכרון ה-plugin של NF-Blaze בפרויקט קיים לגרסה הארוזה העדכנית.
 * פרויקטים מקבלים עותק חד-פעמי ביצירה — בלי זה תיקונים בבוחר האלמנטים
 * ובדיווח השגיאות לא היו מגיעים אליהם. לא זורק לעולם.
 */
export function syncNfSourcePlugin(projectFolder: string): boolean {
  try {
    const targetDir = join(projectFolder, 'plugins', 'nf-blaze-source', 'src')
    if (!existsSync(targetDir)) return false // הפרויקט לא משתמש ב-plugin (מיובא וכו')
    const sourceDir = join(
      resolveTemplatesRoot(),
      'web-app',
      'plugins',
      'nf-blaze-source',
      'src'
    )
    if (!existsSync(sourceDir)) return false
    let changed = false
    for (const file of readdirSync(sourceDir)) {
      const from = join(sourceDir, file)
      if (!statSync(from).isFile()) continue
      const to = join(targetDir, file)
      const next = readFileSync(from, 'utf-8')
      const current = existsSync(to) ? readFileSync(to, 'utf-8') : null
      if (current !== next) {
        writeFileSync(to, next, 'utf-8')
        changed = true
      }
    }
    return changed
  } catch {
    return false
  }
}

/**
 * מזריק את nfSourcePlugin לתוך vite.config של הפרויקט (לוגיקה טהורה, לבדיקות).
 * מחזיר קונפיג מעודכן, או null אם הוא כבר קיים / אי אפשר לתקן בבטחה.
 */
export function injectNfSourceIntoConfig(src: string): string | null {
  // כבר מוזרק
  if (/nf-blaze-source|nfSourcePlugin/.test(src)) return null
  // חייב מערך plugins כדי להזריק בבטחה
  if (!/plugins\s*:\s*\[/.test(src)) return null

  const importLine =
    "import { nfSourcePlugin } from './plugins/nf-blaze-source/src/index.js' // NF-Blaze: בורר אלמנטים בתצוגה"
  let out = src.replace(/plugins\s*:\s*\[/, 'plugins: [nfSourcePlugin(), ')

  // מוסיפים את ה-import אחרי ה-import האחרון (או בתחילת הקובץ)
  const imports = [...out.matchAll(/^\s*import\s.*$/gm)]
  const last = imports[imports.length - 1]
  if (last && typeof last.index === 'number') {
    const at = last.index + last[0].length
    out = out.slice(0, at) + '\n' + importLine + out.slice(at)
  } else {
    out = importLine + '\n' + out
  }
  return out
}

/**
 * מוודא שבפרויקט Vite (גם מיובא / של Dyad) בורר האלמנטים יעבוד: מעתיק את קבצי
 * ה-plugin ומזריק אותו ל-vite.config. בלי זה, בפרויקטים שלא נוצרו ב-NF-Blaze
 * סקריפט הבורר לא מוזרק והבחירה בתצוגה «לא עושה כלום».
 */
export function ensureNfSourceInViteConfig(projectFolder: string): boolean {
  try {
    const configName = [
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mts',
      'vite.config.mjs',
      'vite.config.cjs'
    ].find((n) => existsSync(join(projectFolder, n)))
    if (!configName) return false // אין vite.config — לא נוגעים (לא בטוח ליצור)

    const configPath = join(projectFolder, configName)
    const src = readFileSync(configPath, 'utf-8')

    // מעתיקים את קבצי ה-plugin (גם אם ה-config כבר מתוקן — כדי לעדכן לגרסה חדשה)
    const sourceDir = join(resolveTemplatesRoot(), 'web-app', 'plugins', 'nf-blaze-source', 'src')
    const targetDir = join(projectFolder, 'plugins', 'nf-blaze-source', 'src')
    if (existsSync(sourceDir)) {
      mkdirSync(targetDir, { recursive: true })
      for (const file of readdirSync(sourceDir)) {
        const from = join(sourceDir, file)
        if (!statSync(from).isFile()) continue
        const to = join(targetDir, file)
        const next = readFileSync(from, 'utf-8')
        if (!existsSync(to) || readFileSync(to, 'utf-8') !== next) {
          writeFileSync(to, next, 'utf-8')
        }
      }
    }

    const patched = injectNfSourceIntoConfig(src)
    if (patched === null) return false // כבר קיים או לא ניתן להזרקה
    writeFileSync(configPath, patched, 'utf-8')
    return true
  } catch {
    return false
  }
}

export function listTemplates(): TemplateInfo[] {
  const root = resolveTemplatesRoot()
  return TEMPLATES.filter((t) => existsSync(join(root, t.id, 'package.json')))
}

export function getTemplateInfo(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

function assertEmptyOrAlmostEmpty(folderPath: string): void {
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true })
    return
  }
  const entries = readdirSync(folderPath).filter((n) => n !== '.DS_Store' && n !== 'Thumbs.db')
  const allowedAlone = new Set(['.git', '.gitignore'])
  const blocking = entries.filter((n) => !allowedAlone.has(n))
  if (blocking.length > 0) {
    throw new Error(
      'התיקייה שנבחרה אינה ריקה. בחרו תיקייה ריקה (או עם .git בלבד) להעתקת התבנית.'
    )
  }
}

function copyDirFiltered(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    if (SKIP_COPY.has(name)) continue
    const from = join(src, name)
    const to = join(dest, name)
    const st = statSync(from)
    if (st.isDirectory()) {
      copyDirFiltered(from, to)
    } else {
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
    }
  }
}

export function copyTemplateToFolder(templateId: TemplateId, folderPath: string): void {
  const info = getTemplateInfo(templateId)
  if (!info) throw new Error(`תבנית לא מוכרת: ${templateId}`)
  const src = join(resolveTemplatesRoot(), templateId)
  if (!existsSync(join(src, 'package.json'))) {
    throw new Error(`קבצי התבנית ${templateId} חסרים`)
  }
  assertEmptyOrAlmostEmpty(folderPath)
  copyDirFiltered(src, folderPath)

  // Ensure PROJECT_RULES.md is present (source of truth for the agent)
  const rulesSrc = join(src, 'PROJECT_RULES.md')
  const rulesDest = join(folderPath, 'PROJECT_RULES.md')
  if (existsSync(rulesSrc) && !existsSync(rulesDest)) {
    cpSync(rulesSrc, rulesDest)
  }
}

export function loadProjectRules(folderPath: string): string {
  const path = join(folderPath, 'PROJECT_RULES.md')
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf-8').trim()
  } catch {
    return ''
  }
}

/** Block for system prompt injection */
export function formatProjectRulesBlock(folderPath: string): string {
  const rules = loadProjectRules(folderPath)
  if (!rules) return ''
  return [
    '## PROJECT_RULES.md (חוקי הפרויקט — חובה בכל בקשה)',
    'עקוב אחרי החוקים הבאים בכל שינוי. אל תשנה קבצי קונפיג של התבנית אלא אם המשתמש ביקש זאת במפורש.',
    '',
    rules
  ].join('\n')
}

export function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isTemplateConfigPath(relativePath: string): boolean {
  const n = normalizeRelPath(relativePath)
  const base = n.split('/').pop() || n
  if (n.startsWith('plugins/nf-blaze-source/') || n === 'plugins/nf-blaze-source') return true
  if (TEMPLATE_CONFIG_FILES.includes(base) || TEMPLATE_CONFIG_FILES.includes(n)) return true
  if (/^tsconfig(\.|$)/i.test(base)) return true
  if (/^(vite|tailwind|postcss|eslint)\.config\./i.test(base)) return true
  if (base === 'components.json') return true
  return false
}

/**
 * User must explicitly ask to change a config file (mention the file or "קונפיג"+"שנה" with the name).
 */
export function userRequestedConfigChange(userMessage: string, relativePath: string): boolean {
  const msg = userMessage.toLowerCase()
  const rel = normalizeRelPath(relativePath).toLowerCase()
  const base = (rel.split('/').pop() || rel).toLowerCase()
  if (msg.includes(base)) return true
  if (msg.includes(rel)) return true
  // e.g. "שנה את vite config" / "עדכן את tsconfig"
  const stem = base.replace(/\.(ts|js|cjs|mjs|json)$/i, '')
  if (stem.length >= 4 && msg.includes(stem)) {
    return /שנה|עדכן|תשנה|תעדכן|change|update|edit|modify|config|קונפיג/.test(msg)
  }
  return false
}

export async function installTemplateDeps(
  folderPath: string,
  onLine?: (line: string) => void
): Promise<{ ok: boolean; code: number; summary: string }> {
  if (!existsSync(join(folderPath, 'package.json'))) {
    throw new Error('אין package.json להתקנה')
  }

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const npmCmd = getNpmCommand()
    const useShell = isWin && /\.cmd$/i.test(npmCmd)
    const child = spawn(npmCmd, ['install'], {
      cwd: folderPath,
      env: getRuntimeSpawnEnv({
        npm_config_fund: 'false',
        npm_config_audit: 'false'
      }),
      shell: useShell,
      windowsHide: true
    })

    let last = ''
    const handle = (buf: Buffer): void => {
      const text = buf.toString('utf-8')
      last = text
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLine?.(line)
      }
    }
    child.stdout?.on('data', handle)
    child.stderr?.on('data', handle)
    child.on('error', (err) => {
      resolve({ ok: false, code: 1, summary: err.message })
    })
    child.on('close', (code) => {
      const c = code ?? 1
      resolve({
        ok: c === 0,
        code: c,
        summary: c === 0 ? 'התלויות הותקנו' : `npm install נכשל (קוד ${c}). ${last.slice(0, 200)}`
      })
    })
  })
}

/** Marker written so we know this folder came from a template */
export function writeTemplateMeta(folderPath: string, templateId: TemplateId): void {
  const dir = join(folderPath, '.nf-blaze')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'template.json'),
    JSON.stringify({ templateId, createdAt: new Date().toISOString() }, null, 2),
    'utf-8'
  )
}
