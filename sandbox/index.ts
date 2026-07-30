import { SessionRuntime, type SandboxFactory } from './session'
import type { CreateSessionOptions } from './types'

/** In-memory registry: one E2B sandbox per user session id */
const sessions = new Map<string, SessionRuntime>()

export async function createSession(
  sessionId: string,
  options?: CreateSessionOptions,
  factory?: SandboxFactory
): Promise<SessionRuntime> {
  const existing = sessions.get(sessionId)
  if (existing) {
    await existing.destroy().catch(() => undefined)
    sessions.delete(sessionId)
  }

  const runtime = await SessionRuntime.create(sessionId, options, factory)
  sessions.set(sessionId, runtime)
  return runtime
}

export function getSession(sessionId: string): SessionRuntime | undefined {
  return sessions.get(sessionId)
}

export async function destroySession(sessionId: string): Promise<boolean> {
  const runtime = sessions.get(sessionId)
  if (!runtime) return false
  sessions.delete(sessionId)
  await runtime.destroy()
  return true
}

export async function destroyAllSessions(): Promise<void> {
  const all = [...sessions.values()]
  sessions.clear()
  await Promise.all(all.map((s) => s.destroy().catch(() => undefined)))
}

export function listSessionIds(): string[] {
  return [...sessions.keys()]
}

export { SessionRuntime } from './session'
export type { E2BSandboxHandle, SandboxFactory } from './session'
export type {
  CreateSessionOptions,
  SandboxCommandResult,
  SandboxFileInput,
  SessionInfo,
  StartPreviewOptions
} from './types'
