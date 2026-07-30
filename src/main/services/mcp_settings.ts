/**
 * ניהול קובץ ה-MCP הגלובלי (nf-blaze-data/mcp.json) מתוך מסך ההגדרות:
 * רשימה / הוספה / עריכה / מחיקה / בדיקת חיבור.
 * קונפיג פר-פרויקט (.nf-blaze/mcp.json) נשאר קובץ שהמשתמש עורך ידנית.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import {
  parseMcpConfig,
  type McpServerConfig
} from '../../../agent/mcp/config'
import { McpClient } from '../../../agent/mcp/client'
import type {
  McpServerInfo,
  McpServersList,
  McpTestOutcome
} from '../../shared/types'

export type McpServerEntry = McpServerInfo
export type McpListResult = McpServersList
export type McpTestResult = McpTestOutcome

const NAME_RE = /^[a-zA-Z0-9_-]+$/

export function globalMcpPath(): string {
  return join(app.getPath('userData'), 'nf-blaze-data', 'mcp.json')
}

function readServers(): Record<string, McpServerConfig> {
  const path = globalMcpPath()
  if (!existsSync(path)) return {}
  try {
    return parseMcpConfig(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

function writeServers(servers: Record<string, McpServerConfig>): void {
  const path = globalMcpPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ mcpServers: servers }, null, 2), 'utf-8')
}

export function listMcpServers(): McpListResult {
  const servers = readServers()
  return {
    path: globalMcpPath(),
    servers: Object.entries(servers)
      .map(([name, cfg]) => ({ name, ...cfg }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}

export function saveMcpServer(entry: McpServerEntry): McpListResult {
  const name = entry.name?.trim()
  if (!name || !NAME_RE.test(name)) {
    throw new Error('שם שרת חייב להכיל רק אותיות לטיניות, ספרות, מקף וקו תחתון')
  }
  if (!entry.command?.trim()) {
    throw new Error('נדרשת פקודה (למשל npx או node)')
  }
  const servers = readServers()
  servers[name] = {
    command: entry.command.trim(),
    args: (entry.args ?? []).filter((a) => a.trim()),
    ...(entry.env && Object.keys(entry.env).length ? { env: entry.env } : {}),
    ...(entry.cwd?.trim() ? { cwd: entry.cwd.trim() } : {}),
    ...(entry.disabled ? { disabled: true } : {})
  }
  writeServers(servers)
  return listMcpServers()
}

export function removeMcpServer(name: string): McpListResult {
  const servers = readServers()
  delete servers[name]
  writeServers(servers)
  return listMcpServers()
}

/** מרים את השרת זמנית, מושך רשימת כלים וסוגר — בלי לגעת בשרתים החיים של הסוכן */
export async function testMcpServer(entry: McpServerEntry): Promise<McpTestResult> {
  const client = new McpClient(entry.name || 'test', {
    command: entry.command,
    args: entry.args,
    env: entry.env,
    cwd: entry.cwd
  })
  try {
    await client.start()
    const tools = await client.listTools()
    return { ok: true, tools: tools.map((t) => t.name) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    client.stop()
  }
}
