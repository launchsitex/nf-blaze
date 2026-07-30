/**
 * Minimal MCP (Model Context Protocol) client — stdio transport.
 * JSON-RPC 2.0 over newline-delimited JSON, no SDK dependency.
 */
import { spawn, type ChildProcess } from 'child_process'
import type { McpServerConfig } from './config'

const INIT_TIMEOUT_MS = 20_000
const CALL_TIMEOUT_MS = 60_000
const PROTOCOL_VERSION = '2025-06-18'

export interface McpToolInfo {
  name: string
  description?: string
  /** JSON Schema for arguments (MCP `inputSchema`) */
  inputSchema?: Record<string, unknown>
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** One connected MCP server over stdio */
export class McpClient {
  readonly name: string
  private child: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private closed = false
  private stderrTail = ''

  constructor(
    name: string,
    private readonly config: McpServerConfig
  ) {
    this.name = name
  }

  get alive(): boolean {
    return Boolean(this.child && !this.closed && this.child.exitCode === null)
  }

  async start(): Promise<void> {
    if (this.alive) return
    this.closed = false
    // Windows: פקודות כמו npx/node .cmd דורשות shell לרזולוציה.
    // עם shell, נתיבים/ארגומנטים עם רווחים חייבים ציטוט ידני (Node לא עושה escaping).
    const useShell = process.platform === 'win32'
    const quote = (s: string): string => (useShell && /\s/.test(s) ? `"${s}"` : s)
    const child = spawn(quote(this.config.command), (this.config.args ?? []).map(quote), {
      cwd: this.config.cwd,
      env: { ...process.env, ...(this.config.env ?? {}) },
      shell: useShell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => this.onData(chunk))
    // stderr = לוגים של השרת; נשמר לשיפור הודעות שגיאה כשהשרת נופל
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-600)
    })
    child.on('error', (err) => this.failAll(new Error(`MCP ${this.name}: ${err.message}`)))
    child.on('close', () => {
      this.closed = true
      const detail = this.stderrTail.trim()
      this.failAll(
        new Error(`MCP ${this.name}: השרת נסגר${detail ? ` — ${detail.slice(-300)}` : ''}`)
      )
    })

    await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'NF-Blaze', version: '1.37.0' }
      },
      INIT_TIMEOUT_MS
    )
    this.notify('notifications/initialized', {})
  }

  async listTools(): Promise<McpToolInfo[]> {
    const res = (await this.request('tools/list', {}, INIT_TIMEOUT_MS)) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    return (res.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }))
  }

  /** Call a tool; returns flattened text content */
  async callTool(name: string, args: Record<string, unknown>): Promise<{
    text: string
    isError: boolean
  }> {
    const res = (await this.request(
      'tools/call',
      { name, arguments: args },
      CALL_TIMEOUT_MS
    )) as {
      content?: Array<{ type: string; text?: string; [k: string]: unknown }>
      isError?: boolean
    }
    const text = (res.content ?? [])
      .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : `[${c.type}]`))
      .join('\n')
      .trim()
    return { text: text || '(ללא פלט)', isError: Boolean(res.isError) }
  }

  stop(): void {
    this.closed = true
    this.failAll(new Error(`MCP ${this.name}: הופסק`))
    try {
      this.child?.kill()
    } catch {
      /* already dead */
    }
    this.child = null
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as {
          id?: number
          result?: unknown
          error?: { code: number; message: string }
        }
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          clearTimeout(p.timer)
          if (msg.error) {
            p.reject(new Error(`MCP ${this.name}: ${msg.error.message}`))
          } else {
            p.resolve(msg.result)
          }
        }
        // בקשות/notifications מהשרת (sampling וכו') — לא נתמכים ב-v1, מתעלמים
      } catch {
        /* non-JSON line on stdout — ignore */
      }
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error(`MCP ${this.name}: השרת לא רץ`))
    }
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${this.name}: timeout על ${method} (${timeoutMs}ms)`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin!.write(payload + '\n', (err) => {
        if (err) {
          this.pending.delete(id)
          clearTimeout(timer)
          reject(err)
        }
      })
    })
  }

  private notify(method: string, params: unknown): void {
    if (!this.child?.stdin?.writable) return
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}
