/**
 * Decide whether browser QA should run for this request.
 * Skip trivial / ASK / PLAN / tiny edits — only when enough UI surface changed.
 */
import type { WorkMode } from '../intent'

const SIGNIFICANT_PATH =
  /(^|\/)(App|main|index|layout|page|pages|routes|router|Home|Dashboard)\.[jt]sx?$/i

export function shouldRunBrowserQa(opts: {
  workMode: WorkMode
  writtenPaths: string[]
  /** Already finished both QA attempts */
  attemptsUsed: number
}): boolean {
  if (opts.attemptsUsed >= 2) return false
  if (opts.workMode !== 'BUILD') return false
  const paths = opts.writtenPaths
    .map((p) => p.replace(/\\/g, '/'))
    .filter(Boolean)
  if (paths.length === 0) return false

  // Enough change: 2+ files, or a significant entry/route/page file
  if (paths.length >= 2) return true
  if (paths.some((p) => SIGNIFICANT_PATH.test(p))) return true
  if (paths.some((p) => /\.(html?|css)$/i.test(p))) return true
  return false
}
