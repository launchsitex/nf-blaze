import { spawn } from 'child_process'
import type { ToolHandler } from './types'
import { ToolError } from './types'

const ALLOWED = new Set([
  'npm install',
  'npm i',
  'npm ci',
  'npm run build',
  'npm run test',
  'npm run lint'
])

// סקריפטים ארוכי-ריצה שלא מסתיימים לבד — חוסמים את הלולאה עד ה-timeout
const LONG_RUNNING_SCRIPTS = new Set(['dev', 'start', 'preview', 'serve', 'watch'])

/** שם חבילת npm חוקי (כולל scope וגרסה): react, @radix-ui/react-accordion, dayjs@1.11.0 */
const PACKAGE_NAME_RE =
  /^(@[a-z0-9][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*(@[a-zA-Z0-9.^~<>=+-]+)?$/

/** דגלים בטוחים בהתקנת חבילות */
const SAFE_INSTALL_FLAGS = new Set(['-D', '--save-dev', '--save', '-E', '--save-exact'])

/** `npm install <חבילות>` — כל ארגומנט חייב להיות שם חבילה חוקי או דגל בטוח */
function isSafePackageInstall(parts: string[]): boolean {
  if (parts.length < 3) return false
  if (parts[0] !== 'npm' || (parts[1] !== 'install' && parts[1] !== 'i')) return false
  const rest = parts.slice(2)
  return rest.every((arg) => SAFE_INSTALL_FLAGS.has(arg) || PACKAGE_NAME_RE.test(arg))
}

/** Parse allowlisted command into executable + args */
export function parseAllowlistedCommand(command: string): { cmd: string; args: string[] } {
  const normalized = command.trim().replace(/\s+/g, ' ')
  const parts = normalized.split(' ')
  const allowed =
    ALLOWED.has(normalized) ||
    /^npm run [a-zA-Z0-9:_-]+$/.test(normalized) ||
    isSafePackageInstall(parts)
  if (!allowed) {
    throw new ToolError(
      `פקודה לא מורשית: "${command}". מותר: npm install [חבילות] / npm ci / npm run <script>`,
      'command_not_allowed'
    )
  }
  const scriptMatch = normalized.match(/^npm run ([a-zA-Z0-9:_-]+)$/)
  if (scriptMatch && LONG_RUNNING_SCRIPTS.has(scriptMatch[1])) {
    throw new ToolError(
      `"${normalized}" הוא תהליך ארוך-ריצה ואסור מתוך הסוכן — התצוגה החיה רצה אוטומטית על ידי NF-Blaze. לבדיקת קומפילציה השתמש ב-npm run build`,
      'command_not_allowed'
    )
  }

  // npm …
  return {
    cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: parts.slice(1)
  }
}

export const runCommandTool: ToolHandler = async (args, ctx) => {
  try {
    if (typeof args.command !== 'string' || !args.command.trim()) {
      throw new ToolError('command נדרש', 'invalid_args')
    }

    const { cmd, args: cmdArgs } = parseAllowlistedCommand(args.command)
    const timeoutMs = ctx.commandTimeoutMs ?? 5 * 60 * 1000
    // Windows: הרצת npm.cmd עם shell:false נכשלת ב-EINVAL בגרסאות Node מעודכנות
    const useShell = process.platform === 'win32' && /\.cmd$/i.test(cmd)

    const result = await new Promise<{
      exitCode: number
      stdout: string
      stderr: string
    }>((resolve, reject) => {
      const child = spawn(cmd, cmdArgs, {
        cwd: ctx.rootDir,
        shell: useShell,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          PATHEXT: process.env.PATHEXT,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          APPDATA: process.env.APPDATA,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          ComSpec: process.env.ComSpec,
          // NO_COLOR מכבה צבעים בכל הספריות; FORCE_COLOR (גם '0') מדליק אותם ב-picocolors
          NO_COLOR: '1',
          NO_UPDATE_NOTIFIER: '1'
        }
      })

      let stdout = ''
      let stderr = ''
      let settled = false

      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        if (!settled) {
          settled = true
          reject(new ToolError(`פקודה חרגה מ-${timeoutMs}ms`, 'timeout'))
        }
      }, timeoutMs)

      child.stdout.on('data', (buf: Buffer) => {
        stdout += buf.toString('utf8')
      })
      child.stderr.on('data', (buf: Buffer) => {
        stderr += buf.toString('utf8')
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(err)
        }
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve({ exitCode: code ?? 1, stdout, stderr })
        }
      })
    })

    const content = [
      `$ ${args.command}`,
      result.stdout.trimEnd(),
      result.stderr.trimEnd(),
      `exit_code=${result.exitCode}`
    ]
      .filter(Boolean)
      .join('\n')

    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: content || `Command failed with code ${result.exitCode}`,
        code: 'command_failed'
      }
    }

    return {
      ok: true,
      content,
      data: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'command_failed'
    }
  }
}
