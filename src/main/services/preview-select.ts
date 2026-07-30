import type { PreviewElementSelection } from '../../shared/types'

function describeElement(el: PreviewElementSelection, index: number, total: number): string {
  const comp = el.component || el.tag || 'לא ידוע'
  const head = total > 1 ? `### אלמנט ${index + 1}` : ''
  const lines: string[] = head ? [head] : []
  if (el.file) {
    lines.push(`- קובץ: \`${el.file}\``, `- שורה: ${el.line}`)
  }
  lines.push(`- קומפוננטה / תג: ${comp}`)
  if (el.selector) lines.push(`- CSS selector: \`${el.selector}\``)
  if (el.text) lines.push(`- טקסט באלמנט: "${el.text}"`)
  if (!el.file) {
    lines.push('- (לא מתויג — אתר בקוד לפי ה-selector והטקסט עם grep)')
  }
  return lines.join('\n')
}

/** Context block for chat — the preview elements the user selected (one or many) */
export function formatSelectedElementsContext(
  els?: PreviewElementSelection[] | null
): string {
  const valid = (els ?? []).filter((el) => el && (el.file || el.selector))
  if (!valid.length) return ''
  const header =
    valid.length === 1
      ? '## אלמנט שנבחר בתצוגה המקדימה'
      : `## ${valid.length} אלמנטים שנבחרו בתצוגה המקדימה (לפי סדר הבחירה)`
  const body = valid.map((el, i) => describeElement(el, i, valid.length)).join('\n\n')
  const footer =
    valid.length === 1
      ? 'ההוראה של המשתמש מתייחסת לאלמנט זה — ערוך את הקוד במקום המדויק הזה.'
      : 'ההוראה של המשתמש מתייחסת לכל האלמנטים האלה. עבור על כולם — אם ההוראה כללית, החל אותה על כל אחד מהם; אם היא ממוספרת («הראשון», «השני»), המספור תואם לסדר כאן.'
  return [header, body, footer].join('\n\n')
}
