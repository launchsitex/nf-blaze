import { memo, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({
  breaks: true,
  gfm: true
})

interface Props {
  content: string
  className?: string
}

/**
 * memo — בזמן סטרימינג ה-WorkspacePage מתרנדר עשרות פעמים בשנייה;
 * בלי memo כל הודעות ההיסטוריה היו מתרנדרות מחדש בכל טוקן (תקיעות UI).
 */
function MarkdownMessageInner({ content, className }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true }
    })
  }, [content])

  return (
    <div
      className={`md-body ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const MarkdownMessage = memo(MarkdownMessageInner)
export default MarkdownMessage
