/**
 * Scan project source for secrets that would reach the client / publish bundle.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import type { SecurityFinding } from './types'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.nf-blaze',
  '.vercel',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  'release'
])

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|html)$/i
const ENV_FILE_RE = /^\.env(\..+)?$/i

/** Filenames that ship to the client / Vite public env */
const CLIENT_ENV_PREFIXES = [
  'VITE_',
  'NEXT_PUBLIC_',
  'PUBLIC_',
  'REACT_APP_',
  'NUXT_PUBLIC_'
]

const SERVICE_ROLE_PATTERNS: RegExp[] = [
  /service[_-]?role/i,
  /SUPABASE_SERVICE/i,
  /SERVICE_ROLE_KEY/i
]

const SECRET_NAME_PATTERNS: RegExp[] = [
  /service[_-]?role/i,
  /SECRET_KEY/i,
  /PRIVATE_KEY/i,
  /AWS_SECRET/i,
  /STRIPE_SECRET/i,
  /sk_live_[a-zA-Z0-9]+/,
  /sk_test_[a-zA-Z0-9]{20,}/,
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/ // JWT-like
]

function walk(root: string, dir: string, out: string[]): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(root, abs, out)
      continue
    }
    if (!st.isFile() || st.size > 2_000_000) continue
    out.push(abs)
  }
}

function toPosix(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}

function isClientExposedEnvKey(key: string): boolean {
  return CLIENT_ENV_PREFIXES.some((p) => key.startsWith(p))
}

function parseEnvFile(content: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2]!.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out.push({ key: m[1]!, value })
  }
  return out
}

export function listEnvFilesInTree(rootDir: string): string[] {
  const files: string[] = []
  walk(rootDir, rootDir, files)
  return files.filter((abs) => ENV_FILE_RE.test(abs.split(/[/\\]/).pop() || ''))
}

/**
 * .env / .env.* present in the project tree that the packer would include
 * (same walk rules as vercel_pack before env skip).
 */
export function scanEnvInBuild(rootDir: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const envFiles = listEnvFilesInTree(rootDir)
  for (const abs of envFiles) {
    const rel = toPosix(rootDir, abs)
    const base = rel.split('/').pop() || rel
    // .env.example is usually safe templates
    if (/\.example$/i.test(base) || /\.sample$/i.test(base)) continue

    let content: string
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const pairs = parseEnvFile(content)
    const hasSecrets = pairs.some(
      (p) =>
        SERVICE_ROLE_PATTERNS.some((re) => re.test(p.key)) ||
        /SECRET|PRIVATE|PASSWORD|TOKEN/i.test(p.key)
    )
    const hasClientService = pairs.some(
      (p) =>
        isClientExposedEnvKey(p.key) &&
        SERVICE_ROLE_PATTERNS.some((re) => re.test(p.key))
    )

    findings.push({
      id: `env-build:${rel}`,
      kind: 'env_in_build',
      severity: 'block',
      title: 'קובץ .env ייכלל בפרסום',
      found: `הקובץ ${rel} נמצא בתיקיית הפרויקט ויכול להישלח עם קוד המקור ל-Vercel.`,
      why: hasSecrets
        ? 'קבצי .env מכילים מפתחות סודיים. אם הם נכנסים לבנייה — כל מי שמוריד את החבילה או רואה לוגים עלול לגנוב אותם.'
        : 'גם בלי סודות ברורים, קבצי .env לא אמורים להיות חלק מחבילת הפרסום — קל לטעות ולהוסיף לשם מפתח סודי.',
      path: rel,
      fixHint: hasClientService
        ? `הסר מפתחות service_role מכל משתנה שמתחיל ב-VITE_/NEXT_PUBLIC_.\nהשאר service_role רק בשרת (לא בדפדפן).\nמחק או הוסף ל-.gitignore: ${rel}`
        : `ודא ש-${rel} ב-.gitignore ולא נארז לפרסום.\nמפתחות ציבוריים (anon) מוזרקים ל-Vercel דרך ההגדרות — לא דרך העלאת הקובץ.`
    })
  }
  return findings
}

export function scanClientSecrets(rootDir: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const files: string[] = []
  walk(rootDir, rootDir, files)

  for (const abs of files) {
    const rel = toPosix(rootDir, abs)
    const base = abs.split(/[/\\]/).pop() || ''

    // Env files handled separately; still catch VITE_ + service_role
    if (ENV_FILE_RE.test(base) && !/\.example$/i.test(base)) {
      try {
        const content = readFileSync(abs, 'utf8')
        for (const p of parseEnvFile(content)) {
          if (
            isClientExposedEnvKey(p.key) &&
            SERVICE_ROLE_PATTERNS.some((re) => re.test(p.key))
          ) {
            findings.push({
              id: `client-env:${rel}:${p.key}`,
              kind: 'service_role_in_client',
              severity: 'block',
              title: 'מפתח service_role בצד לקוח',
              found: `ב-${rel} מוגדר ${p.key} — משתנה שחשוף לדפדפן.`,
              why: 'מפתח service_role עוקף את כל הגנות ה-RLS. בדפדפן כל משתמש יכול לגנוב אותו ולשלוט במסד הנתונים.',
              path: rel,
              fixHint:
                'הסר את המשתנה מקבצי VITE_/NEXT_PUBLIC_. השתמש רק במפתח anon בצד הלקוח.'
            })
          }
        }
      } catch {
        /* ignore */
      }
      continue
    }

    if (!CODE_EXT.test(base)) continue
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }

    // service_role string literals / imports
    if (
      /service[_-]?role/i.test(text) &&
      /(eyJ[a-zA-Z0-9_-]{10,}|process\.env\.[A-Z0-9_]*SERVICE)/i.test(text)
    ) {
      findings.push({
        id: `service-role-code:${rel}`,
        kind: 'service_role_in_client',
        severity: 'block',
        title: 'מפתח service_role בקוד צד-לקוח',
        found: `בקובץ ${rel} מופיע שימוש ב-service_role / מפתח דומה יחד עם ערך או משתנה סביבה.`,
        why: 'כל קוד שנארז ל-bundle של הדפדפן גלוי למשתמשים. service_role שם = פריצה מלאה למסד.',
        path: rel,
        fixHint:
          'העבר פעולות שדורשות service_role לשרת / Edge Function. בצד הלקוח השאר רק anon + RLS.'
      })
    }

    // Hardcoded JWT / sk_live style secrets
    const jwtRe =
      /(['"`])(eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})\1/g
    let jm: RegExpExecArray | null
    while ((jm = jwtRe.exec(text))) {
      const token = jm[2]!
      // Heuristic: service_role JWTs are long; anon also JWT — check payload role if possible
      let roleHint = ''
      try {
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')
        ) as { role?: string }
        roleHint = payload.role || ''
      } catch {
        /* ignore */
      }
      if (roleHint === 'service_role' || /service/i.test(text.slice(Math.max(0, jm.index - 80), jm.index))) {
        findings.push({
          id: `hardcoded-jwt:${rel}:${jm.index}`,
          kind: 'hardcoded_secret',
          severity: 'block',
          title: 'סוד מקודד קשיח בקוד',
          found: `ב-${rel} יש JWT מוטמע בקוד (תפקיד: ${roleHint || 'לא ידוע'}).`,
          why: 'מפתח שכתוב ישירות בקוד נשמר ב-git וב-bundle. אי אפשר לבטל אותו בלי להחליף מפתח.',
          path: rel,
          fixHint: 'מחק את המפתח מהקוד. שמור ב-.env מקומי (שלא נארז) או בהגדרות Vercel.'
        })
      } else if (roleHint === 'anon') {
        // anon hardcoded is discouraged but less critical — still warn as hardcoded secret if long
        findings.push({
          id: `hardcoded-anon:${rel}:${jm.index}`,
          kind: 'hardcoded_secret',
          severity: 'warn',
          title: 'מפתח anon מקודד קשיח',
          found: `ב-${rel} מפתח anon כתוב ישירות בקוד במקום משתנה סביבה.`,
          why: 'קשה לסובב מפתחות ולנהל סביבות. עדיף VITE_SUPABASE_ANON_KEY.',
          path: rel,
          fixHint: 'העבר ל-import.meta.env.VITE_SUPABASE_ANON_KEY (או NEXT_PUBLIC_).'
        })
      } else {
        findings.push({
          id: `hardcoded-jwt-unk:${rel}:${jm.index}`,
          kind: 'hardcoded_secret',
          severity: 'block',
          title: 'טוקן/JWT מקודד קשיח',
          found: `ב-${rel} יש JWT ארוך מוטמע בקוד.`,
          why: 'טוקנים בקוד נחשפים לכולם אחרי פרסום.',
          path: rel,
          fixHint: 'הסר מהקוד והעבר למשתנה סביבה מאובטח.'
        })
      }
    }

    const skRe = /(['"`])(sk_(live|test)_[a-zA-Z0-9]{16,})\1/g
    let sm: RegExpExecArray | null
    while ((sm = skRe.exec(text))) {
      findings.push({
        id: `hardcoded-sk:${rel}:${sm.index}`,
        kind: 'hardcoded_secret',
        severity: 'block',
        title: 'מפתח סודי מקודד קשיח',
        found: `ב-${rel} נמצא מפתח בסגנון sk_live/sk_test.`,
        why: 'מפתחות תשלום/API סודיים בדפדפן מאפשרים גניבה וחיובים.',
        path: rel,
        fixHint: 'הסר מהקוד. השתמש רק בצד שרת.'
      })
    }

    // VITE_…SERVICE… in source
    if (
      /import\.meta\.env\.(VITE_|NEXT_PUBLIC_)[A-Z0-9_]*(SERVICE|SECRET|PRIVATE)/i.test(
        text
      ) ||
      /process\.env\.(VITE_|NEXT_PUBLIC_|REACT_APP_)[A-Z0-9_]*(SERVICE|SECRET|PRIVATE)/i.test(
        text
      )
    ) {
      findings.push({
        id: `secret-env-client:${rel}`,
        kind: 'secret_in_client_bundle',
        severity: 'block',
        title: 'משתנה סודי ב-bundle של הלקוח',
        found: `ב-${rel} יש קריאה למשתנה סביבה ציבורי (VITE_/NEXT_PUBLIC_) עם שם של סוד.`,
        why: 'משתנים ציבוריים מוטמעים ב-JavaScript של האתר. סוד שם = סוד גלוי.',
        path: rel,
        fixHint: 'השתמש בשם בלי VITE_/NEXT_PUBLIC_ ורק בשרת, או הסר לגמרי.'
      })
    }

    // Silence unused
    void SECRET_NAME_PATTERNS
  }

  return dedupeFindings(findings)
}

function dedupeFindings(list: SecurityFinding[]): SecurityFinding[] {
  const seen = new Set<string>()
  const out: SecurityFinding[] = []
  for (const f of list) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    out.push(f)
  }
  return out
}

/** Scan SQL migrations for USING (true) / permissive policies */
export function scanPermissiveRlsInSql(rootDir: string): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const files: string[] = []
  walk(rootDir, rootDir, files)
  for (const abs of files) {
    if (!/\.(sql)$/i.test(abs)) continue
    const rel = toPosix(rootDir, abs)
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    if (/using\s*\(\s*true\s*\)/i.test(text) || /with\s+check\s*\(\s*true\s*\)/i.test(text)) {
      findings.push({
        id: `rls-sql:${rel}`,
        kind: 'rls_allows_all',
        severity: 'warn',
        title: 'מדיניות RLS פתוחה בקובץ SQL',
        found: `ב-${rel} יש מדיניות עם USING (true) או WITH CHECK (true).`,
        why: 'מדיניות כזו מתירה לכולם (כולל אורחים) לקרוא או לכתוב לפי ההגדרה — זה כמעט כמו בלי אבטחה.',
        path: rel,
        fixHint:
          'החלף ל-USING (auth.uid() = user_id) או תנאי מתאים. אל תשאיר true בפרודקשן.'
      })
    }
  }
  return findings
}

export function pathExists(rootDir: string, rel: string): boolean {
  return existsSync(join(rootDir, rel))
}
