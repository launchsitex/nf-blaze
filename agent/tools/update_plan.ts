/**
 * update_plan — תוכנית בנייה בשלבים שחיה בין הודעות (.nf-blaze/plan.json).
 * הסוכן יוצר אותה בבקשות גדולות, מסמן התקדמות, וממשיך ממנה בסבב הבא.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ToolHandler } from './types'
import { ToolError } from './types'
import { joinUnderRoot } from './paths'

type PlanStageStatus = 'pending' | 'in_progress' | 'done'

interface PlanStage {
  id: number
  title: string
  status: PlanStageStatus
  notes?: string
}

interface Plan {
  goal: string
  stages: PlanStage[]
  /**
   * קריטריוני קבלה — מה חייב לעבוד כדי שהמשימה תיחשב גמורה.
   * מנוסחים לפני הבנייה ונבדקים מולם בסוף; זה מה שמקפיץ הצלחה
   * מנסיון ראשון לעומת בנייה «לפי תחושה».
   */
  acceptance?: string[]
  updatedAt: string
}

const MAX_STAGES = 20
const MAX_ACCEPTANCE = 8
const STATUS_VALUES = new Set<PlanStageStatus>(['pending', 'in_progress', 'done'])

export function planFilePath(rootDir: string): string {
  return joinUnderRoot(rootDir, '.nf-blaze', 'plan.json')
}

export function readPlan(rootDir: string): Plan | null {
  const path = planFilePath(rootDir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Plan
  } catch {
    return null
  }
}

function parseStages(raw: unknown): PlanStage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolError('stages חייב להיות מערך לא ריק', 'invalid_args')
  }
  if (raw.length > MAX_STAGES) {
    throw new ToolError(`יותר מדי שלבים (מקסימום ${MAX_STAGES}) — אחד את שלבים קטנים`, 'invalid_args')
  }
  return raw.map((s, i) => {
    const stage = s as Record<string, unknown>
    const title = typeof stage.title === 'string' ? stage.title.trim().slice(0, 120) : ''
    if (!title) throw new ToolError(`לשלב ${i + 1} חסר title`, 'invalid_args')
    const status = STATUS_VALUES.has(stage.status as PlanStageStatus)
      ? (stage.status as PlanStageStatus)
      : 'pending'
    const notes =
      typeof stage.notes === 'string' && stage.notes.trim()
        ? stage.notes.trim().slice(0, 300)
        : undefined
    return { id: i + 1, title, status, notes }
  })
}

/** רשימת קריטריונים — אופציונלית, אבל כשהיא קיימת היא מחייבת */
export function parseAcceptance(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    throw new ToolError(
      'acceptance חייב להיות מערך של משפטים קצרים — מה חייב לעבוד כדי שהמשימה תיחשב גמורה',
      'invalid_args'
    )
  }
  const items = raw
    .map((v) => (typeof v === 'string' ? v.trim().slice(0, 200) : ''))
    .filter(Boolean)
  if (!items.length) return undefined
  if (items.length > MAX_ACCEPTANCE) {
    throw new ToolError(
      `יותר מדי קריטריונים (מקסימום ${MAX_ACCEPTANCE}) — השאר את החשובים באמת`,
      'invalid_args'
    )
  }
  return items
}

export const updatePlanTool: ToolHandler = async (args, ctx) => {
  try {
    const goal = typeof args.goal === 'string' ? args.goal.trim().slice(0, 300) : ''
    if (!goal) throw new ToolError('goal נדרש — תיאור קצר של מה בונים', 'invalid_args')
    const stages = parseStages(args.stages)
    const acceptance = parseAcceptance(args.acceptance)

    const plan: Plan = {
      goal,
      stages,
      ...(acceptance ? { acceptance } : {}),
      updatedAt: new Date().toISOString()
    }
    const path = planFilePath(ctx.rootDir)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(plan, null, 2), 'utf8')

    const done = stages.filter((s) => s.status === 'done').length
    const stageLine = stages
      .map((s) => `[${s.status === 'done' ? 'x' : s.status === 'in_progress' ? '~' : ' '}] ${s.title}`)
      .join(' | ')
    const acceptanceLine = acceptance
      ? `\nקריטריוני קבלה: ${acceptance.join(' · ')}`
      : '\nלא הוגדרו קריטריוני קבלה — הוסף acceptance כדי שיהיה מול מה לאמת בסיום.'
    return {
      ok: true,
      content: `Plan saved: ${done}/${stages.length} done — ${stageLine}${acceptanceLine}`,
      data: plan
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.message, code: err.code }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'plan_failed'
    }
  }
}
