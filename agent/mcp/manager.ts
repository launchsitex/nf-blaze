/**
 * MCP manager — keeps clients alive between agent runs, exposes namespaced
 * tool definitions + an execute router for the agent loop.
 */
import type { ToolDefinition } from '../tools/types'
import { McpClient } from './client'
import { loadMcpServers, mcpToolName, type McpServerConfig } from './config'

export interface McpExternalTool {
  definition: ToolDefinition
  execute: (args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>
}

interface LiveServer {
  client: McpClient
  /** JSON signature of the config that started it — restart on change */
  signature: string
}

const liveServers = new Map<string, LiveServer>()

function signatureOf(cfg: McpServerConfig): string {
  return JSON.stringify([cfg.command, cfg.args ?? [], cfg.env ?? {}, cfg.cwd ?? ''])
}

async function ensureServer(name: string, cfg: McpServerConfig): Promise<McpClient> {
  const sig = signatureOf(cfg)
  const existing = liveServers.get(name)
  if (existing && existing.signature === sig && existing.client.alive) {
    return existing.client
  }
  existing?.client.stop()
  const client = new McpClient(name, cfg)
  await client.start()
  liveServers.set(name, { client, signature: sig })
  return client
}

/**
 * Connect all configured servers and collect their tools.
 * Per-server failures are reported in `warnings` — never fail the whole run.
 */
export async function collectMcpTools(configPaths: string[]): Promise<{
  tools: McpExternalTool[]
  warnings: string[]
}> {
  const servers = loadMcpServers(configPaths)
  const tools: McpExternalTool[] = []
  const warnings: string[] = []

  await Promise.all(
    Object.entries(servers).map(async ([name, cfg]) => {
      try {
        const client = await ensureServer(name, cfg)
        const serverTools = await client.listTools()
        for (const t of serverTools) {
          const namespaced = mcpToolName(name, t.name)
          tools.push({
            definition: {
              name: namespaced,
              description: `[MCP:${name}] ${t.description ?? t.name}`,
              parameters:
                t.inputSchema && typeof t.inputSchema === 'object'
                  ? t.inputSchema
                  : { type: 'object', properties: {} }
            },
            execute: async (args) => {
              try {
                const res = await client.callTool(t.name, args)
                return { content: res.text, isError: res.isError }
              } catch (err) {
                return {
                  content: `MCP ${name}/${t.name}: ${err instanceof Error ? err.message : String(err)}`,
                  isError: true
                }
              }
            }
          })
        }
      } catch (err) {
        warnings.push(
          `שרת MCP «${name}» לא עלה: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    })
  )

  // סדר יציב — לא תלוי במרוץ ההתחברות
  tools.sort((a, b) => a.definition.name.localeCompare(b.definition.name))
  return { tools, warnings }
}

/** עצירת כל השרתים (יציאה מהאפליקציה) */
export function stopAllMcpServers(): void {
  for (const [, live] of liveServers) live.client.stop()
  liveServers.clear()
}
