/** Allowlisted shell commands for the E2B session runtime */

export type AllowlistedCommand =
  | 'npm install'
  | 'npm i'
  | 'npm ci'
  | 'npm run build'
  | 'npm run preview'
  | 'npm run dev'

const ALLOWED = new Set<string>([
  'npm install',
  'npm i',
  'npm ci',
  'npm run build',
  'npm run preview',
  'npm run dev'
])

export function assertAllowlistedCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, ' ')
  if (!ALLOWED.has(normalized)) {
    throw new Error(
      `פקודה לא מורשית ב-sandbox: "${command}". מותר: ${[...ALLOWED].join(', ')}`
    )
  }
  return normalized
}

/** Static file server used when no npm preview/dev script is available */
export function staticServerCommand(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`פורט לא תקין: ${port}`)
  }
  return `python3 -m http.server ${port}`
}
