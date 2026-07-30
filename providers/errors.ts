import type { NormalizedProviderError, ProviderId } from './types'

export class ProviderError extends Error implements NormalizedProviderError {
  readonly code: NormalizedProviderError['code']
  readonly provider: ProviderId
  readonly status?: number
  readonly retryable: boolean
  readonly retryAfterMs?: number
  readonly cause?: unknown

  constructor(init: NormalizedProviderError) {
    super(init.message)
    this.name = 'ProviderError'
    this.code = init.code
    this.provider = init.provider
    this.status = init.status
    this.retryable = init.retryable
    this.retryAfterMs = init.retryAfterMs
    this.cause = init.cause
  }

  toJSON(): NormalizedProviderError {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      status: this.status,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs
    }
  }
}

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as Record<string, unknown>
  if (typeof e.status === 'number') return e.status
  if (typeof e.statusCode === 'number') return e.statusCode
  if (e.error && typeof e.error === 'object' && typeof (e.error as { code?: unknown }).code === 'number') {
    return (e.error as { code: number }).code
  }
  return undefined
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function headerRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const headers = (err as { headers?: Headers | Record<string, string> }).headers
  if (!headers) return undefined
  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('retry-after')
      : (headers as Record<string, string>)['retry-after'] ||
        (headers as Record<string, string>)['Retry-After']
  if (!raw) return undefined
  const asNum = Number(raw)
  if (!Number.isNaN(asNum)) return Math.max(0, asNum * 1000)
  const when = Date.parse(raw)
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now())
  return undefined
}

function looksRateLimited(err: unknown, status?: number): boolean {
  if (status === 429) return true
  const msg = messageOf(err).toLowerCase()
  return /rate limit|too many requests|resource.exhausted|quota/i.test(msg)
}

function looksAuth(err: unknown, status?: number): boolean {
  if (status === 401 || status === 403) return true
  const msg = messageOf(err).toLowerCase()
  return /invalid api key|unauthorized|authentication|permission denied|api key/i.test(msg)
}

function looksTimeout(err: unknown): boolean {
  const msg = messageOf(err).toLowerCase()
  return /timeout|timed out|deadline/i.test(msg)
}

function isAbort(err: unknown): boolean {
  if (!err) return false
  if (err instanceof Error) {
    return err.name === 'AbortError' || /abort/i.test(err.message)
  }
  return false
}

/** Normalize any provider SDK / HTTP error into a stable shape */
export function normalizeProviderError(err: unknown, provider: ProviderId): ProviderError {
  if (err instanceof ProviderError) return err

  if (isAbort(err)) {
    return new ProviderError({
      code: 'aborted',
      message: 'הבקשה בוטלה',
      provider,
      retryable: false,
      cause: err
    })
  }

  const status = statusOf(err)
  const retryAfterMs = headerRetryAfterMs(err)

  if (looksRateLimited(err, status)) {
    return new ProviderError({
      code: 'rate_limit',
      message: messageOf(err) || 'Rate limit',
      provider,
      status: status ?? 429,
      retryable: true,
      retryAfterMs: retryAfterMs ?? 2000,
      cause: err
    })
  }

  if (looksAuth(err, status)) {
    return new ProviderError({
      code: 'auth',
      message: messageOf(err) || 'Authentication failed',
      provider,
      status: status ?? 401,
      retryable: false,
      cause: err
    })
  }

  if (looksTimeout(err) || status === 408) {
    return new ProviderError({
      code: 'timeout',
      message: messageOf(err) || 'Timeout',
      provider,
      status,
      retryable: true,
      retryAfterMs: retryAfterMs ?? 1000,
      cause: err
    })
  }

  if (status && status >= 500) {
    return new ProviderError({
      code: 'server',
      message: messageOf(err) || 'Provider server error',
      provider,
      status,
      retryable: true,
      retryAfterMs: retryAfterMs ?? 1500,
      cause: err
    })
  }

  if (status && status >= 400) {
    return new ProviderError({
      code: 'invalid_request',
      message: messageOf(err) || 'Invalid request',
      provider,
      status,
      retryable: false,
      cause: err
    })
  }

  return new ProviderError({
    code: 'unknown',
    message: messageOf(err) || 'Unknown provider error',
    provider,
    status,
    retryable: false,
    cause: err
  })
}
