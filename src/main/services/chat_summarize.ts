/**
 * «סכם לצ'אט חדש» — מסכם את השיחה הפעילה עם מודל מהיר ופותח צ'אט חדש
 * שנפתח בהודעת סוכן עם הסיכום, כך שההקשר עובר הלאה בלי לגרור היסטוריה כבדה.
 */
import { v4 as uuidv4 } from 'uuid'
import type { AiProvider, ChatMeta, ChatMessage } from '../../shared/types'
import { loadChat, createChat } from './storage'
import { getApiKey } from './secrets'
import { call } from '../../../providers'
import { pickFastIntentModel } from '../../../agent/intent'

const SUMMARY_SYSTEM = `סכם בעברית שיחת פיתוח בין משתמש לסוכן AI שבונה לו אפליקציה.
10-15 שורות, עובדתי ותמציתי: מה נבנה עד עכשיו, החלטות ארכיטקטורה/עיצוב מרכזיות,
מצב נוכחי, ומה נשאר פתוח. בלי מחמאות ובלי פתיחים.`

export async function summarizeToNewChat(opts: {
  projectId: string
  provider: AiProvider
  model: string
}): Promise<{ chat: ChatMeta; summarized: boolean }> {
  const session = loadChat(opts.projectId)
  const transcript = session.messages
    .slice(-30)
    .map(
      (m) =>
        `${m.role === 'user' ? 'משתמש' : m.role === 'assistant' ? 'סוכן' : 'מערכת'}: ${(m.content || '').slice(0, 1500)}`
    )
    .join('\n\n')

  let summary = ''
  if (transcript.trim()) {
    try {
      const apiKey = getApiKey(opts.provider) ?? undefined
      const res = await call({
        model: pickFastIntentModel(opts.model),
        apiKey,
        system: SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: transcript.slice(0, 24_000) }] }],
        tools: [],
        maxTokens: 900,
        temperature: 0
      })
      summary = (res.text || '').trim()
    } catch {
      summary = ''
    }
  }

  const seed: ChatMessage[] = summary
    ? [
        {
          id: uuidv4(),
          role: 'assistant',
          content: `סיכמתי את השיחה הקודמת כדי שנמשיך בהקשר נקי:\n\n${summary}\n\nאפשר להמשיך מכאן — מה עושים הלאה?`,
          createdAt: new Date().toISOString()
        }
      ]
    : []

  const chat = createChat(opts.projectId, 'המשך שיחה', seed)
  return { chat, summarized: Boolean(summary) }
}
