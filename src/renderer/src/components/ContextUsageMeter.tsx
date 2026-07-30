import { useEffect, useRef, useState } from 'react'
import type { ContextUsage } from '@shared/context'
import { formatTokenCount } from '@shared/context'
import { X } from 'lucide-react'

interface Props {
  usage: ContextUsage | null
}

export default function ContextUsageMeter({ usage }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  if (!usage) return null

  const unused = Math.max(0, usage.contextWindow - usage.usedTokens)
  const unusedPct = Math.max(0, 100 - usage.percent)

  function show(): void {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }

  function hideSoon(): void {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 180)
  }

  const barTone =
    usage.percent >= 90 ? 'crit' : usage.percent >= 70 ? 'warn' : 'ok'

  return (
    <div
      className="ctx-meter"
      ref={rootRef}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        className={`ctx-meter-trigger ctx-${barTone}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="שימוש ב-Context"
      >
        <span className="ctx-meter-bar" aria-hidden>
          {usage.buckets.map((b) => (
            <span
              key={b.id}
              className="ctx-seg"
              style={{
                width: `${Math.max(0.4, (b.tokens / usage.contextWindow) * 100)}%`,
                background: b.color
              }}
            />
          ))}
          {unusedPct > 0 && <span className="ctx-seg ctx-unused" style={{ flex: 1 }} />}
        </span>
        <span className="ctx-meter-label">
          {usage.percent % 1 === 0 ? usage.percent : usage.percent.toFixed(1)}%
          {usage.compactedAt ? ' · כווץ' : ''}
        </span>
      </button>

      {open && (
        <div
          className="ctx-popover"
          role="dialog"
          aria-label="Context Usage"
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          <div className="ctx-pop-head">
            <strong>Context Usage</strong>
            <button
              type="button"
              className="btn btn-ghost ctx-close"
              onClick={() => setOpen(false)}
              aria-label="סגור"
            >
              <X size={14} />
            </button>
          </div>
          <div className="ctx-pop-summary">
            <span>{usage.percent % 1 === 0 ? usage.percent : usage.percent.toFixed(1)}% Full</span>
            <span>
              ~{formatTokenCount(usage.usedTokens)} / {formatTokenCount(usage.contextWindow)} Tokens
            </span>
          </div>
          {usage.compactedAt && (
            <div className="ctx-compact-banner" title={usage.compactedAt}>
              כיווץ הקשר בוצע
              {usage.compactNote ? ` · ${usage.compactNote}` : ''}
              {usage.compactCount && usage.compactCount > 1
                ? ` · ${usage.compactCount}×`
                : ''}
            </div>
          )}
          <div className="ctx-pop-bar" aria-hidden>
            {usage.buckets.map((b) => (
              <span
                key={b.id}
                title={b.label}
                style={{
                  width: `${Math.max(0.5, (b.tokens / usage.contextWindow) * 100)}%`,
                  background: b.color
                }}
              />
            ))}
            {unused > 0 && (
              <span
                className="ctx-unused"
                style={{ width: `${(unused / usage.contextWindow) * 100}%` }}
              />
            )}
          </div>
          <ul className="ctx-legend">
            {usage.buckets.map((b) => (
              <li key={b.id}>
                <span className="ctx-dot" style={{ background: b.color }} />
                <span className="ctx-leg-label">{b.label}</span>
                <span className="ctx-leg-tokens">{formatTokenCount(b.tokens)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
