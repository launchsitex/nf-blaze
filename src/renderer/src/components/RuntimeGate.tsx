import { Download, RefreshCw, TriangleAlert } from 'lucide-react'

export type RuntimeEnvInfo = {
  ok: boolean
  source: 'bundled' | 'system' | 'missing'
  node: { available: boolean; version: string | null; path: string | null }
  npm: { available: boolean; version: string | null; path: string | null }
  bundledDir: string | null
  minNode: string
  downloadUrl: string
  checkedAt: string
  messageHe: string
  instructionHe: string
}

interface Props {
  env: RuntimeEnvInfo
  checking: boolean
  onRecheck: () => void
  onOpenSettings?: () => void
}

export default function RuntimeGate({ env, checking, onRecheck, onOpenSettings }: Props) {
  return (
    <div className="runtime-gate">
      <div className="runtime-gate-card">
        <div className="runtime-gate-icon">
          <TriangleAlert size={28} />
        </div>
        <h1>נדרש Node.js לבנייה מקומית</h1>
        <p className="runtime-gate-lead">{env.messageHe}</p>
        <p className="runtime-gate-help">
          {env.instructionHe ||
            'NF-Blaze מריץ התקנות ושרת פיתוח על המחשב שלכם — בלי Node ו-npm זה לא יכול לעבוד.'}
        </p>
        <div className="runtime-gate-meta" dir="ltr">
          <div>Node: {env.node.version || 'לא נמצא'} (מינימום {env.minNode})</div>
          <div>npm: {env.npm.version || 'לא נמצא'}</div>
        </div>
        <div className="runtime-gate-actions">
          <button
            className="btn btn-primary"
            onClick={() => void window.nfblaze.openExternal(env.downloadUrl)}
          >
            <Download size={16} />
            הורדת Node.js LTS
          </button>
          <button className="btn btn-ghost" disabled={checking} onClick={onRecheck}>
            <RefreshCw size={16} />
            {checking ? 'בודק…' : 'בדיקה מחדש'}
          </button>
          {onOpenSettings && (
            <button className="btn btn-ghost" onClick={onOpenSettings}>
              הגדרות
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
