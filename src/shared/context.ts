/** Token / context window helpers for NF-Blaze */

export interface ContextBucket {
  id: string
  label: string
  tokens: number
  /** CSS color for the meter segment */
  color: string
}

export interface ContextUsage {
  modelId: string
  contextWindow: number
  usedTokens: number
  percent: number
  buckets: ContextBucket[]
  /** ISO time of last context compaction during an agent run */
  compactedAt?: string
  /** Short Hebrew note shown on the meter after compaction */
  compactNote?: string
  /** How many times compacted this session/run */
  compactCount?: number
}

/** Rough token estimate — works for Hebrew + code mixed content */
export function estimateTokens(text: string): number {
  if (!text) return 0
  // Hebrew denser than English; code closer to 4 chars/token
  const hebrew = (text.match(/[\u0590-\u05FF]/g) || []).length
  const total = text.length
  const hebrewRatio = total ? hebrew / total : 0
  const charsPerToken = 3.2 - hebrewRatio * 0.7 // ~2.5 for heavy Hebrew, ~3.2 for code/EN
  return Math.max(0, Math.ceil(total / charsPerToken))
}

export function buildContextUsage(input: {
  modelId: string
  contextWindow: number
  systemPrompt: string
  fileContext: string
  integrations: string
  conversation: string
  activeFile: string
}): ContextUsage {
  const buckets: ContextBucket[] = [
    {
      id: 'system',
      label: 'הנחיות מערכת',
      tokens: estimateTokens(input.systemPrompt),
      color: '#6b7280'
    },
    {
      id: 'files',
      label: 'קבצי פרויקט',
      tokens: estimateTokens(input.fileContext),
      color: '#a78bfa'
    },
    {
      id: 'integrations',
      label: 'חיבורים וכללים',
      tokens: estimateTokens(input.integrations),
      color: '#34d399'
    },
    {
      id: 'active',
      label: 'קובץ פתוח',
      tokens: estimateTokens(input.activeFile),
      color: '#f59e0b'
    },
    {
      id: 'conversation',
      label: 'שיחה',
      tokens: estimateTokens(input.conversation),
      color: '#c084fc'
    }
  ].filter((b) => b.tokens > 0)

  // Always show at least system + conversation slots in UI even if 0
  if (!buckets.some((b) => b.id === 'system')) {
    buckets.unshift({
      id: 'system',
      label: 'הנחיות מערכת',
      tokens: estimateTokens(input.systemPrompt) || 1,
      color: '#6b7280'
    })
  }

  const usedTokens = buckets.reduce((s, b) => s + b.tokens, 0)
  const window = Math.max(1, input.contextWindow)
  const percent = Math.min(100, Math.round((usedTokens / window) * 1000) / 10)

  return {
    modelId: input.modelId,
    contextWindow: window,
    usedTokens,
    percent,
    buckets
  }
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(n)
}
