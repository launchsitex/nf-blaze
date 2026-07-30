import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { ProjectIndex } from './types'
import { MATCH_EXISTING_CODE_INSTRUCTION } from './types'

export function formatConventionsBlock(index: ProjectIndex): string {
  const c = index.conventions
  const state =
    c.stateManagement.length > 0 ? c.stateManagement.join(' + ') : 'unknown'
  const styling = c.styling.length > 0 ? c.styling.join(' + ') : 'unknown'

  const tsLines: string[] = []
  if (!c.typescript.used) {
    tsLines.push('- TypeScript: not detected (likely JS)')
  } else {
    tsLines.push('- TypeScript: yes')
    tsLines.push(
      `- Strict mode: ${
        c.typescript.strict === null ? 'unknown' : c.typescript.strict ? 'on' : 'off'
      }`
    )
    tsLines.push(
      `- \`any\` allowed: ${
        c.typescript.anyAllowed === null
          ? 'unknown'
          : c.typescript.anyAllowed
            ? 'yes (seen in codebase / not forbidden)'
            : 'avoid — prefer explicit types'
      }`
    )
    if (c.typescript.anyCount > 0) {
      tsLines.push(`- Observed \`any\` usages (approx): ${c.typescript.anyCount}`)
    }
  }

  return [
    '## Project conventions (auto-detected — follow these)',
    MATCH_EXISTING_CODE_INSTRUCTION,
    '',
    `- Exports: ${c.exports}`,
    `- File naming: ${c.fileNaming}`,
    `- State management: ${state}`,
    `- Styling: ${styling}`,
    `- Error handling: ${c.errorHandling}`,
    ...tsLines,
    '',
    `_Indexed ${index.filesSampled} files at ${index.scannedAt}_`
  ].join('\n')
}

function loadBaseSystemPrompt(): string {
  const candidates: string[] = []
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    candidates.push(join(here, '..', '..', 'prompts', 'system.md'))
  } catch {
    /* ignore */
  }
  candidates.push(join(process.cwd(), 'prompts', 'system.md'))

  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  }
  return 'You are NF-Blaze Agent. Use tools to edit the project carefully. Stop when done.'
}

/**
 * Compose the full system prompt for a request:
 * base prompts/system.md + cached project conventions block.
 */
export function composeSystemPrompt(index: ProjectIndex | null, baseOverride?: string): string {
  const base = (baseOverride ?? loadBaseSystemPrompt()).trim()
  if (!index) return base
  return `${base}\n\n${formatConventionsBlock(index)}`.trim()
}
