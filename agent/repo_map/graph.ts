/**
 * גרף התלויות של הפרויקט + דירוג PageRank.
 *
 * התובנה (מ-Aider): לא כל קובץ שווה באותה מידה. קובץ שמיובא מ-20 מקומות
 * הוא הקשר יקר בהרבה מ-helper שנקרא פעם אחת. דירוג לפי גרף ההפניות
 * נותן מפה קצרה שמכילה את מה שבאמת מרכזי.
 *
 * מימוש ללא תלות חיצונית: משתמש ב-parseImports הקיים במקום tree-sitter,
 * כדי לא להוסיף תלות נייטיב לאפליקציית Electron.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { parseImports, resolveLocalImport } from '../tools/validate_write'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.nf-blaze',
  'dist',
  'build',
  'out',
  'release',
  'coverage',
  '.next'
])

const CODE_RE = /\.(tsx|ts|jsx|js|mjs|cjs)$/i

/** קבצים שתמיד מרכזיים, בלי קשר לדרגה */
const ENTRY_RE = /(^|\/)(main|index|App|router|routes)\.(tsx|ts|jsx|js)$/i

export interface RepoGraph {
  /** נתיבים יחסיים (posix) של כל קובצי הקוד */
  files: string[]
  /** file → קבצים שהוא מייבא */
  edges: Map<string, string[]>
}

function toPosix(p: string): string {
  return p.split('\\').join('/')
}

export function listCodeFiles(rootDir: string, max = 600): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    if (out.length >= max) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (out.length >= max) return
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) visit(full)
      else if (CODE_RE.test(name) && !/\.(test|spec)\./i.test(name)) {
        out.push(toPosix(relative(rootDir, full)))
      }
    }
  }
  visit(rootDir)
  return out.sort()
}

export function buildGraph(rootDir: string, files?: string[]): RepoGraph {
  const list = files ?? listCodeFiles(rootDir)
  const known = new Set(list)
  const edges = new Map<string, string[]>()

  for (const rel of list) {
    const abs = join(rootDir, rel)
    let content: string
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      edges.set(rel, [])
      continue
    }
    const targets: string[] = []
    for (const im of parseImports(content)) {
      if (!im.isLocal && !im.source.startsWith('@/')) continue
      const resolved = resolveLocalImport(rootDir, abs, im.source)
      if (!resolved) continue
      const target = toPosix(relative(rootDir, resolved))
      if (known.has(target) && target !== rel) targets.push(target)
    }
    edges.set(rel, Array.from(new Set(targets)))
  }

  return { files: list, edges }
}

/**
 * PageRank על גרף ההפניות. קובץ מיובא = קובץ חשוב; קובץ שמיובא
 * מקובץ חשוב — חשוב עוד יותר.
 *
 * דטרמיניסטי לחלוטין: אותו פרויקט → אותו דירוג, בכל ריצה.
 */
export function pageRank(
  graph: RepoGraph,
  { damping = 0.85, iterations = 20 } = {}
): Map<string, number> {
  const n = graph.files.length
  const scores = new Map<string, number>()
  if (!n) return scores

  const initial = 1 / n
  for (const f of graph.files) scores.set(f, initial)

  // גרף הפוך: מי מצביע על מי
  const inbound = new Map<string, string[]>()
  for (const f of graph.files) inbound.set(f, [])
  for (const [from, targets] of graph.edges) {
    for (const to of targets) inbound.get(to)?.push(from)
  }

  const outDegree = new Map<string, number>()
  for (const [from, targets] of graph.edges) outDegree.set(from, targets.length)

  for (let i = 0; i < iterations; i++) {
    const next = new Map<string, number>()
    // מסה של קבצים בלי יוצאות — מתחלקת שווה בשווה
    let dangling = 0
    for (const f of graph.files) {
      if ((outDegree.get(f) ?? 0) === 0) dangling += scores.get(f) ?? 0
    }

    for (const f of graph.files) {
      let sum = 0
      for (const src of inbound.get(f) ?? []) {
        const deg = outDegree.get(src) ?? 0
        if (deg > 0) sum += (scores.get(src) ?? 0) / deg
      }
      next.set(f, (1 - damping) / n + damping * (sum + dangling / n))
    }

    for (const [f, v] of next) scores.set(f, v)
  }

  return scores
}

export interface RankedFile {
  file: string
  /** דירוג PageRank גולמי — כמה הקובץ מרכזי בגרף ההפניות */
  score: number
  /** כמה קבצים מייבאים אותו — מוצג כי זה מובן מיידית */
  importedBy: number
  /** נקודת כניסה (App/main/router) — המפה של הפרויקט */
  isEntry: boolean
}

/**
 * סדר התצוגה: נקודות כניסה קודם (הן ההקשר שממנו מתחילים לקרוא),
 * ואחריהן לפי מרכזיות בגרף. ה-score נשאר PageRank נקי — בלי הטיה,
 * כדי שהמספר יישאר בעל משמעות.
 */
export function rankFiles(graph: RepoGraph): RankedFile[] {
  const scores = pageRank(graph)
  const importedBy = new Map<string, number>()
  for (const f of graph.files) importedBy.set(f, 0)
  for (const targets of graph.edges.values()) {
    for (const t of targets) importedBy.set(t, (importedBy.get(t) ?? 0) + 1)
  }

  return graph.files
    .map((file) => ({
      file,
      score: scores.get(file) ?? 0,
      importedBy: importedBy.get(file) ?? 0,
      isEntry: ENTRY_RE.test(file)
    }))
    .sort(
      (a, b) =>
        Number(b.isEntry) - Number(a.isEntry) || b.score - a.score || a.file.localeCompare(b.file)
    )
}

export function graphExists(rootDir: string): boolean {
  return existsSync(join(rootDir, 'src')) || existsSync(join(rootDir, 'package.json'))
}

/**
 * ניתוח השפעה — אילו קבצים יכולים להישבר מהשינוי הזה.
 *
 * הרעיון (TDAD): במקום להריץ הכול או לנחש, סוגרים טרנזיטיבית **אחורה**
 * על גרף ההפניות: מי מייבא את מה ששיניתי, מי מייבא אותו, וכן הלאה.
 * הקבצים האלה — ורק הם — יכולים להיות מושפעים.
 *
 * @param changed נתיבים יחסיים (posix) שנכתבו בסבב
 * @returns קבוצה הכוללת את הקבצים ששונו **ואת** כל התלויים בהם
 */
export function impactedFiles(graph: RepoGraph, changed: string[]): Set<string> {
  const importers = new Map<string, string[]>()
  for (const f of graph.files) importers.set(f, [])
  for (const [from, targets] of graph.edges) {
    for (const to of targets) importers.get(to)?.push(from)
  }

  const impacted = new Set<string>()
  const queue: string[] = []

  for (const raw of changed) {
    const rel = toPosix(raw)
    if (!impacted.has(rel)) {
      impacted.add(rel)
      queue.push(rel)
    }
  }

  while (queue.length) {
    const current = queue.shift()!
    for (const importer of importers.get(current) ?? []) {
      if (impacted.has(importer)) continue
      impacted.add(importer)
      queue.push(importer)
    }
  }

  return impacted
}

/** קבצים שיכולים לשנות את מה שנראה בדפדפן */
const RENDERABLE_RE = /\.(tsx|jsx|css|s[ac]ss|html)$/i

/** האם השינוי בכלל יכול להשפיע על התצוגה */
export function touchesRenderableOutput(paths: Iterable<string>): boolean {
  for (const p of paths) {
    if (RENDERABLE_RE.test(p)) return true
  }
  return false
}
