import type { RegisteredTool, ToolContext, ToolDefinition, ToolResult } from './types'
import { ToolError } from './types'
import { TOOL_DEFINITIONS, getToolDefinition } from './schemas'
import { readFileTool } from './read_file'
import { listDirTool } from './list_dir'
import { grepTool } from './grep'
import { declareScopeTool } from './declare_scope'
import { editFileTool } from './edit_file'
import { writeFileTool } from './write_file'
import { runCommandTool } from './run_command'
import { updatePlanTool } from './update_plan'
import { saveMemoryTool } from './save_memory'
import { webSearchTool, webFetchTool } from './web'

const HANDLERS = {
  read_file: readFileTool,
  list_dir: listDirTool,
  grep: grepTool,
  declare_scope: declareScopeTool,
  edit_file: editFileTool,
  write_file: writeFileTool,
  run_command: runCommandTool,
  update_plan: updatePlanTool,
  save_memory: saveMemoryTool,
  web_search: webSearchTool,
  web_fetch: webFetchTool
} as const

export type ToolName = keyof typeof HANDLERS

export const REGISTERED_TOOLS: RegisteredTool[] = TOOL_DEFINITIONS.map((definition) => {
  const name = definition.name as ToolName
  const execute = HANDLERS[name]
  if (!execute) {
    throw new Error(`Missing handler for tool: ${definition.name}`)
  }
  return { definition, execute }
})

/** JSON Schema tool list for provider adapters to translate */
export function listToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: { ...t.parameters }
  }))
}

export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return REGISTERED_TOOLS.find((t) => t.definition.name === name)
}

/**
 * Execute a tool by name.
 * Note: `edit_file` throws `ToolError` when `old_string` is missing or not unique.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const tool = getRegisteredTool(name)
  if (!tool) {
    return { ok: false, error: `כלי לא מוכר: ${name}`, code: 'unknown_tool' }
  }
  return tool.execute(args ?? {}, ctx)
}

export { getToolDefinition, TOOL_DEFINITIONS, ToolError }
