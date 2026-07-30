/**
 * Build a short screen / route map for the QA sub-agent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

export type ScreenMap = {
  entryPoints: string[]
  routes: string[]
  pages: string[]
  forms: string[]
  summary: string
}

function walk(dir: string, max = 80): string[] {
  const out: string[] = []
  const visit = (d: string): void => {
    if (out.length >= max) return
    let names: string[]
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const name of names) {
      if (out.length >= max) break
      if (
        name === 'node_modules' ||
        name === 'dist' ||
        name === '.git' ||
        name === '.nf-blaze'
      ) {
        continue
      }
      const full = join(d, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) visit(full)
      else if (/\.(tsx|jsx|html)$/i.test(name)) out.push(full)
    }
  }
  visit(dir)
  return out
}

function toPosix(root: string, abs: string): string {
  return relative(root, abs).split('\\').join('/')
}

export function buildScreenMap(rootDir: string, writtenPaths: string[]): ScreenMap {
  const routes = new Set<string>(['/'])
  const pages: string[] = []
  const forms: string[] = []
  const entryPoints: string[] = []

  for (const rel of [
    'src/App.tsx',
    'src/App.jsx',
    'src/main.tsx',
    'src/main.jsx',
    'index.html'
  ]) {
    if (existsSync(join(rootDir, rel))) entryPoints.push(rel)
  }

  const files = walk(join(rootDir, 'src'))
  for (const abs of files) {
    const rel = toPosix(rootDir, abs)
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }

    if (/pages?\//i.test(rel) || /routes?\//i.test(rel)) {
      pages.push(rel)
    }

    for (const m of text.matchAll(
      /(?:path|to|href)\s*[:=]\s*['"`](\/[^'"`]*)['"`]/g
    )) {
      routes.add(m[1]!)
    }
    for (const m of text.matchAll(/Route\s[^>]*path=['"`]([^'"`]+)['"`]/g)) {
      routes.add(m[1]!.startsWith('/') ? m[1]! : `/${m[1]}`)
    }

    if (/<form[\s>]/i.test(text) || /\btype=['"]submit['"]/i.test(text)) {
      forms.push(rel)
    }
  }

  for (const w of writtenPaths) {
    const n = w.replace(/\\/g, '/')
    if (/\.(tsx|jsx|html)$/i.test(n) && !pages.includes(n)) pages.push(n)
  }

  const routeList = Array.from(routes).sort()
  const summary = [
    `נקודות כניסה: ${entryPoints.join(', ') || '—'}`,
    `מסלולים: ${routeList.slice(0, 12).join(', ')}`,
    `מסכים/קבצים: ${pages.slice(0, 10).join(', ') || '—'}`,
    forms.length ? `טפסים ב: ${forms.slice(0, 6).join(', ')}` : 'טפסים: לא זוהו'
  ].join('\n')

  return {
    entryPoints,
    routes: routeList,
    pages: pages.slice(0, 20),
    forms: forms.slice(0, 10),
    summary
  }
}
