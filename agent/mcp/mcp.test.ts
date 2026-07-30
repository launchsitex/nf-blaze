import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { isMcpToolName, loadMcpServers, mcpToolName, parseMcpConfig } from './config'
import { McpClient } from './client'

describe('parseMcpConfig', () => {
  it('parses the Claude Desktop / Dyad format', () => {
    const servers = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
          db: { command: 'node', args: ['db.js'], env: { DB_URL: 'postgres://x' } }
        }
      })
    )
    expect(Object.keys(servers).sort()).toEqual(['db', 'github'])
    expect(servers.github!.command).toBe('npx')
    expect(servers.db!.env).toEqual({ DB_URL: 'postgres://x' })
  })

  it('drops invalid entries and invalid JSON without throwing', () => {
    expect(parseMcpConfig('not json')).toEqual({})
    expect(parseMcpConfig('{}')).toEqual({})
    const servers = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          ok: { command: 'node' },
          'bad name!': { command: 'node' },
          noCommand: { args: ['x'] },
          numeric: { command: 42 }
        }
      })
    )
    expect(Object.keys(servers)).toEqual(['ok'])
  })
})

describe('loadMcpServers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-mcp-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('merges files with later (project) config winning, and drops disabled', () => {
    const globalPath = join(dir, 'global.json')
    const projectPath = join(dir, 'project.json')
    writeFileSync(
      globalPath,
      JSON.stringify({
        mcpServers: {
          shared: { command: 'global-cmd' },
          off: { command: 'x', disabled: true }
        }
      })
    )
    writeFileSync(
      projectPath,
      JSON.stringify({ mcpServers: { shared: { command: 'project-cmd' } } })
    )
    const servers = loadMcpServers([globalPath, projectPath, join(dir, 'missing.json')])
    expect(Object.keys(servers)).toEqual(['shared'])
    expect(servers.shared!.command).toBe('project-cmd')
  })
})

describe('mcpToolName', () => {
  it('namespaces and sanitizes', () => {
    expect(mcpToolName('github', 'create_issue')).toBe('mcp_github_create_issue')
    expect(mcpToolName('my srv', 'do/it')).toBe('mcp_my_srv_do_it')
    expect(isMcpToolName('mcp_github_create_issue')).toBe(true)
    expect(isMcpToolName('read_file')).toBe(false)
  })
})

describe('McpClient (live stdio round-trip)', () => {
  // שרת MCP מזערי בתהליך node נפרד — עונה ל-initialize / tools/list / tools/call
  const serverJs = `
    const rl = require('readline').createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg; try { msg = JSON.parse(line); } catch { return; }
      const reply = (result) =>
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
      if (msg.method === 'initialize') {
        reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } });
      } else if (msg.method === 'tools/list') {
        reply({ tools: [{ name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] });
      } else if (msg.method === 'tools/call') {
        reply({ content: [{ type: 'text', text: 'echo: ' + msg.params.arguments.text }], isError: false });
      }
    });
  `
  const dir = mkdtempSync(join(tmpdir(), 'nf-mcp-srv-'))
  const serverPath = join(dir, 'fake-server.cjs')
  writeFileSync(serverPath, serverJs)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('initializes, lists tools and calls a tool', async () => {
    const client = new McpClient('fake', {
      command: process.execPath,
      args: [serverPath]
    })
    try {
      await client.start()
      const tools = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(['echo'])
      expect(tools[0]!.inputSchema).toMatchObject({ type: 'object' })

      const result = await client.callTool('echo', { text: 'שלום' })
      expect(result.isError).toBe(false)
      expect(result.text).toBe('echo: שלום')
    } finally {
      client.stop()
    }
  }, 20_000)
})
