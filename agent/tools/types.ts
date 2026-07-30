/** Agent tool types — provider-agnostic JSON Schema definitions */

/** JSON Schema object (draft-ish) used as tool parameters */
export type JsonSchema = Record<string, unknown>

/**
 * Standard tool definition.
 * Adapters under `/providers` translate this to OpenAI / Anthropic / Gemini shapes.
 */
export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema for the tool arguments (never provider-specific) */
  parameters: JsonSchema
}

import type { ToolSession } from './session'

export interface ToolContext {
  /** Absolute project / workspace root — all paths are resolved under this */
  rootDir: string
  /** Optional timeout for run_command (ms) */
  commandTimeoutMs?: number
  /**
   * Per-request session (created by the agent loop).
   * Holds declared edit scope + files already read.
   */
  session?: ToolSession
}

export interface ToolSuccess {
  ok: true
  /** Human / model-readable payload */
  content: string
  /** Optional structured data */
  data?: unknown
}

export interface ToolFailure {
  ok: false
  error: string
  code?: string
}

export type ToolResult = ToolSuccess | ToolFailure

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult>

export interface RegisteredTool {
  definition: ToolDefinition
  execute: ToolHandler
}

export class ToolError extends Error {
  readonly code: string

  constructor(message: string, code = 'tool_error') {
    super(message)
    this.name = 'ToolError'
    this.code = code
  }
}
