# Provider adapters (`/providers`)

שכבת תרגום אחידה ל-OpenAI / Anthropic / Gemini.
הסוכן קורא רק ל-`call` / `stream` — בלי לדעת איזה ספק רץ.

## ממשק

```ts
import { call, stream, textMessage } from './providers'

const result = await call({
  model: 'claude-sonnet-5',          // הספק נגזר מהמודל
  system: 'You are a coding agent',
  messages: [textMessage('user', 'Build a landing page')],
  tools: [{
    name: 'write_file',
    description: 'Write a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  }],
  apiKey: process.env.ANTHROPIC_API_KEY
})

// result: { text, toolCalls[], stopReason, usage }
```

| ספק | tools | system | היסטוריה |
|-----|-------|--------|----------|
| Anthropic | `input_schema` | פרמטר `system` בראש הבקשה | `user`/`assistant` + `tool_result` בתוך user |
| OpenAI | `parameters` | הודעת `system` ראשונה | `tool` role + `tool_calls` |
| Gemini | `functionDeclarations` | `systemInstruction` | `user`/`model` + `functionResponse` |

שגיאות / rate limits → `ProviderError` עם `code`, `retryable`, `retryAfterMs`.

## בדיקות

### יחידה (המרות + שגיאות, בלי רשת)

```bash
npx vitest run --config providers/vitest.config.ts
npx tsc --noEmit -p providers/tsconfig.json
```

### אותה בקשה מול שלושת הספקים (חי)

```powershell
$env:OPENAI_API_KEY = "sk-..."
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:GEMINI_API_KEY = "AIza..."
npx --yes tsx providers/smoke.ts
```

הסקריפט שולח **את אותו** `CallParams` (system + messages + tools ריק) לכל ספק,
רק `model` + מפתח משתנים. בודק גם `stream` וגם `call`.
