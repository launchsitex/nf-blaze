import { useMemo, useState } from 'react'
import type { ClarifyBlock } from '@shared/types'

const EXTRA_OTHER = 'אחר'
const EXTRA_DECIDE = 'תחליט אתה'

interface Props {
  clarify: ClarifyBlock
  disabled?: boolean
  onSubmit: (answersText: string) => void
}

export default function ClarifyCard({ clarify, disabled, onSubmit }: Props) {
  const questions = clarify.questions || []
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [otherText, setOtherText] = useState<Record<number, string>>({})

  const optionsFor = useMemo(() => {
    return questions.map((q) => {
      const base = [...(q.options || [])]
      if (!base.includes(EXTRA_OTHER)) base.push(EXTRA_OTHER)
      if (!base.includes(EXTRA_DECIDE)) base.push(EXTRA_DECIDE)
      return base
    })
  }, [questions])

  function toggle(qi: number, option: string, multi: boolean): void {
    setSelected((prev) => {
      const cur = prev[qi] || []
      if (multi) {
        const next = cur.includes(option) ? cur.filter((x) => x !== option) : [...cur, option]
        return { ...prev, [qi]: next }
      }
      return { ...prev, [qi]: [option] }
    })
  }

  function ready(): boolean {
    return questions.every((_, qi) => {
      const picks = selected[qi] || []
      if (!picks.length) return false
      if (picks.includes(EXTRA_OTHER) && !(otherText[qi] || '').trim()) return false
      return true
    })
  }

  function submit(): void {
    if (!ready() || disabled) return
    const lines = questions.map((q, qi) => {
      const picks = selected[qi] || []
      const parts = picks.map((p) =>
        p === EXTRA_OTHER ? (otherText[qi] || '').trim() || EXTRA_OTHER : p
      )
      return `${qi + 1}. ${q.q}: ${parts.join(', ')}`
    })
    onSubmit(`תשובות להבהרה:\n${lines.join('\n')}`)
  }

  if (!questions.length) return null

  return (
    <div className="clarify-card" dir="rtl">
      <div className="clarify-card-title">שאלות הבהרה</div>
      {questions.map((q, qi) => {
        const multi = Boolean(q.multi)
        const picks = selected[qi] || []
        const showOther = picks.includes(EXTRA_OTHER)
        return (
          <div key={qi} className="clarify-q">
            <div className="clarify-q-text">{q.q}</div>
            <div className="clarify-options">
              {optionsFor[qi].map((opt) => {
                const active = picks.includes(opt)
                return (
                  <button
                    key={opt}
                    type="button"
                    className={`clarify-opt ${active ? 'active' : ''}`}
                    disabled={disabled}
                    onClick={() => toggle(qi, opt, multi)}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
            {showOther && (
              <input
                className="clarify-other"
                dir="rtl"
                placeholder="פרט כאן…"
                value={otherText[qi] || ''}
                disabled={disabled}
                onChange={(e) =>
                  setOtherText((prev) => ({ ...prev, [qi]: e.target.value }))
                }
              />
            )}
          </div>
        )
      })}
      <button
        type="button"
        className="btn btn-primary clarify-submit"
        disabled={disabled || !ready()}
        onClick={() => submit()}
      >
        שלח תשובות
      </button>
    </div>
  )
}
