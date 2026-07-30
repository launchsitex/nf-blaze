export type {
  JsonSchema,
  RegisteredTool,
  ToolContext,
  ToolDefinition,
  ToolFailure,
  ToolHandler,
  ToolResult,
  ToolSuccess
} from './types'
export { ToolError } from './types'

export { TOOL_DEFINITIONS, getToolDefinition } from './schemas'
export {
  listToolDefinitions,
  getRegisteredTool,
  executeTool,
  REGISTERED_TOOLS,
  type ToolName
} from './registry'

export { applyUniqueEdit } from './edit_file'
export { parseAllowlistedCommand } from './run_command'
export { resolveInRoot, normalizeRelPath } from './paths'
export { assertWritableContent, parseImports, findJsxUsages } from './validate_write'
export { getComponentIndex, invalidateComponentIndex } from './component_index'
export {
  createToolSession,
  declareScope,
  assertInScope,
  assertReadBeforeEdit,
  markFileRead,
  type ToolSession,
  type ScopeDeclaration
} from './session'
