/**
 * First-try working preview metric — primary system KPI.
 * Persisted under `<userProject>/.nf-blaze/preview_metrics.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type PreviewMetricRecord = {
  at: string
  success: boolean
  /** Completed without entering tsc repair */
  firstTry: boolean
  stopReason: string
  writtenFiles: number
}

export type PreviewMetricsSnapshot = {
  totalBuildRequests: number
  firstTryPreviewOk: number
  /** 0–100, rounded to 1 decimal */
  firstTryPreviewRatePct: number
  updatedAt: string
  recent: PreviewMetricRecord[]
}

const MAX_RECENT = 50

function metricsPath(rootDir: string): string {
  return join(rootDir, '.nf-blaze', 'preview_metrics.json')
}

function emptySnapshot(): PreviewMetricsSnapshot {
  return {
    totalBuildRequests: 0,
    firstTryPreviewOk: 0,
    firstTryPreviewRatePct: 0,
    updatedAt: new Date().toISOString(),
    recent: []
  }
}

export function readPreviewMetrics(rootDir: string): PreviewMetricsSnapshot {
  const p = metricsPath(rootDir)
  if (!existsSync(p)) return emptySnapshot()
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<PreviewMetricsSnapshot>
    const total = Number(raw.totalBuildRequests) || 0
    const ok = Number(raw.firstTryPreviewOk) || 0
    return {
      totalBuildRequests: total,
      firstTryPreviewOk: ok,
      firstTryPreviewRatePct:
        total > 0 ? Math.round((ok / total) * 1000) / 10 : 0,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      recent: Array.isArray(raw.recent) ? raw.recent.slice(0, MAX_RECENT) : []
    }
  } catch {
    return emptySnapshot()
  }
}

/**
 * Record whether this BUILD request produced a working preview on the first try.
 * `success` = preview-ready (completion + tsc clean).
 * `firstTry` = success without tsc repair rounds.
 */
export function recordPreviewFirstTry(
  rootDir: string,
  input: {
    success: boolean
    firstTry: boolean
    stopReason: string
    writtenFiles: number
  }
): PreviewMetricsSnapshot {
  // Only count requests that actually wrote code (BUILD surface)
  if (input.writtenFiles <= 0) {
    return readPreviewMetrics(rootDir)
  }

  const snap = readPreviewMetrics(rootDir)
  snap.totalBuildRequests += 1
  const countedSuccess = input.success && input.firstTry
  if (countedSuccess) snap.firstTryPreviewOk += 1
  snap.firstTryPreviewRatePct =
    snap.totalBuildRequests > 0
      ? Math.round((snap.firstTryPreviewOk / snap.totalBuildRequests) * 1000) / 10
      : 0
  snap.updatedAt = new Date().toISOString()
  snap.recent.unshift({
    at: snap.updatedAt,
    success: input.success,
    firstTry: input.firstTry,
    stopReason: input.stopReason,
    writtenFiles: input.writtenFiles
  })
  snap.recent = snap.recent.slice(0, MAX_RECENT)

  const dir = join(rootDir, '.nf-blaze')
  mkdirSync(dir, { recursive: true })
  writeFileSync(metricsPath(rootDir), `${JSON.stringify(snap, null, 2)}\n`, 'utf8')
  return snap
}
