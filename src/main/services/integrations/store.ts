import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ProjectIntegrations } from '../../../shared/types'
import { DEFAULT_INTEGRATIONS } from '../../../shared/types'
import { getProject } from '../storage'

function integrationsPath(folderPath: string): string {
  const dir = join(folderPath, '.nf-blaze')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'integrations.json')
}

export function loadIntegrations(projectId: string): ProjectIntegrations {
  const project = getProject(projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    return structuredClone(DEFAULT_INTEGRATIONS)
  }
  const path = integrationsPath(project.folderPath)
  if (!existsSync(path)) return structuredClone(DEFAULT_INTEGRATIONS)
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ProjectIntegrations
    return {
      github: { ...DEFAULT_INTEGRATIONS.github, ...parsed.github },
      supabase: { ...DEFAULT_INTEGRATIONS.supabase, ...parsed.supabase },
      vercel: { ...DEFAULT_INTEGRATIONS.vercel, ...parsed.vercel }
    }
  } catch {
    return structuredClone(DEFAULT_INTEGRATIONS)
  }
}

export function saveIntegrations(projectId: string, data: ProjectIntegrations): ProjectIntegrations {
  const project = getProject(projectId)
  if (!project?.folderPath || !existsSync(project.folderPath)) {
    throw new Error('תיקיית הפרויקט לא נמצאה')
  }
  writeFileSync(integrationsPath(project.folderPath), JSON.stringify(data, null, 2), 'utf-8')
  return data
}

export function updateIntegrations(
  projectId: string,
  partial: Partial<ProjectIntegrations>
): ProjectIntegrations {
  const current = loadIntegrations(projectId)
  const next: ProjectIntegrations = {
    github: { ...current.github, ...partial.github },
    supabase: { ...current.supabase, ...partial.supabase },
    vercel: { ...current.vercel, ...partial.vercel }
  }
  return saveIntegrations(projectId, next)
}
