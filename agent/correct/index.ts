/**
 * Pre-disk correction layer for model output.
 *
 * Phase A — deterministic (package export names, local import paths) before write.
 * Phase B — AST / structural fixes after content is complete; also after a write round.
 * Metrics — first-try working preview rate (system KPI).
 */
import type { ToolCall } from '../../providers'
import { runPhaseA, type CorrectionFix } from './phase_a'
import {
  ensureDependenciesListed,
  fixCommonJsxTs,
  runPhaseB
} from './phase_b'
import {
  readPreviewMetrics,
  recordPreviewFirstTry,
  type PreviewMetricsSnapshot
} from './metrics'

export type { CorrectionFix, PreviewMetricsSnapshot }
export { readPreviewMetrics, recordPreviewFirstTry }

export type CorrectWriteResult = {
  arguments: Record<string, unknown>
  fixes: CorrectionFix[]
}

/**
 * Mutate write_file / edit_file args so broken imports never reach disk or the UI.
 */
export function correctToolArgsBeforeWrite(
  rootDir: string,
  toolCall: ToolCall
): CorrectWriteResult {
  const name = toolCall.name
  const args = { ...(toolCall.arguments ?? {}) } as Record<string, unknown>
  const fixes: CorrectionFix[] = []

  if (name === 'write_file') {
    const path = typeof args.path === 'string' ? args.path : ''
    const content = typeof args.content === 'string' ? args.content : null
    if (!path || content == null) return { arguments: args, fixes }

    const phaseA = runPhaseA(rootDir, path, content)
    const common = fixCommonJsxTs(phaseA.content)
    args.content = common.content
    fixes.push(...phaseA.fixes, ...common.fixes)
    // List missing deps in package.json before validate_write rejects the write
    fixes.push(...ensureDependenciesListed(rootDir, [common.content]))
    return { arguments: args, fixes }
  }

  if (name === 'edit_file') {
    const path = typeof args.path === 'string' ? args.path : ''
    const newString = typeof args.new_string === 'string' ? args.new_string : null
    if (!path || newString == null) return { arguments: args, fixes }

    const phaseA = runPhaseA(rootDir, path, newString)
    const common = fixCommonJsxTs(phaseA.content)
    args.new_string = common.content
    fixes.push(...phaseA.fixes, ...common.fixes)
    fixes.push(...ensureDependenciesListed(rootDir, [common.content]))
    return { arguments: args, fixes }
  }

  return { arguments: args, fixes }
}

/**
 * After a write round / stream complete — providers, missing deps, AST cleanup.
 */
export function correctAfterStream(
  rootDir: string,
  writtenPaths: string[]
): { fixes: CorrectionFix[]; filesTouched: string[] } {
  if (!writtenPaths.length) return { fixes: [], filesTouched: [] }
  const result = runPhaseB(rootDir, writtenPaths)
  return {
    fixes: result.fixes,
    filesTouched: Array.from(result.files.keys())
  }
}
