import { createHash } from 'crypto'
import type {
  VercelDeployInput,
  VercelDeployResult,
  VercelProjectInfo,
  VercelUserInfo
} from '../../../shared/types'
import {
  getSecret,
  hasSecret,
  getVercelToken,
  getVercelPlatformToken,
  setSecret,
  clearSecret,
  supabaseAnonSlot
} from '../secrets'
import { loadSettingsRaw } from '../storage'
import { getProject } from '../storage'
import { loadIntegrations, updateIntegrations } from './store'
import { packProjectSource, type FrameworkSettings } from './vercel_pack'
import {
  formatFindingsForAgent,
  runPublishSecurityGate
} from '../security'

const API = 'https://api.vercel.com'

type AuthMode = 'user' | 'platform'

function resolveAuth(mode: AuthMode): { token: string; teamId?: string } {
  if (mode === 'platform') {
    const envToken = process.env.NF_BLAZE_VERCEL_TOKEN?.trim()
    const envTeam = process.env.NF_BLAZE_VERCEL_TEAM_ID?.trim()
    const token = envToken || getVercelPlatformToken()
    const settings = loadSettingsRaw()
    const teamId = envTeam || settings.vercelPlatformTeamId?.trim() || undefined
    if (!token) {
      throw new Error(
        'פרסום מיידי בלי חשבון דורש טוקן מארח. הגדר בהגדרות «טוקן מארח לפרסום מיידי» או משתני סביבה NF_BLAZE_VERCEL_TOKEN ו־NF_BLAZE_VERCEL_TEAM_ID.'
      )
    }
    if (!teamId) {
      throw new Error(
        'חסר מזהה צוות מארח (Team ID) לפרסום מיידי. הזן בהגדרות או ב־NF_BLAZE_VERCEL_TEAM_ID.'
      )
    }
    return { token, teamId }
  }
  const token = getVercelToken()
  if (!token) {
    throw new Error('לא הוגדר Vercel token. הוסף אותו בהגדרות.')
  }
  const settings = loadSettingsRaw()
  return { token, teamId: settings.vercelTeamId?.trim() || undefined }
}

async function vercelFetch<T>(
  path: string,
  opts: {
    method?: string
    token: string
    teamId?: string
    body?: unknown
    rawBody?: Buffer
    headers?: Record<string, string>
  }
): Promise<T> {
  const method = opts.method || 'GET'
  let url = `${API}${path}`
  if (opts.teamId && !/[?&]teamId=/.test(path)) {
    url += (path.includes('?') ? '&' : '?') + `teamId=${encodeURIComponent(opts.teamId)}`
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    ...opts.headers
  }

  let body: Uint8Array | string | undefined
  if (opts.rawBody) {
    body = new Uint8Array(opts.rawBody)
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(url, { method, headers, body })
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!res.ok) {
    const errObj = json as { error?: { message?: string }; message?: string } | null
    const msg =
      errObj?.error?.message || errObj?.message || text.slice(0, 400) || `HTTP ${res.status}`
    throw new Error(`Vercel API (${res.status}): ${msg}`)
  }
  return json as T
}

export async function validateVercelToken(token?: string): Promise<VercelUserInfo> {
  const auth = (token || getVercelToken() || '').trim()
  if (!auth) throw new Error('חסר Vercel token')
  const data = await vercelFetch<{
    user?: { id: string; username: string; name?: string; email?: string }
    id?: string
    username?: string
    name?: string
    email?: string
  }>('/v2/user', { token: auth })
  const u = data.user || data
  return {
    id: u.id || '',
    username: u.username || '',
    name: u.name || null,
    email: u.email || null
  }
}

export async function listVercelProjects(limit = 40): Promise<VercelProjectInfo[]> {
  const { token, teamId } = resolveAuth('user')
  const data = await vercelFetch<{
    projects?: Array<{ id: string; name: string; framework?: string | null }>
  }>(`/v9/projects?limit=${Math.min(limit, 100)}`, { token, teamId })
  return (data.projects || []).map((p) => ({
    id: p.id,
    name: p.name,
    framework: p.framework ?? null
  }))
}

function projectSettingsPayload(fw: FrameworkSettings): Record<string, string> {
  const ps: Record<string, string> = {}
  if (fw.framework && fw.framework !== 'other') ps.framework = fw.framework
  if (fw.buildCommand) ps.buildCommand = fw.buildCommand
  if (fw.outputDirectory) ps.outputDirectory = fw.outputDirectory
  if (fw.installCommand) ps.installCommand = fw.installCommand
  if (fw.devCommand) ps.devCommand = fw.devCommand
  return ps
}

function supabaseEnvPairs(projectId: string): Record<string, string> {
  const integ = loadIntegrations(projectId).supabase
  if (!integ.connected || !integ.projectUrl) return {}
  const anon = getSecret(supabaseAnonSlot(projectId))
  if (!anon) return {}
  const url = integ.projectUrl
  return {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon
  }
}

async function upsertProjectEnvs(
  token: string,
  teamId: string | undefined,
  projectIdOrName: string,
  envs: Record<string, string>
): Promise<void> {
  const keys = Object.keys(envs)
  if (!keys.length) return

  // Fetch existing to avoid duplicates
  let existing: Array<{ id: string; key: string }>
  try {
    const data = await vercelFetch<{ envs?: Array<{ id: string; key: string }> }>(
      `/v9/projects/${encodeURIComponent(projectIdOrName)}/env`,
      { token, teamId }
    )
    existing = data.envs || []
  } catch {
    existing = []
  }

  for (const [key, value] of Object.entries(envs)) {
    const found = existing.find((e) => e.key === key)
    if (found) {
      try {
        await vercelFetch(`/v9/projects/${encodeURIComponent(projectIdOrName)}/env/${found.id}`, {
          method: 'PATCH',
          token,
          teamId,
          body: {
            value,
            type: 'encrypted',
            target: ['production', 'preview', 'development']
          }
        })
      } catch {
        /* best-effort */
      }
    } else {
      try {
        await vercelFetch(`/v10/projects/${encodeURIComponent(projectIdOrName)}/env`, {
          method: 'POST',
          token,
          teamId,
          body: {
            key,
            value,
            type: 'encrypted',
            target: ['production', 'preview', 'development']
          }
        })
      } catch {
        /* best-effort */
      }
    }
  }
}

async function uploadSourceTgz(
  token: string,
  teamId: string | undefined,
  tgz: Buffer,
  sha: string
): Promise<void> {
  await vercelFetch('/v2/files', {
    method: 'POST',
    token,
    teamId,
    rawBody: tgz,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(tgz.length),
      'x-vercel-digest': sha,
      'x-vercel-size': String(tgz.length)
    }
  })
}

async function createDeployment(opts: {
  token: string
  teamId?: string
  name: string
  sha: string
  size: number
  framework: FrameworkSettings
  projectName?: string
  target?: 'production' | 'preview'
}): Promise<{
  id: string
  url: string
  readyState?: string
  projectId?: string
  name?: string
}> {
  const body: Record<string, unknown> = {
    name: opts.name,
    files: [
      {
        file: '.vercel/source.tgz',
        sha: opts.sha,
        size: opts.size
      }
    ],
    projectSettings: projectSettingsPayload(opts.framework),
    target: opts.target || 'production'
  }
  if (opts.projectName) {
    body.project = opts.projectName
  }

  return vercelFetch('/v13/deployments', {
    method: 'POST',
    token: opts.token,
    teamId: opts.teamId,
    body
  })
}

async function waitForDeployment(
  token: string,
  teamId: string | undefined,
  deploymentId: string,
  timeoutMs = 8 * 60 * 1000
): Promise<{
  id: string
  url: string
  readyState: string
  projectId?: string
  name?: string
  aliasError?: unknown
}> {
  const start = Date.now()
  let last = {
    id: deploymentId,
    url: '',
    readyState: 'QUEUED',
    projectId: undefined as string | undefined,
    name: undefined as string | undefined
  }

  while (Date.now() - start < timeoutMs) {
    const data = await vercelFetch<{
      id: string
      url?: string
      readyState?: string
      status?: string
      projectId?: string
      name?: string
    }>(`/v13/deployments/${encodeURIComponent(deploymentId)}`, { token, teamId })

    last = {
      id: data.id,
      url: data.url ? (data.url.startsWith('http') ? data.url : `https://${data.url}`) : last.url,
      readyState: data.readyState || data.status || 'UNKNOWN',
      projectId: data.projectId,
      name: data.name
    }

    if (['READY', 'ERROR', 'CANCELED'].includes(last.readyState)) {
      return last
    }
    await new Promise((r) => setTimeout(r, 2500))
  }

  return { ...last, readyState: last.readyState || 'TIMEOUT' }
}

export async function fetchDeploymentBuildLog(
  deploymentId: string,
  mode: AuthMode = 'user'
): Promise<string> {
  const { token, teamId } = resolveAuth(mode)
  try {
    const events = await vercelFetch<
      Array<{ type?: string; text?: string; payload?: { text?: string; info?: { name?: string } } }>
    >(`/v3/deployments/${encodeURIComponent(deploymentId)}/events?builds=1&direction=forward`, {
      token,
      teamId
    })
    if (Array.isArray(events)) {
      const lines = events
        .map((e) => e.text || e.payload?.text || '')
        .filter(Boolean)
      if (lines.length) return lines.join('\n')
    }
  } catch {
    /* try alternate */
  }

  try {
    const data = await vercelFetch<{ events?: Array<{ text?: string }> }>(
      `/v2/deployments/${encodeURIComponent(deploymentId)}/events`,
      { token, teamId }
    )
    const lines = (data.events || []).map((e) => e.text || '').filter(Boolean)
    if (lines.length) return lines.join('\n')
  } catch {
    /* ignore */
  }

  return 'לא הצלחנו למשוך את לוג הבנייה מ-Vercel.'
}

async function createClaimUrl(
  token: string,
  teamId: string,
  projectIdOrName: string,
  returnUrl?: string
): Promise<string> {
  const data = await vercelFetch<{ code?: string }>(
    `/v9/projects/${encodeURIComponent(projectIdOrName)}/transfer-request`,
    {
      method: 'POST',
      token,
      teamId,
      body: {}
    }
  )
  if (!data.code) throw new Error('Vercel לא החזיר קוד claim')
  const params = new URLSearchParams({ code: data.code })
  if (returnUrl) params.set('returnUrl', returnUrl)
  return `https://vercel.com/claim-deployment?${params.toString()}`
}

function slugifyName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 52) || `nf-blaze-${createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 8)}`
  )
}

function hebrewBuildFailure(log: string): string {
  return [
    'הבנייה ב-Vercel נכשלה.',
    'לרוב מדובר בשגיאת התקנה, TypeScript, או פקודת build.',
    '',
    '—— לוג בנייה ——',
    log.trim() || '(לוג ריק)',
    '—— סוף לוג ——'
  ].join('\n')
}

export async function deployToVercel(input: VercelDeployInput): Promise<VercelDeployResult> {
  const project = getProject(input.projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')

  const mode: AuthMode = input.mode === 'instant' ? 'platform' : 'user'
  const { token, teamId } = resolveAuth(mode)

  // Security gate — hard block before any upload
  const gate = await runPublishSecurityGate({
    projectId: input.projectId,
    folderPath: project.folderPath,
    override: input.securityOverride ?? null
  })
  if (gate.blocked) {
    updateIntegrations(input.projectId, {
      vercel: {
        ...loadIntegrations(input.projectId).vercel,
        lastErrorLog: gate.summaryHebrew
      }
    })
    return {
      ok: false,
      mode,
      deploymentId: '',
      readyState: 'SECURITY_BLOCKED',
      message: 'הפרסום נחסם בגלל בעיית אבטחה. תקנו את הממצאים או אשרו עקיפה מפורשת.',
      securityBlocked: true,
      securityFindings: gate.findings.map((f) => ({
        id: f.id,
        kind: f.kind,
        severity: f.severity,
        title: f.title,
        found: f.found,
        why: f.why,
        fixHint: f.fixHint,
        path: f.path
      })),
      securitySummaryHebrew: gate.summaryHebrew,
      securityAgentPrompt: formatFindingsForAgent(gate)
    }
  }

  const packed = packProjectSource(project.folderPath)
  if (packed.fileCount === 0) {
    throw new Error('אין קבצים לפרסום (התיקייה ריקה או הכל מסונן)')
  }

  await uploadSourceTgz(token, teamId, packed.tgz, packed.sha)

  const integ = loadIntegrations(input.projectId).vercel
  const deployName =
    input.projectName?.trim() ||
    integ.projectName ||
    slugifyName(project.name) ||
    `nf-blaze-${project.id.slice(0, 8)}`

  // For account mode: create/link project name; inject Supabase envs when possible
  let linkedProjectId = input.existingProjectId || integ.projectId
  let linkedProjectName = input.existingProjectName || integ.projectName || deployName

  if (mode === 'user') {
    if (input.createNew || (!linkedProjectId && !input.existingProjectId)) {
      linkedProjectName = slugifyName(input.projectName || project.name)
      try {
        const created = await vercelFetch<{ id: string; name: string }>('/v10/projects', {
          method: 'POST',
          token,
          teamId,
          body: {
            name: linkedProjectName,
            framework: packed.framework.framework || undefined
          }
        })
        linkedProjectId = created.id
        linkedProjectName = created.name
      } catch (e) {
        // Project may already exist — continue with name
        const msg = e instanceof Error ? e.message : String(e)
        if (!/already|exist|conflict/i.test(msg)) {
          // still try deploy by name
        }
      }
    } else if (input.existingProjectId) {
      linkedProjectId = input.existingProjectId
      linkedProjectName = input.existingProjectName || linkedProjectName
    }

    const envs = supabaseEnvPairs(input.projectId)
    if (Object.keys(envs).length && (linkedProjectId || linkedProjectName)) {
      await upsertProjectEnvs(token, teamId, linkedProjectId || linkedProjectName, envs)
    }
  }

  const deployment = await createDeployment({
    token,
    teamId,
    name: linkedProjectName || deployName,
    sha: packed.sha,
    size: packed.tgz.length,
    framework: packed.framework,
    projectName: mode === 'user' ? linkedProjectName : deployName,
    target: 'production'
  })

  const final = await waitForDeployment(token, teamId, deployment.id)
  const liveUrl =
    final.url ||
    (deployment.url
      ? deployment.url.startsWith('http')
        ? deployment.url
        : `https://${deployment.url}`
      : '')

  const projectId = final.projectId || deployment.projectId || linkedProjectId
  const projectName = final.name || linkedProjectName || deployName

  if (final.readyState === 'ERROR' || final.readyState === 'CANCELED') {
    const rawLog = await fetchDeploymentBuildLog(final.id, mode)
    const buildLogHebrew = hebrewBuildFailure(rawLog)
    updateIntegrations(input.projectId, {
      vercel: {
        connected: Boolean(liveUrl || projectId),
        mode,
        projectId: projectId || undefined,
        projectName,
        deploymentId: final.id,
        url: liveUrl || undefined,
        claimUrl: undefined,
        lastDeployAt: new Date().toISOString(),
        lastReadyState: final.readyState,
        lastErrorLog: buildLogHebrew,
        framework: packed.framework.framework
      }
    })
    return {
      ok: false,
      mode,
      url: liveUrl || undefined,
      deploymentId: final.id,
      projectId: projectId || undefined,
      projectName,
      readyState: final.readyState,
      framework: packed.framework.framework,
      buildLogHebrew,
      message: 'הבנייה ב-Vercel נכשלה. אפשר לשלוח את הלוג לסוכן לתיקון.'
    }
  }

  let claimUrl: string | undefined
  if (mode === 'platform' && projectId && teamId) {
    try {
      claimUrl = await createClaimUrl(token, teamId, projectId, liveUrl || undefined)
    } catch (e) {
      claimUrl = undefined
      const hint = e instanceof Error ? e.message : String(e)
      // Still success for live URL; claim is best-effort
      console.warn('[vercel] claim URL failed:', hint)
    }
  }

  // Platform mode: also try injecting env after we know project id
  if (mode === 'platform' && projectId) {
    const envs = supabaseEnvPairs(input.projectId)
    if (Object.keys(envs).length) {
      await upsertProjectEnvs(token, teamId, projectId, envs)
    }
  }

  updateIntegrations(input.projectId, {
    vercel: {
      connected: true,
      mode,
      projectId: projectId || undefined,
      projectName,
      deploymentId: final.id,
      url: liveUrl || undefined,
      claimUrl,
      lastDeployAt: new Date().toISOString(),
      lastReadyState: final.readyState,
      lastErrorLog: undefined,
      framework: packed.framework.framework
    }
  })

  return {
    ok: true,
    mode,
    url: liveUrl || undefined,
    claimUrl,
    deploymentId: final.id,
    projectId: projectId || undefined,
    projectName,
    readyState: final.readyState,
    framework: packed.framework.framework,
    fileCount: packed.fileCount,
    message:
      mode === 'platform'
        ? 'האתר פורסם. מומלץ ללחוץ על קישור ה-claim כדי להעביר בעלות לחשבון שלך.'
        : 'האתר פורסם לחשבון Vercel שלך.'
  }
}

export async function redeployVercel(
  projectId: string,
  securityOverride?: VercelDeployInput['securityOverride']
): Promise<VercelDeployResult> {
  const integ = loadIntegrations(projectId).vercel
  if (!integ.connected && !integ.projectName && !integ.url) {
    throw new Error('הפרויקט עדיין לא פורסם. בחר פרסום מיידי או פרסום לחשבון.')
  }
  const mode = integ.mode === 'platform' ? 'instant' : 'account'
  return deployToVercel({
    projectId,
    mode,
    existingProjectId: integ.projectId,
    existingProjectName: integ.projectName,
    createNew: false,
    securityOverride
  })
}

export function disconnectVercel(projectId: string): void {
  updateIntegrations(projectId, {
    vercel: {
      connected: false,
      mode: undefined,
      projectId: undefined,
      projectName: undefined,
      deploymentId: undefined,
      url: undefined,
      claimUrl: undefined,
      lastDeployAt: undefined,
      lastReadyState: undefined,
      lastErrorLog: undefined,
      framework: undefined
    }
  })
}

export function setVercelUserToken(token: string): void {
  setSecret('vercel', token.trim())
}

export function clearVercelUserToken(): void {
  clearSecret('vercel')
}

export function setVercelPlatformCredentials(token: string): void {
  setSecret('vercel-platform', token.trim())
}

export function clearVercelPlatformToken(): void {
  clearSecret('vercel-platform')
}

export function vercelTokenStatus(): {
  hasUserToken: boolean
  hasPlatformToken: boolean
} {
  return {
    hasUserToken: hasSecret('vercel') || Boolean(getVercelToken()),
    hasPlatformToken:
      hasSecret('vercel-platform') ||
      Boolean(getVercelPlatformToken()) ||
      Boolean(process.env.NF_BLAZE_VERCEL_TOKEN?.trim())
  }
}
