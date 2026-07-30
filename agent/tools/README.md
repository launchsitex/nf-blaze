# Agent tools (`/agent/tools`)

כלי הסוכן מוגדרים ב-**JSON Schema רגיל** (לא בפורמט Anthropic/OpenAI/Gemini).
Adapters ב-`/providers` אחראים לתרגם את `listToolDefinitions()` לפורמט הספק.

## כלים

| Name | תפקיד |
|------|--------|
| `read_file` | קריאת קובץ (אופציונלי offset/limit) |
| `list_dir` | רשימת תיקייה |
| `grep` | חיפוש regex/literal |
| `edit_file` | החלפת מחרוזת **ייחודית** — זורק אם 0 או >1 מופעים |
| `write_file` | כתיבת קובץ מלא |
| `run_command` | `npm install` / `npm run <script>` בלבד |

## שימוש

```ts
import { listToolDefinitions, executeTool, ToolError } from './agent/tools'

const toolsForProviders = listToolDefinitions()
// → pass to providers.call({ tools: toolsForProviders, ... })

await executeTool('write_file', { path: 'a.ts', content: 'x' }, { rootDir })
try {
  await executeTool('edit_file', { path: 'a.ts', old_string: 'x', new_string: 'y' }, { rootDir })
} catch (e) {
  if (e instanceof ToolError) console.error(e.code) // old_string_not_found | old_string_not_unique
}
```

## בדיקות

```bash
npx vitest run --config agent/tools/vitest.config.ts
npx tsc --noEmit -p agent/tools/tsconfig.json
```
