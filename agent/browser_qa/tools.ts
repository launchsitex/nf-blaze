/**
 * Browser QA tools — read-only interaction. No file writes.
 */
import { join } from 'path'
import type { ToolDefinition } from '../../providers'
import type { BrowserSession } from './playwright_session'

export const BROWSER_QA_TOOLS: ToolDefinition[] = [
  {
    name: 'navigate',
    description: 'Navigate to a path or full URL within the app under test',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path like /about or full http URL'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'click',
    description: 'Click an element by CSS selector or accessible role/name text',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector, or text=... / role=button[name=...]'
        }
      },
      required: ['selector']
    }
  },
  {
    name: 'type_text',
    description: 'Fill/type into an input located by selector',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        clear: { type: 'boolean', description: 'Clear before typing (default true)' }
      },
      required: ['selector', 'text']
    }
  },
  {
    name: 'screenshot',
    description: 'Capture a screenshot of the current page; returns file path',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short label for the filename' }
      }
    }
  },
  {
    name: 'console_errors',
    description: 'Return console/page errors collected so far',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'report_done',
    description:
      'Finish QA. Provide a SHORT summary only: what works and what is broken. No full history.',
    parameters: {
      type: 'object',
      properties: {
        works: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short list of things that work'
        },
        broken: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short list of broken behaviors'
        },
        summary: {
          type: 'string',
          description: '2–5 sentence Hebrew summary for the main agent'
        }
      },
      required: ['summary']
    }
  }
]

export type BrowserToolResult = {
  content: string
  isError: boolean
  done?: {
    works: string[]
    broken: string[]
    summary: string
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

function resolveUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const p = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${p}`
}

async function locate(page: BrowserSession['page'], selector: string) {
  if (selector.startsWith('text=')) {
    return page.getByText(selector.slice(5), { exact: false }).first()
  }
  const roleMatch = selector.match(/^role=(\w+)(?:\[name=(.+)\])?$/i)
  if (roleMatch) {
    const role = roleMatch[1] as 'button' | 'link' | 'textbox' | 'heading'
    const name = roleMatch[2]?.replace(/^["']|["']$/g, '')
    return page.getByRole(role, name ? { name } : undefined).first()
  }
  return page.locator(selector).first()
}

export async function executeBrowserTool(
  session: BrowserSession,
  name: string,
  args: Record<string, unknown>
): Promise<BrowserToolResult> {
  const { page, baseUrl, screenshotsDir, consoleErrors } = session

  try {
    switch (name) {
      case 'navigate': {
        const path = String(args.path || '/')
        const url = resolveUrl(baseUrl, path)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await sleep(400)
        return { content: `נווט אל ${url} · title=${await page.title()}`, isError: false }
      }
      case 'click': {
        const selector = String(args.selector || '')
        if (!selector) return { content: 'חסר selector', isError: true }
        const loc = await locate(page, selector)
        await loc.click({ timeout: 10_000 })
        await sleep(300)
        return { content: `לחיצה: ${selector}`, isError: false }
      }
      case 'type_text': {
        const selector = String(args.selector || '')
        const text = String(args.text ?? '')
        const clear = args.clear !== false
        if (!selector) return { content: 'חסר selector', isError: true }
        const loc = await locate(page, selector)
        if (clear) await loc.fill(text, { timeout: 10_000 })
        else await loc.pressSequentially(text, { timeout: 10_000 })
        return { content: `הוקלד ב-${selector}: ${text.slice(0, 80)}`, isError: false }
      }
      case 'screenshot': {
        const label = String(args.label || 'shot')
          .replace(/[^\w-]+/g, '_')
          .slice(0, 40)
        const file = join(screenshotsDir, `${Date.now()}_${label}.png`)
        await page.screenshot({ path: file, fullPage: true })
        return { content: `צילום נשמר: ${file}`, isError: false }
      }
      case 'console_errors': {
        const list = consoleErrors.slice(-30)
        return {
          content: list.length
            ? `שגיאות קונסול (${list.length}):\n${list.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
            : 'אין שגיאות קונסול',
          isError: false
        }
      }
      case 'report_done': {
        const works = Array.isArray(args.works)
          ? args.works.map(String).slice(0, 12)
          : []
        const broken = Array.isArray(args.broken)
          ? args.broken.map(String).slice(0, 12)
          : []
        const summary = String(args.summary || '').trim()
        if (!summary) return { content: 'חסר summary', isError: true }
        return {
          content: 'סיכום נרשם',
          isError: false,
          done: { works, broken, summary }
        }
      }
      default:
        return {
          content: `כלי לא נתמך בתת-סוכן QA: ${name} (אין כלי כתיבה)`,
          isError: true
        }
    }
  } catch (err) {
    return {
      content: err instanceof Error ? err.message : String(err),
      isError: true
    }
  }
}

export function describeBrowserAction(
  name: string,
  args: Record<string, unknown>
): string {
  switch (name) {
    case 'navigate':
      return `ניווט → ${args.path || '/'}`
    case 'click':
      return `לחיצה → ${args.selector || '?'}`
    case 'type_text':
      return `הקלדה → ${args.selector || '?'}`
    case 'screenshot':
      return `צילום מסך${args.label ? `: ${args.label}` : ''}`
    case 'console_errors':
      return 'קריאת שגיאות קונסול'
    case 'report_done':
      return 'סיכום בדיקה'
    default:
      return name
  }
}
