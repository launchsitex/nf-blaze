# E2B Session Runtime (`/sandbox`)

שכבת הרצה מבודדת לכל session משתמש — מבוססת [E2B](https://e2b.dev).
אין UI ואין סוכן כאן; רק API ליצירה / כתיבת קבצים / npm / preview URL.

## API

```ts
import {
  createSession,
  getSession,
  destroySession,
  SessionRuntime
} from './sandbox'

const runtime = await createSession('user-123', {
  apiKey: process.env.E2B_API_KEY, // או משתנה סביבה
  previewPort: 5173
})

await runtime.writeFiles([
  { path: 'package.json', content: '...' },
  { path: 'index.html', content: '<h1>hi</h1>' }
])

await runtime.npmInstall()
await runtime.npmBuild()
const url = await runtime.startPreview() // https://…e2b.app
```

## פקודות מותרות

`npm install` · `npm i` · `npm ci` · `npm run build` · `npm run preview` · `npm run dev`

## בדיקות

### יחידה (בלי רשת / בלי מפתח)

```bash
npm run test:sandbox
```

### Smoke חי מול E2B

1. צור מפתח ב־[e2b.dev/dashboard](https://e2b.dev/dashboard)
2. הגדר משתנה סביבה:

```powershell
$env:E2B_API_KEY = "e2b_..."
npm run sandbox:smoke
```

3. בטרמינל תופיע `Preview URL` — פתח בדפדפן; אמור להופיע **NF-Blaze E2B smoke**.
4. הסקריפט הורס את ה-sandbox בסוף.
