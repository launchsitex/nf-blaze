/** Types for the isolated E2B session runtime layer */

export interface SandboxFileInput {
  /** Path relative to the session workdir (e.g. `index.html`, `src/App.tsx`) */
  path: string
  content: string | ArrayBuffer
}

export interface SandboxCommandResult {
  exitCode: number
  stdout: string
  stderr: string
  error?: string
}

export interface CreateSessionOptions {
  /** Defaults to `process.env.E2B_API_KEY` */
  apiKey?: string
  /** Sandbox lifetime in ms (E2B default ~5 min) */
  timeoutMs?: number
  /** E2B template name/id (default: base) */
  template?: string
  /** Absolute workdir inside the sandbox VM */
  workdir?: string
  /** Default preview HTTP port */
  previewPort?: number
}

export interface StartPreviewOptions {
  /** Port to expose (default: session previewPort) */
  port?: number
  /**
   * Allowlisted start command.
   * Default: `npm run preview` (falls back to static server if that script is missing).
   */
  command?: 'npm run preview' | 'npm run dev' | 'static'
}

export interface SessionInfo {
  sessionId: string
  sandboxId: string
  workdir: string
  previewPort: number
  previewUrl: string | null
}
