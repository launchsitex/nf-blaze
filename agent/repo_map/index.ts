/**
 * מפת הפרויקט — בלוק קצר שנכנס להקשר מראש.
 *
 * גישה היברידית, כמו Claude Code: מפה דחוסה נזרקת להקשר מראש (זולה,
 * נותנת אוריינטציה), ו-grep/read_file מביאים קבצים בדיוק בזמן. לא RAG:
 * דטרמיניסטי, שקוף, ובלי אינדקס לתחזק.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildGraph, listCodeFiles, rankFiles, type RankedFile } from './graph'
import { getComponentIndex } from '../tools/component_index'

export {
  buildGraph,
  impactedFiles,
  listCodeFiles,
  pageRank,
  rankFiles,
  touchesRenderableOutput
} from './graph'
export type { RankedFile, RepoGraph } from './graph'

/** תקציב תווים למפה — נשמר קטן, זו אוריינטציה ולא תיעוד */
export const REPO_MAP_MAX_CHARS = 2_400

/** גם כשהכול נכנס בתקציב — רשימה של 90 קבצים היא רעש, לא מפה */
export const REPO_MAP_MAX_FILES = 40

/** מתחת לזה הפרויקט קטן מספיק שהסוכן פשוט יסתכל בעצמו */
const MIN_FILES_FOR_MAP = 6

function exportedSymbols(rootDir: string, rel: string, limit = 4): string[] {
  let content: string
  try {
    content = readFileSync(join(rootDir, rel), 'utf8')
  } catch {
    return []
  }
  const names = new Set<string>()
  const re =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g
  for (const m of content.matchAll(re)) {
    if (m[1]) names.add(m[1])
    if (names.size >= limit) break
  }
  return Array.from(names)
}

export interface RepoMapOptions {
  maxChars?: number
  /** קבצים שכבר בהקשר — לא חוזרים עליהם */
  exclude?: string[]
}

/**
 * מחזיר מפה קצרה, או מחרוזת ריקה כשאין מה למפות.
 * הסדר הוא לפי דירוג — הקבצים המרכזיים ראשונים.
 */
export function buildRepoMap(rootDir: string, opts: RepoMapOptions = {}): string {
  const maxChars = opts.maxChars ?? REPO_MAP_MAX_CHARS
  const files = listCodeFiles(rootDir)
  if (files.length < MIN_FILES_FOR_MAP) return ''

  const graph = buildGraph(rootDir, files)
  const exclude = new Set((opts.exclude ?? []).map((p) => p.split('\\').join('/')))
  const ranked = rankFiles(graph).filter((r) => !exclude.has(r.file))
  if (!ranked.length) return ''

  const componentProps = new Map<string, string[]>()
  try {
    for (const signatures of getComponentIndex(rootDir).byName.values()) {
      for (const c of signatures) {
        const key = c.file.split('\\').join('/')
        const list = componentProps.get(key) ?? []
        list.push(c.props.length ? `${c.name}(${c.props.slice(0, 4).join(', ')})` : c.name)
        componentProps.set(key, list)
      }
    }
  } catch {
    /* component index is best-effort */
  }

  const header = `מפת הפרויקט (${files.length} קבצי קוד, לפי מרכזיות):`
  const lines: string[] = []
  let used = header.length

  for (const r of ranked) {
    if (lines.length >= REPO_MAP_MAX_FILES) break
    const line = formatLine(rootDir, r, componentProps)
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }

  if (!lines.length) return ''
  const omitted = ranked.length - lines.length
  if (omitted > 0) lines.push(`… ועוד ${omitted} קבצים — השתמש ב-grep / list_dir`)

  return [header, ...lines].join('\n')
}

function formatLine(rootDir: string, r: RankedFile, componentProps: Map<string, string[]>): string {
  const symbols = componentProps.get(r.file) ?? exportedSymbols(rootDir, r.file)
  const usage = r.importedBy > 0 ? ` ←${r.importedBy}` : ''
  const detail = symbols.length ? `: ${symbols.slice(0, 3).join(', ')}` : ''
  return `- ${r.file}${usage}${detail}`
}
