/** Shared abort registry for legacy + new agent chat runs */
import { cancelAllProjectChecks } from '../../../../agent/completion_check'

const activeControllers = new Map<string, AbortController>()

export type StreamEmitter = (event: import('../../../shared/types').AgentStreamEvent) => void

export function abortChat(projectId: string): boolean {
  const c = activeControllers.get(projectId)
  cancelAllProjectChecks()
  if (!c) return false
  c.abort()
  return true
}

export function registerChatAbort(projectId: string, controller: AbortController): void {
  abortChat(projectId)
  activeControllers.set(projectId, controller)
}

export function clearChatAbort(projectId: string): void {
  activeControllers.delete(projectId)
}
