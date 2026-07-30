/**
 * Web access tools — web_search + web_fetch.
 * No API key required: search via DuckDuckGo HTML, fetch via global fetch (Node 18+).
 * Read-only — available in ASK / PLAN / BUILD modes.
 */
import type { ToolHandler } from './types'
import { ToolError } from './types'

const FETCH_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 2_000_000
// מתחת ל-WEB_TOOL_SPILL_CHARS (context_compact) — כדי שהעמוד יגיע למודל בשלמותו
const MAX_TEXT_CHARS = 15_000
const MAX_RESULTS = 8

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Decode the common HTML entities that survive tag stripping */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

/** Convert an HTML document to readable plain text (titles/paragraphs preserved as lines) */
export function htmlToText(html: string): string {
  let s = html
    // Drop non-content blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  // Keep link targets — useful for follow-up web_fetch calls
  s = s.replace(
    /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim()
      if (!label) return ' '
      return /^https?:\/\//i.test(href) ? `${label} (${href})` : label
    }
  )
  // Block-level tags → newlines, everything else → space
  s = s
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  s = decodeHtmlEntities(s)
  // Collapse whitespace but keep line structure
  return s
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, i, arr) => line || (i > 0 && arr[i - 1]))
    .join('\n')
    .trim()
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** Resolve DuckDuckGo redirect links (`/l/?uddg=<encoded>`) to the real URL */
export function resolveDdgUrl(href: string): string {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m) return decodeURIComponent(m[1]!)
    if (href.startsWith('//')) return `https:${href}`
    return href
  } catch {
    return href
  }
}

/** Parse the html.duckduckgo.com results page into structured results */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const linkRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi

  const links: Array<{ url: string; title: string; index: number }> = []
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) && links.length < MAX_RESULTS * 2) {
    const url = resolveDdgUrl(decodeHtmlEntities(m[1]!))
    const title = decodeHtmlEntities(m[2]!.replace(/<[^>]+>/g, '')).trim()
    if (!/^https?:\/\//i.test(url) || !title) continue
    // Skip DDG-internal links (ads etc.)
    if (/duckduckgo\.com/i.test(new URL(url).hostname)) continue
    links.push({ url, title, index: m.index })
  }

  const snippets: Array<{ text: string; index: number }> = []
  while ((m = snippetRe.exec(html)) && snippets.length < MAX_RESULTS * 3) {
    const raw = m[1] ?? m[2] ?? ''
    const text = decodeHtmlEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (text) snippets.push({ text, index: m.index })
  }

  for (const link of links.slice(0, MAX_RESULTS)) {
    // Nearest snippet that appears after this link in the document
    const snippet = snippets.find(
      (s) => s.index > link.index && s.index - link.index < 4000
    )
    results.push({ title: link.title, url: link.url, snippet: snippet?.text ?? '' })
  }
  return results
}

async function fetchWithLimits(
  url: string,
  init: RequestInit & { signal?: AbortSignal }
): Promise<{ status: number; contentType: string; body: string }> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  const res = await fetch(url, {
    ...init,
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'he,en;q=0.8',
      ...(init.headers ?? {})
    }
  })
  const contentType = res.headers.get('content-type') ?? ''
  const buf = await res.arrayBuffer()
  const limited = buf.byteLength > MAX_RESPONSE_BYTES ? buf.slice(0, MAX_RESPONSE_BYTES) : buf
  return {
    status: res.status,
    contentType,
    body: new TextDecoder('utf-8', { fatal: false }).decode(limited)
  }
}

export const webSearchTool: ToolHandler = async (args) => {
  try {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) throw new ToolError('query נדרש', 'invalid_args')

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetchWithLimits(url, { method: 'GET' })
    if (res.status >= 400) {
      throw new ToolError(`חיפוש נכשל (HTTP ${res.status})`, 'search_failed')
    }

    const results = parseDuckDuckGoHtml(res.body)
    if (!results.length) {
      return {
        ok: true,
        content: `אין תוצאות עבור "${query}". נסה ניסוח אחר (חיפוש באנגלית בדרך כלל מחזיר יותר תוצאות).`
      }
    }

    const lines = results.map(
      (r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`
    )
    return {
      ok: true,
      content: `תוצאות חיפוש עבור "${query}":\n\n${lines.join('\n\n')}\n\nהשתמש ב-web_fetch עם URL כדי לקרוא עמוד מלא.`,
      data: results
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `חיפוש ברשת נכשל: ${message}. בדוק חיבור אינטרנט.`,
      code: 'network_error'
    }
  }
}

export const webFetchTool: ToolHandler = async (args) => {
  try {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : ''
    if (!rawUrl) throw new ToolError('url נדרש', 'invalid_args')

    let parsed: URL
    try {
      parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
    } catch {
      throw new ToolError(`URL לא תקין: ${rawUrl}`, 'invalid_args')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ToolError('רק http/https נתמכים', 'invalid_args')
    }

    const res = await fetchWithLimits(parsed.toString(), { method: 'GET' })
    if (res.status >= 400) {
      throw new ToolError(`HTTP ${res.status} עבור ${parsed.hostname}`, 'fetch_failed')
    }

    const isHtml = /text\/html|application\/xhtml/i.test(res.contentType)
    let text = isHtml ? htmlToText(res.body) : res.body
    let truncated = false
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS)
      truncated = true
    }

    return {
      ok: true,
      content: [
        `# ${parsed.toString()}`,
        truncated ? `(קוצר ל-${MAX_TEXT_CHARS} תווים)` : '',
        '',
        text
      ]
        .filter(Boolean)
        .join('\n')
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `טעינת העמוד נכשלה: ${message}. בדוק את הכתובת וחיבור האינטרנט.`,
      code: 'network_error'
    }
  }
}
