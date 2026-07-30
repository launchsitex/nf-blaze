/**
 * MCP config — same JSON format as Claude Desktop / Dyad:
 * { "mcpServers": { "<name>": { "command": "npx", "args": [...], "env": {...} } } }
 *
 * Sources (merged, project wins):
 * 1. Global: <userData>/nf-blaze-data/mcp.json
 * 2. Per-project: <project>/.nf-blaze/mcp.json
 */
import { existsSync, readFileSync } from 'fs'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  /** true = מוגדר אך כבוי */
  disabled?: boolean
}

export type McpServersMap = Record<string, McpServerConfig>

/** Parse a single mcp.json content; invalid entries are dropped, never throw */
export function parseMcpConfig(raw: string): McpServersMap {
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> }
    const servers = parsed?.mcpServers
    if (!servers || typeof servers !== 'object') return {}
    const out: McpServersMap = {}
    for (const [name, value] of Object.entries(servers)) {
      if (!value || typeof value !== 'object') continue
      const v = value as Record<string, unknown>
      if (typeof v.command !== 'string' || !v.command.trim()) continue
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) continue
      out[name] = {
        command: v.command.trim(),
        args: Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === 'string') : [],
        env:
          v.env && typeof v.env === 'object'
            ? Object.fromEntries(
                Object.entries(v.env as Record<string, unknown>).filter(
                  (e): e is [string, string] => typeof e[1] === 'string'
                )
              )
            : undefined,
        cwd: typeof v.cwd === 'string' ? v.cwd : undefined,
        disabled: v.disabled === true
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Load + merge config files in order — later files override earlier (project wins) */
export function loadMcpServers(configPaths: string[]): McpServersMap {
  const merged: McpServersMap = {}
  for (const path of configPaths) {
    try {
      if (!existsSync(path)) continue
      Object.assign(merged, parseMcpConfig(readFileSync(path, 'utf-8')))
    } catch {
      /* unreadable config — skip */
    }
  }
  for (const [name, cfg] of Object.entries(merged)) {
    if (cfg.disabled) delete merged[name]
  }
  return merged
}

/** שם כלי בטוח לספקים: mcp_<server>_<tool> (מנוקה לתווים חוקיים) */
export function mcpToolName(server: string, tool: string): string {
  const clean = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `mcp_${clean(server)}_${clean(tool)}`
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp_')
}
