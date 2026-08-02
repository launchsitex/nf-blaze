/**
 * הרצת סוויטת ה-Evals.
 *
 *   npx tsx evals/runner.ts --model claude-... --key sk-...
 *   npx tsx evals/runner.ts --task landing-lawyer          # משימה אחת
 *   npx tsx evals/runner.ts --list                          # רק להציג
 *
 * כל משימה רצה בעותק נקי של התבנית, בתיקייה זמנית. לא נוגע בפרויקטים
 * של המשתמש. הדוח נשמר כ-JSON כדי שאפשר יהיה להשוות בין ריצות.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { runAgentLoop } from '../agent/loop'
import { EVAL_TASKS, getTask, isReadOnlyTask, type EvalTask } from './tasks'
import { runChecks, summarize, type CheckResult } from './checks'

interface TaskReport {
  id: string
  status: 'pass' | 'fail' | 'error'
  durationMs: number
  iterations: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  stopReason: string
  checks: CheckResult[]
  error?: string
}

/**
 * דגל משורת הפקודה, עם נפילה למשתנה סביבה.
 *
 * PowerShell בולע `--` ריק, ולכן `npm run eval -- --model x` לא מעביר
 * ארגומנטים שם. משתני סביבה עוקפים את זה לגמרי — ובנוסף המפתח לא
 * נכנס להיסטוריית הפקודות.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return process.env[`NF_EVAL_${name.toUpperCase()}`]?.trim() || undefined
}

/**
 * בדיקת שפיות למפתח לפני שמבזבזים ריצה.
 *
 * מפתח נשלח ככותרת HTTP, שמקבלת ASCII בלבד — מפתח שהודבק עם טקסט
 * מציין-מקום מפיל את הבקשה בשגיאת ByteString עמומה. עדיף לתפוס כאן.
 */
export function validateApiKey(key: string | undefined): string | null {
  if (!key) return null // ייתכן שהמפתח מגיע ממשתנה סביבה של הספק

  const nonAscii = [...key].find((ch) => ch.charCodeAt(0) > 127)
  if (nonAscii) {
    return [
      `המפתח מכיל תו שאינו אנגלי ("${nonAscii}") — זה עדיין טקסט לדוגמה ולא מפתח אמיתי.`,
      '',
      'מפתח אמיתי נראה כך: sk-ant-api03- ואחריו כ-95 תווים באנגלית ומספרים בלבד.',
      'מעתיקים אותו מ-https://console.anthropic.com/settings/keys'
    ].join('\n')
  }

  if (key.includes('...') || key.includes('<') || key.includes('>')) {
    return 'המפתח מכיל "..." או סוגריים — זה מציין מקום. הדבק את המפתח המלא.'
  }

  if (key.length < 40) {
    return `המפתח קצר מדי (${key.length} תווים) — מפתח אמיתי הוא כ-100 תווים.`
  }

  return null
}

function fileTree(dir: string): string[] {
  const out: string[] = []
  const visit = (d: string, prefix: string): void => {
    let names: string[]
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const name of names.sort()) {
      if (name === 'node_modules' || name === '.git' || name === '.nf-blaze') continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) visit(full, `${prefix}${name}/`)
      else out.push(`${prefix}${name}`)
    }
  }
  visit(dir, '')
  return out
}

async function runTask(
  task: EvalTask,
  opts: { model: string; apiKey?: string; repoRoot: string }
): Promise<TaskReport> {
  // לא ב-%TEMP%: ‏Storage Sense / כלי ניקוי מוחקים משם תיקיות תוך כדי ריצה —
  // נצפה בפועל: תיקיית עבודה נמחקה באמצע משימה והריצה נכשלה על «תיקייה לא קיימת»
  const workDir = join(
    opts.repoRoot,
    'evals',
    '.work',
    `nf-eval-${task.id}-${process.pid}-${EVAL_TASKS.indexOf(task)}`
  )
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  cpSync(join(opts.repoRoot, 'templates', task.template), workDir, {
    recursive: true,
    filter: (src) => !src.includes('node_modules')
  })

  const before = fileTree(workDir)
  const started = Date.now()

  try {
    const result = await runAgentLoop({
      model: opts.model,
      apiKey: opts.apiKey,
      userMessage: task.prompt,
      rootDir: workDir,
      workMode: task.workMode
    })

    const checks = runChecks(workDir, task.checks)

    // משימות קריאה-בלבד: הבדיקה היא שהעץ לא השתנה
    if (isReadOnlyTask(task)) {
      const after = fileTree(workDir)
      const changed = after.length !== before.length || after.some((f, i) => f !== before[i])
      checks.push({
        name: 'לא נכתבו קבצים',
        status: changed ? 'fail' : 'pass',
        detail: changed ? 'עץ הקבצים השתנה במצב קריאה בלבד' : undefined
      })
    }

    // היגיינת מדידה: הלולאה **לא זורקת** על כשל ספק — היא מחזירה
    // stopReason='error'. בלי הבדיקה הזו כשל מפתח/רשת נספר ככשל איכות,
    // והבדיקות שעברו על תבנית שלא נגעו בה נראות כמו הצלחה חלקית.
    const runFailed = result.stopReason === 'error' || result.stopReason === 'aborted'
    const sum = summarize(checks)
    return {
      id: task.id,
      status: runFailed || sum.errored ? 'error' : sum.ok ? 'pass' : 'fail',
      ...(runFailed ? { error: result.error || `הלולאה נעצרה: ${result.stopReason}` } : {}),
      durationMs: Date.now() - started,
      iterations: result.iterations,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens ?? 0,
      stopReason: result.stopReason,
      checks
    }
  } catch (err) {
    // כשל הרצה — **לא** נספר ככשל של המשימה
    return {
      id: task.id,
      status: 'error',
      durationMs: Date.now() - started,
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      stopReason: 'error',
      checks: [],
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    // Windows: תהליך שזה עתה נסגר או אנטי-וירוס עשויים עוד להחזיק את התיקייה
    // (EBUSY). ניקוי עם ניסיונות חוזרים, וכשל ניקוי לא מפיל את שאר הסוויטה —
    // זו תיקיית temp; משאירים אזהרה במקום לאבד ריצה שלמה.
    try {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
    } catch (err) {
      console.warn(
        `  אזהרה: ניקוי ${workDir} נכשל — ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

async function main(): Promise<void> {
  const repoRoot = resolve(__dirname, '..')

  // דגל מפורש תמיד מציג רשימה. משתנה סביבה — רק כשלא נבחר מודל,
  // כדי ש-NF_EVAL_LIST שנשאר תקוע בסשן לא יחסום ריצה אמיתית.
  const listOnly =
    process.argv.includes('--list') || (Boolean(process.env.NF_EVAL_LIST) && !arg('model'))

  if (listOnly) {
    for (const t of EVAL_TASKS) {
      console.log(`${t.id.padEnd(26)} [${t.workMode}] ${t.prompt}`)
    }
    return
  }

  const model = arg('model')
  if (!model) {
    console.error(
      [
        'חסר מודל.',
        '',
        'PowerShell (הכי פשוט — המפתח לא נכנס להיסטוריה):',
        '  $env:NF_EVAL_MODEL="claude-sonnet-5"; $env:NF_EVAL_KEY="<המפתח>"; npm run eval',
        '',
        'CMD / bash:',
        '  npm run eval -- --model claude-sonnet-5 --key <המפתח>',
        '',
        'רשימת המשימות:  $env:NF_EVAL_LIST=1; npm run eval'
      ].join('\n')
    )
    process.exitCode = 1
    return
  }
  const apiKey = arg('key')
  const keyProblem = validateApiKey(apiKey)
  if (keyProblem) {
    console.error(keyProblem)
    process.exitCode = 1
    return
  }
  const only = arg('task')
  const tasks = only
    ? [getTask(only)].filter(Boolean as unknown as (t: EvalTask | undefined) => t is EvalTask)
    : EVAL_TASKS
  if (!tasks.length) {
    console.error(`משימה לא נמצאה: ${only}`)
    process.exitCode = 1
    return
  }

  console.log(`מריץ ${tasks.length} משימות על ${model}\n`)
  const reports: TaskReport[] = []

  for (const task of tasks) {
    process.stdout.write(`${task.id.padEnd(26)} `)
    const report = await runTask(task, { model, apiKey, repoRoot })
    reports.push(report)
    const icon = report.status === 'pass' ? '✓' : report.status === 'fail' ? '✗' : '!'
    // בכשל הרצה הבדיקות חסרות משמעות — הן רצו על תבנית שלא נגעו בה
    const failed = report.status === 'error' ? [] : report.checks.filter((c) => c.status !== 'pass')
    console.log(
      `${icon} ${(report.durationMs / 1000).toFixed(1)}s · ${report.iterations} סבבים · ` +
        `${report.inputTokens + report.outputTokens} טוקנים` +
        (report.cacheReadTokens ? ` (${report.cacheReadTokens} ממטמון)` : '')
    )
    for (const c of failed) console.log(`    ${c.name}: ${c.detail ?? ''}`)
    if (report.error) console.log(`    שגיאת הרצה: ${report.error}`)
  }

  const passed = reports.filter((r) => r.status === 'pass').length
  const errored = reports.filter((r) => r.status === 'error').length
  const tokens = reports.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0)
  const cached = reports.reduce((n, r) => n + r.cacheReadTokens, 0)

  console.log(
    `\n${passed}/${reports.length} עברו · ${errored} שגיאות הרצה · ` +
      `${tokens.toLocaleString()} טוקנים` +
      (cached ? ` · ${Math.round((cached / tokens) * 100)}% ממטמון` : ' · אין מטמון')
  )

  const outDir = join(repoRoot, 'evals', 'reports')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outFile = join(outDir, `${stamp}-${model.replace(/[^\w.-]/g, '_')}.json`)
  writeFileSync(outFile, JSON.stringify({ model, reports }, null, 2), 'utf8')
  console.log(`דוח: ${outFile}`)

  process.exitCode = passed === reports.length ? 0 : 1

  // משימות BUILD משאירות אחריהן handles פתוחים במנוע (workers/תהליכי-בן) —
  // בלי יציאה מפורשת התהליך נשאר תלוי לנצח אחרי שהדוח כבר נכתב.
  // ההשהיה הקצרה נותנת ל-stdout להתרוקן (ב-Windows הכתיבה לצינור אסינכרונית).
  setTimeout(() => process.exit(process.exitCode ?? 0), 250)
}

void main()
