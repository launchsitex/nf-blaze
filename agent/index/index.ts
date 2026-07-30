/**
 * Project convention index — scan once on project open, reuse on every agent request.
 */
import { getCachedIndex, saveIndex, clearIndexCache } from './cache'
import { scanProjectConventions } from './scan'
import { composeSystemPrompt, formatConventionsBlock } from './prompt'
import type { ProjectIndex } from './types'
import { MATCH_EXISTING_CODE_INSTRUCTION } from './types'

export type { ProjectIndex, ProjectConventions, TypescriptConventions } from './types'
export { MATCH_EXISTING_CODE_INSTRUCTION } from './types'
export { composeSystemPrompt, formatConventionsBlock } from './prompt'
export { getCachedIndex, clearIndexCache, cachePath } from './cache'
export { scanProjectConventions } from './scan'

/**
 * Open / ensure project index.
 * Uses disk + memory cache — does **not** rescan when a cache already exists.
 * Call this once when a project is opened.
 */
export function ensureProjectIndex(rootDir: string): ProjectIndex {
  const cached = getCachedIndex(rootDir)
  if (cached) return cached
  const index = scanProjectConventions(rootDir)
  saveIndex(index)
  return index
}

/** Force a fresh scan (manual refresh) and overwrite cache */
export function refreshProjectIndex(rootDir: string): ProjectIndex {
  clearIndexCache(rootDir)
  const index = scanProjectConventions(rootDir)
  saveIndex(index)
  return index
}

/**
 * System prompt for a build/agent request:
 * loads cached conventions (or builds once) and injects them into prompts/system.md.
 */
export function systemPromptForProject(
  rootDir: string,
  baseOverride?: string
): string {
  const index = ensureProjectIndex(rootDir)
  return composeSystemPrompt(index, baseOverride)
}
