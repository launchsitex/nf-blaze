/**
 * Browser QA sub-agent — separate model context, interaction-only tools.
 */
import {
  call,
  type ToolCall,
  type UnifiedMessage,
  type Usage
} from '../../providers'
import { buildScreenMap, type ScreenMap } from './screen_map'
import { ensureQaPreview } from './preview'
import { openBrowserSession } from './playwright_session'
import {
  BROWSER_QA_TOOLS,
  describeBrowserAction,
  executeBrowserTool
} from './tools'

export const MAX_BROWSER_QA_ITERATIONS = 12

export type BrowserQaEvent = {
  phase: 'start' | 'action' | 'passed' | 'failed' | 'skipped' | 'error'
  attempt: number
  message: string
  url?: string
  action?: string
  summary?: string
  works?: string[]
  broken?: string[]
}

export type BrowserQaResult = {
  ok: boolean
  skipped?: boolean
  attempt: number
  url?: string
  summary: string
  works: string[]
  broken: string[]
  usage: Usage
}

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens
  }
}

function systemPrompt(screenMap: ScreenMap, baseUrl: string): string {
  return `אתה תת-סוכן QA בדפדפן אמיתי. אין לך כלי כתיבה לקבצים — רק אינטראקציה.

מטרה: לבדוק שהאפליקציה ב-${baseUrl} עונה על בקשת המשתמש.

מפת מסכים:
${screenMap.summary}

בדוק שני מישורים:
1. **תפקוד** — כל זרימה שהמשתמש ביקש עובדת, בלי שגיאות קונסול.
2. **איכות מוצר** — הסתכל על ה-screenshot ודווח כ«שבור» גם ליקויי איכות בולטים:
   טקסט placeholder («לורם», «תכונה 1», טקסט באנגלית באתר עברי), אלמנטים חופפים או
   נחתכים, טקסט לא קריא על הרקע, תמונות שבורות, עמוד שנראה חצי-גמור או גנרי לחלוטין
   ביחס לבקשה. אל תדווח על העדפות סגנון קטנות — רק מה שמוריד את רמת התוצר.

כלים: navigate, click, type_text, screenshot, console_errors, report_done.
בסוף חובה לקרוא ל-report_done עם סיכום קצר בעברית: מה עובד ומה שבור.
אל תחזיר היסטוריית צעדים ארוכה — רק סיכום.`
}

function formatSummaryForMain(result: BrowserQaResult): string {
  const lines = [
    '## תוצאות בדיקת דפדפן (תת-סוכן QA)',
    result.summary.trim(),
    result.works.length ? `עובד: ${result.works.join('; ')}` : '',
    result.broken.length ? `שבור: ${result.broken.join('; ')}` : ''
  ].filter(Boolean)
  if (result.broken.length) {
    lines.push(
      'תקן רק את מה שנשבר לפי הרשימה. אחרי התיקון תרוץ בדיקת דפדפן שנייה אחת בלבד.'
    )
  }
  return lines.join('\n')
}

export { formatSummaryForMain }

export async function runBrowserQaSubagent(opts: {
  rootDir: string
  userMessage: string
  model: string
  apiKey?: string
  attempt: number
  writtenPaths: string[]
  getPreviewUrl?: () => Promise<string | null>
  signal?: AbortSignal
  onEvent?: (ev: BrowserQaEvent) => void
}): Promise<BrowserQaResult> {
  const emit = (ev: BrowserQaEvent): void => {
    opts.onEvent?.(ev)
  }

  if (opts.signal?.aborted) {
    return {
      ok: false,
      attempt: opts.attempt,
      summary: 'בוטל',
      works: [],
      broken: ['בוטל'],
      usage: emptyUsage()
    }
  }

  const screenMap = buildScreenMap(opts.rootDir, opts.writtenPaths)
  emit({
    phase: 'start',
    attempt: opts.attempt,
    message: `מעלה תצוגה ובודק בדפדפן (ניסיון ${opts.attempt}/2)…`
  })

  let previewStop: (() => void) | undefined
  let sessionClose: (() => Promise<void>) | undefined
  let usage = emptyUsage()

  try {
    const preview = await ensureQaPreview(opts.rootDir, opts.getPreviewUrl)
    previewStop = preview.stop
    emit({
      phase: 'start',
      attempt: opts.attempt,
      message: `דפדפן נפתח · ${preview.url}`,
      url: preview.url
    })

    const session = await openBrowserSession({
      baseUrl: preview.url,
      rootDir: opts.rootDir,
      headed: true
    })
    sessionClose = session.close

    const messages: UnifiedMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `בקשת המשתמש לבדיקה:\n${opts.userMessage.trim()}\n\nהתחל מ-${preview.url}. נווט, לחץ, מלא טפסים רלוונטיים, צלם, בדוק קונסול, ואז report_done.`
          }
        ]
      }
    ]

    let final: BrowserQaResult | null = null

    for (let i = 0; i < MAX_BROWSER_QA_ITERATIONS; i++) {
      if (opts.signal?.aborted) {
        final = {
          ok: false,
          attempt: opts.attempt,
          url: preview.url,
          summary: 'בדיקת דפדפן בוטלה',
          works: [],
          broken: ['בוטל'],
          usage
        }
        break
      }

      const result = await call({
        model: opts.model,
        apiKey: opts.apiKey,
        system: systemPrompt(screenMap, preview.url),
        messages,
        tools: BROWSER_QA_TOOLS,
        maxTokens: 2048,
        signal: opts.signal
      })
      usage = addUsage(usage, result.usage)

      messages.push({
        role: 'assistant',
        content: [
          ...(result.text
            ? [{ type: 'text' as const, text: result.text }]
            : []),
          ...result.toolCalls.map((tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
          }))
        ]
      })

      if (!result.toolCalls.length) {
        // Force wrap-up
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'אין כלי. קרא ל-report_done עכשיו עם סיכום קצר: מה עובד ומה שבור.'
            }
          ]
        })
        continue
      }

      const toolResults: Array<{
        toolCall: ToolCall
        content: string
        isError: boolean
      }> = []

      for (const tc of result.toolCalls) {
        const action = describeBrowserAction(tc.name, tc.arguments || {})
        emit({
          phase: 'action',
          attempt: opts.attempt,
          message: action,
          url: preview.url,
          action
        })

        const outcome = await executeBrowserTool(
          session,
          tc.name,
          tc.arguments || {}
        )
        toolResults.push({
          toolCall: tc,
          content: outcome.content,
          isError: outcome.isError
        })

        if (outcome.done) {
          const ok = outcome.done.broken.length === 0
          final = {
            ok,
            attempt: opts.attempt,
            url: preview.url,
            summary: outcome.done.summary,
            works: outcome.done.works,
            broken: outcome.done.broken,
            usage
          }
          // Still record other tool results then break
        }
      }

      messages.push({
        role: 'tool',
        content: toolResults.map((r) => ({
          type: 'tool_result' as const,
          toolCallId: r.toolCall.id,
          name: r.toolCall.name,
          content: r.content,
          isError: r.isError
        }))
      })

      if (final) break
    }

    if (!final) {
      // Collect console errors as fallback summary
      const errs = session.consoleErrors.slice(0, 5)
      final = {
        ok: errs.length === 0,
        attempt: opts.attempt,
        url: preview.url,
        summary: errs.length
          ? `הבדיקה לא הושלמה עם report_done. שגיאות קונסול: ${errs.join(' | ')}`
          : 'הבדיקה לא הושלמה עם report_done — לא זוהו שגיאות קונסול ברורות.',
        works: [],
        broken: errs.length ? errs : ['בדיקה לא הושלמה'],
        usage
      }
    }

    emit({
      phase: final.ok ? 'passed' : 'failed',
      attempt: opts.attempt,
      message: final.summary,
      url: final.url,
      summary: final.summary,
      works: final.works,
      broken: final.broken
    })

    return final
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({
      phase: 'error',
      attempt: opts.attempt,
      message: `בדיקת דפדפן נכשלה: ${message}`
    })
    return {
      ok: false,
      attempt: opts.attempt,
      summary: message,
      works: [],
      broken: [message],
      usage
    }
  } finally {
    if (sessionClose) {
      try {
        await sessionClose()
      } catch {
        /* ignore */
      }
    }
    previewStop?.()
  }
}
