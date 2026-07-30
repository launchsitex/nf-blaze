/**
 * Closest-name matching for bad icon / component export names.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = new Array<number>(b.length + 1)
  const cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!
  }
  return prev[b.length]!
}

function normalizeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

/**
 * Pick the closest export name. Returns null if nothing is close enough.
 */
export function closestName(
  target: string,
  candidates: Iterable<string>,
  opts?: { maxDistance?: number }
): string | null {
  const max =
    opts?.maxDistance ??
    Math.max(2, Math.min(6, Math.floor(target.length * 0.45) + 1))
  const targetKey = normalizeKey(target)
  let best: string | null = null
  let bestDist = Infinity

  for (const c of candidates) {
    if (c === target) return c
    const d = Math.min(
      levenshtein(target, c),
      levenshtein(targetKey, normalizeKey(c))
    )
    // Prefer same-prefix matches when distances tie
    const prefixBonus =
      c.toLowerCase().startsWith(target.slice(0, 3).toLowerCase()) ||
      target.toLowerCase().startsWith(c.slice(0, 3).toLowerCase())
        ? -0.25
        : 0
    const score = d + prefixBonus
    if (score < bestDist) {
      bestDist = score
      best = c
    }
  }

  if (best == null || bestDist > max) return null
  return best
}
