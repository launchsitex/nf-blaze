import { useCallback, useEffect, useState } from 'react'
import type { McpServerInfo, McpServersList } from '@shared/types'
import { Pencil, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react'

interface TestState {
  running: boolean
  message: string
  ok?: boolean
}

const EMPTY_FORM = { name: '', command: '', args: '', env: '' }

function toForm(s: McpServerInfo): typeof EMPTY_FORM {
  return {
    name: s.name,
    command: s.command,
    args: (s.args ?? []).join(' '),
    env: Object.entries(s.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  }
}

function parseEnv(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

/** כרטיס «שרתי MCP» במסך ההגדרות — ניהול הקובץ הגלובלי mcp.json */
export default function McpServersCard() {
  const [list, setList] = useState<McpServersList | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [status, setStatus] = useState('')
  const [tests, setTests] = useState<Record<string, TestState>>({})

  const refresh = useCallback(async () => {
    try {
      setList(await window.nfblaze.listMcpServers())
    } catch {
      /* main לא זמין — ישאר ריק */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save() {
    if (!form.name.trim() || !form.command.trim()) {
      setStatus('נדרשים שם ופקודה')
      return
    }
    try {
      const existing = list?.servers.find((s) => s.name === form.name.trim())
      const next = await window.nfblaze.saveMcpServer({
        name: form.name.trim(),
        command: form.command.trim(),
        args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
        env: parseEnv(form.env),
        disabled: existing?.disabled
      })
      setList(next)
      setForm(EMPTY_FORM)
      setEditing(null)
      setShowForm(false)
      setStatus(`השרת «${form.name.trim()}» נשמר`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(name: string) {
    if (!confirm(`למחוק את שרת ה-MCP «${name}»?`)) return
    setList(await window.nfblaze.removeMcpServer(name))
    setTests((t) => {
      const next = { ...t }
      delete next[name]
      return next
    })
    setStatus(`«${name}» נמחק`)
  }

  async function toggle(server: McpServerInfo) {
    const next = await window.nfblaze.saveMcpServer({
      ...server,
      disabled: !server.disabled
    })
    setList(next)
  }

  async function test(server: McpServerInfo) {
    setTests((t) => ({ ...t, [server.name]: { running: true, message: 'מתחבר…' } }))
    const res = await window.nfblaze.testMcpServer(server)
    setTests((t) => ({
      ...t,
      [server.name]: res.ok
        ? {
            running: false,
            ok: true,
            message: `מחובר · ${res.tools?.length ?? 0} כלים${
              res.tools?.length ? `: ${res.tools.slice(0, 8).join(', ')}` : ''
            }${(res.tools?.length ?? 0) > 8 ? '…' : ''}`
          }
        : { running: false, ok: false, message: res.error || 'החיבור נכשל' }
    }))
  }

  return (
    <div className="settings-card">
      <h3>
        <Plug size={18} style={{ verticalAlign: 'middle', marginLeft: 8 }} />
        שרתי MCP
      </h3>
      <p className="desc">
        חיבור כלים חיצוניים לסוכן (Model Context Protocol) — מסדי נתונים, APIs, שירותים.
        כל כלי משרת מחובר נחשף לסוכן כ-<code dir="ltr">mcp_&lt;שרת&gt;_&lt;כלי&gt;</code>.
        אפשר גם קונפיג פר-פרויקט ב-<code dir="ltr">.nf-blaze/mcp.json</code> (גובר על הגלובלי).
      </p>

      {list && list.servers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {list.servers.map((s) => {
            const t = tests[s.name]
            return (
              <div
                key={s.name}
                style={{
                  border: '1px solid var(--border, #333)',
                  borderRadius: 8,
                  padding: '8px 12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`dot ${s.disabled ? '' : 'on'}`} />
                  <strong>{s.name}</strong>
                  <code
                    dir="ltr"
                    style={{
                      opacity: 0.7,
                      fontSize: '0.8rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1
                    }}
                  >
                    {s.command} {(s.args ?? []).join(' ')}
                  </code>
                  <button
                    className="btn"
                    title="בדוק חיבור"
                    disabled={t?.running}
                    onClick={() => void test(s)}
                  >
                    <RefreshCw size={14} className={t?.running ? 'spin' : undefined} />
                    בדוק
                  </button>
                  <button className="btn" onClick={() => void toggle(s)}>
                    {s.disabled ? 'הפעל' : 'השבת'}
                  </button>
                  <button
                    className="btn"
                    title="ערוך"
                    onClick={() => {
                      setForm(toForm(s))
                      setEditing(s.name)
                      setShowForm(true)
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button className="btn btn-danger" title="מחק" onClick={() => void remove(s.name)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {t && !t.running && (
                  <div
                    dir="ltr"
                    style={{
                      marginTop: 6,
                      fontSize: '0.78rem',
                      textAlign: 'left',
                      color: t.ok ? 'var(--success, #4caf50)' : 'var(--danger, #d33)'
                    }}
                  >
                    {t.message}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {list && list.servers.length === 0 && !showForm && (
        <p className="desc" style={{ opacity: 0.8 }}>
          אין שרתים מוגדרים. לדוגמה: שרת GitHub —{' '}
          <code dir="ltr">npx -y @modelcontextprotocol/server-github</code>
        </p>
      )}

      {showForm ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="folder-row">
            <input
              className="input"
              placeholder="שם (למשל github)"
              value={form.name}
              disabled={Boolean(editing)}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={{ direction: 'ltr', textAlign: 'left', maxWidth: 180 }}
            />
            <input
              className="input"
              placeholder="פקודה (npx / node / uvx)"
              value={form.command}
              onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              style={{ direction: 'ltr', textAlign: 'left', maxWidth: 160 }}
            />
            <input
              className="input"
              placeholder="ארגומנטים: -y @modelcontextprotocol/server-github"
              value={form.args}
              onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
              style={{ direction: 'ltr', textAlign: 'left', flex: 1 }}
            />
          </div>
          <textarea
            className="input"
            placeholder={'משתני סביבה (שורה לכל אחד):\nGITHUB_PERSONAL_ACCESS_TOKEN=ghp_...'}
            value={form.env}
            rows={2}
            onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
            style={{ direction: 'ltr', textAlign: 'left', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => void save()}>
              {editing ? 'עדכן שרת' : 'הוסף שרת'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setShowForm(false)
                setEditing(null)
                setForm(EMPTY_FORM)
              }}
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={16} />
          הוסף שרת MCP
        </button>
      )}

      {status && (
        <p className="desc" style={{ marginTop: 8 }}>
          {status}
        </p>
      )}
      {list && (
        <p className="desc" dir="ltr" style={{ opacity: 0.6, fontSize: '0.72rem', textAlign: 'left', marginTop: 8 }}>
          {list.path}
        </p>
      )}
    </div>
  )
}
