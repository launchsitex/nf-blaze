import { Octokit } from '@octokit/rest'
import simpleGit from 'simple-git'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import type { GithubRepoInfo, GithubUserInfo } from '../../../shared/types'
import type { McpExternalTool } from '../../../../agent/mcp/manager'
import { getGithubToken } from '../secrets'
import { getProject } from '../storage'
import { loadIntegrations, updateIntegrations } from './store'

function requireToken(): string {
  const token = getGithubToken()
  if (!token) {
    throw new Error('לא חובר חשבון GitHub. הוסף Personal Access Token בהגדרות.')
  }
  return token
}

function octokit(): Octokit {
  return new Octokit({ auth: requireToken(), userAgent: 'NF-Blaze' })
}

export async function validateGithubToken(token?: string): Promise<GithubUserInfo> {
  const auth = (token || getGithubToken() || '').trim()
  if (!auth) throw new Error('חסר GitHub token')
  const client = new Octokit({ auth, userAgent: 'NF-Blaze' })
  try {
    const { data } = await client.users.getAuthenticated()
    return {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url
    }
  } catch (err) {
    // «Bad credentials» באנגלית לא עוזר למשתמש — מתרגמים לפעולה
    const status = (err as { status?: number })?.status
    if (status === 401) {
      throw new Error(
        'GitHub דחה את הטוקן (401). הטוקן שגוי, פג תוקף או נמחק — צור אחד חדש ב-Settings ← Developer settings ← Personal access tokens.',
        { cause: err }
      )
    }
    if (status === 403) {
      throw new Error(
        'GitHub דחה את הבקשה (403). לרוב חסרות הרשאות לטוקן — נדרשות Contents + Metadata.',
        { cause: err }
      )
    }
    throw new Error(`החיבור ל-GitHub נכשל: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err
    })
  }
}

/** רשימת ענפים של הריפו המקושר — לבחירת ענף היעד לסנכרון */
export async function listGithubBranches(projectId: string): Promise<string[]> {
  const meta = loadIntegrations(projectId).github
  if (!meta.connected || !meta.repoFullName) {
    throw new Error('אין ריפו GitHub מקושר לפרויקט')
  }
  const [owner, repo] = meta.repoFullName.split('/')
  const client = octokit()
  const { data } = await client.repos.listBranches({
    owner: owner!,
    repo: repo!,
    per_page: 100
  })
  const names = data.map((b) => b.name)
  // הענף הנוכחי תמיד מופיע, גם אם הריפו עוד ריק
  const current = meta.defaultBranch || 'main'
  if (!names.includes(current)) names.unshift(current)
  return names
}

/** קביעת ענף היעד לסנכרון (push) */
export function setGithubBranch(projectId: string, branch: string): void {
  const clean = branch.trim()
  if (!/^[\w./-]+$/.test(clean)) throw new Error('שם ענף לא תקין')
  const meta = loadIntegrations(projectId).github
  if (!meta.connected) throw new Error('אין ריפו מקושר')
  updateIntegrations(projectId, { github: { ...meta, defaultBranch: clean } })
}

export async function listGithubRepos(limit = 30): Promise<GithubRepoInfo[]> {
  const client = octokit()
  const { data } = await client.repos.listForAuthenticatedUser({
    sort: 'updated',
    per_page: Math.min(limit, 100),
    affiliation: 'owner,organization_member'
  })
  return data.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    private: r.private,
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch || 'main'
  }))
}

/** `owner/repo`, כתובת דפדפן או כתובת clone — הכול מתנרמל לאותו דבר */
export function normalizeRepoUrl(input: string): string {
  const raw = (input || '').trim().replace(/\/+$/, '')
  if (!raw) throw new Error('יש להזין כתובת ריפוזיטורי')

  const shorthand = raw.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
  if (shorthand) return `https://github.com/${shorthand[1]}/${shorthand[2]}.git`

  const ssh = raw.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i)
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}.git`

  const https = raw.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i)
  if (https) return `https://github.com/${https[1]}/${https[2]}.git`

  throw new Error('כתובת לא מזוהה. השתמש ב-https://github.com/owner/repo או פשוט owner/repo')
}

/** שם ברירת מחדל לפרויקט מתוך כתובת הריפו */
export function repoNameFromUrl(cloneUrl: string): string {
  const m = cloneUrl.match(/github\.com\/[\w.-]+\/([\w.-]+?)(?:\.git)?$/i)
  return m?.[1] ?? ''
}

/**
 * שכפול ריפו לתיקייה ריקה.
 *
 * ריפו ציבורי עובד גם בלי טוקן; לריפו פרטי הטוקן נדרש ומוזרק לכתובת
 * רק לרגע הפעולה — לא נשמר ב-remote (`git remote set-url` בסוף).
 */
export async function cloneGithubRepo(input: {
  repoUrl: string
  targetDir: string
}): Promise<{ cloneUrl: string; folderPath: string }> {
  const cloneUrl = normalizeRepoUrl(input.repoUrl)
  const targetDir = input.targetDir?.trim()
  if (!targetDir) throw new Error('יש לבחור תיקיית יעד')

  if (existsSync(join(targetDir, '.git'))) {
    throw new Error('התיקייה כבר מכילה ריפוזיטורי git — בחר תיקייה ריקה')
  }

  const token = getGithubToken()
  const authUrl = token ? withTokenInUrl(cloneUrl, token) : cloneUrl

  try {
    await simpleGit().clone(authUrl, targetDir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/Authentication failed|could not read Username|403/i.test(message)) {
      throw new Error(
        token
          ? 'השכפול נכשל — לטוקן אין הרשאה לריפו הזה.'
          : 'הריפו פרטי. חבר חשבון GitHub בהגדרות ונסה שוב.',
        { cause: err }
      )
    }
    if (/not found|repository .* does not exist|404/i.test(message)) {
      throw new Error('הריפוזיטורי לא נמצא. בדוק את הכתובת.', { cause: err })
    }
    throw new Error(`שכפול נכשל: ${message}`, { cause: err })
  }

  // הטוקן לא נשאר בכתובת ה-remote על הדיסק
  if (token) {
    try {
      await simpleGit({ baseDir: targetDir }).remote(['set-url', 'origin', cloneUrl])
    } catch {
      /* remote יישאר עם הכתובת המאומתת — לא קריטי לתפקוד */
    }
  }

  return { cloneUrl, folderPath: targetDir }
}

export async function createGithubRepo(input: {
  projectId: string
  name: string
  description?: string
  isPrivate?: boolean
}): Promise<GithubRepoInfo> {
  const client = octokit()
  const name = input.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  if (!name) throw new Error('שם ריפו לא חוקי')

  const { data } = await client.repos.createForAuthenticatedUser({
    name,
    description: input.description || 'נוצר עם NF-Blaze',
    private: input.isPrivate !== false,
    auto_init: false
  })

  const repo: GithubRepoInfo = {
    fullName: data.full_name,
    name: data.name,
    private: data.private,
    htmlUrl: data.html_url,
    cloneUrl: data.clone_url,
    defaultBranch: data.default_branch || 'main'
  }

  await linkGithubRepo({
    projectId: input.projectId,
    cloneUrl: repo.cloneUrl,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    isPrivate: repo.private
  })

  return repo
}

export async function linkGithubRepo(input: {
  projectId: string
  cloneUrl: string
  fullName: string
  defaultBranch?: string
  isPrivate?: boolean
}): Promise<void> {
  const project = getProject(input.projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')

  const cloneUrl = input.cloneUrl.trim()
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(cloneUrl)) {
    throw new Error('כתובת ריפו לא חוקית — נדרש https://github.com/user/repo.git')
  }

  const git = simpleGit({ baseDir: project.folderPath })
  const gitDir = join(project.folderPath, '.git')
  if (!existsSync(gitDir)) {
    await git.init()
    await git.addConfig('user.email', 'nf-blaze@local', false, 'local').catch(() => undefined)
    await git.addConfig('user.name', 'NF-Blaze', false, 'local').catch(() => undefined)
  }

  const remotes = await git.getRemotes(true)
  const origin = remotes.find((r) => r.name === 'origin')
  const authUrl = withTokenInUrl(cloneUrl, requireToken())

  if (origin) {
    await git.remote(['set-url', 'origin', authUrl])
  } else {
    await git.addRemote('origin', authUrl)
  }

  const user = await validateGithubToken()
  updateIntegrations(input.projectId, {
    github: {
      connected: true,
      login: user.login,
      repoFullName: input.fullName,
      remoteUrl: cloneUrl.replace(/\.git$/i, '') + '.git',
      defaultBranch: input.defaultBranch || 'main',
      private: input.isPrivate
    }
  })
}

export async function pushGithubProject(
  projectId: string,
  message = 'עדכון מ-NF-Blaze'
): Promise<{ ok: boolean; summary: string }> {
  const project = getProject(projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')
  const meta = loadIntegrations(projectId).github
  if (!meta.connected || !meta.remoteUrl) {
    throw new Error('הפרויקט לא מקושר לריפו ב-GitHub')
  }

  const token = requireToken()
  const git = simpleGit({ baseDir: project.folderPath })
  const authUrl = withTokenInUrl(meta.remoteUrl, token)
  await git.remote(['set-url', 'origin', authUrl])

  await git.add('.')
  const status = await git.status()
  if (status.files.length > 0) {
    await git.commit(message)
  }

  const branch = meta.defaultBranch || 'main'
  const localBranches = await git.branchLocal()
  if (!localBranches.all.includes(branch)) {
    if (localBranches.current && localBranches.current !== branch) {
      await git.branch(['-M', branch])
    } else {
      await git.checkoutLocalBranch(branch).catch(async () => {
        await git.branch(['-M', branch])
      })
    }
  }

  await git.push(['-u', 'origin', branch])

  // Scrub token from remote URL after push
  await git.remote(['set-url', 'origin', meta.remoteUrl])

  return {
    ok: true,
    summary: `נדחף ל-${meta.repoFullName} (${branch})`
  }
}

/** שם ענף חוקי ל-git: אותיות/ספרות/`._-/`, בלי רווחים */
export function sanitizeBranchName(raw: string): string {
  const clean = (raw || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w./-]/g, '')
    .replace(/^[-./]+|[-./]+$/g, '')
    .slice(0, 80)
  return clean
}

/** שם ענף אקראי לפרסום מ-NF-Blaze, למשל nf-blaze-a1b2c3 */
export function generateBranchName(): string {
  return `nf-blaze-${randomBytes(3).toString('hex')}`
}

/** commit + push לענף חדש (בלי לגעת בענף הראשי) */
async function pushToNewBranch(
  projectId: string,
  branch: string,
  message: string
): Promise<void> {
  const project = getProject(projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')
  const meta = loadIntegrations(projectId).github
  if (!meta.connected || !meta.remoteUrl) throw new Error('הפרויקט לא מקושר לריפו')

  const token = requireToken()
  const git = simpleGit({ baseDir: project.folderPath })
  const authUrl = withTokenInUrl(meta.remoteUrl, token)
  await git.remote(['set-url', 'origin', authUrl])
  try {
    await git.add('.')
    const status = await git.status()
    if (status.files.length > 0) await git.commit(message)

    // יוצרים ענף חדש מ-HEAD הנוכחי; אם כבר קיים — checkout רגיל
    const locals = await git.branchLocal()
    if (locals.all.includes(branch)) {
      await git.checkout(branch)
    } else {
      await git.checkoutLocalBranch(branch)
    }
    await git.push(['-u', 'origin', branch])
  } finally {
    // אף פעם לא משאירים את הטוקן בכתובת ה-remote על הדיסק
    await git.remote(['set-url', 'origin', meta.remoteUrl]).catch(() => undefined)
  }
}

/**
 * פרסום הפרויקט ל-GitHub — הפעולה שהסוכן/המשתמש מפעיל.
 * - פרויקט מקושר לריפו → ענף חדש (nf-blaze-xxxxxx), בלי לגעת בראשי.
 * - פרויקט לא מקושר → ריפו חדש בחשבון המשתמש + push ראשוני.
 * דורש שחשבון GitHub מחובר (טוקן בהגדרות).
 */
export async function publishToGithub(
  projectId: string,
  opts?: { message?: string; branchName?: string }
): Promise<{
  ok: boolean
  mode: 'branch' | 'repo'
  repoFullName: string
  branch?: string
  url: string
  summary: string
}> {
  const project = getProject(projectId)
  if (!project?.folderPath) throw new Error('הפרויקט לא נמצא')
  requireToken() // חשבון GitHub חייב להיות מחובר

  const meta = loadIntegrations(projectId).github
  const message = opts?.message?.trim() || 'פרסום מ-NF-Blaze'

  // מקרה א׳: הפרויקט כבר מקושר לריפו → ענף חדש
  if (meta.connected && meta.repoFullName && meta.remoteUrl) {
    const branch = sanitizeBranchName(opts?.branchName || '') || generateBranchName()
    await pushToNewBranch(projectId, branch, message)
    const url = `https://github.com/${meta.repoFullName}/tree/${branch}`
    return {
      ok: true,
      mode: 'branch',
      repoFullName: meta.repoFullName,
      branch,
      url,
      summary: `נוצר ענף חדש «${branch}» ב-${meta.repoFullName}`
    }
  }

  // מקרה ב׳: לא מקושר → ריפו חדש בחשבון + push ראשוני
  const repoName = sanitizeBranchName(project.name || '') || `nf-blaze-${randomBytes(3).toString('hex')}`
  const repo = await createGithubRepo({ projectId, name: repoName, isPrivate: true })
  await pushGithubProject(projectId, message)
  return {
    ok: true,
    mode: 'repo',
    repoFullName: repo.fullName,
    url: repo.htmlUrl,
    summary: `נוצר ריפו חדש ${repo.fullName} והקוד הועלה`
  }
}

/**
 * כלי `publish_github` לסוכן — זמין כשחשבון GitHub מחובר.
 * מפרסם את הפרויקט (ענף חדש אם מקושר, ריפו חדש אחרת).
 */
export function buildGithubPublishTool(projectId: string): McpExternalTool | null {
  if (!getGithubToken()) return null
  return {
    definition: {
      name: 'publish_github',
      description:
        'מפרסם את הפרויקט ל-GitHub. אם הפרויקט כבר מקושר לריפו — יוצר ענף חדש (nf-blaze-...) ' +
        'בלי לגעת בראשי. אם לא מקושר — יוצר ריפו חדש בחשבון המשתמש ומעלה את הקוד. ' +
        'השתמש בזה כשהמשתמש מבקש לפרסם/להעלות/לגבות את הפרויקט ל-GitHub.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'הודעת commit (אופציונלי)' },
          branchName: {
            type: 'string',
            description: 'שם ענף מבוקש (אופציונלי; ברירת מחדל nf-blaze-אקראי)'
          }
        }
      }
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const res = await publishToGithub(projectId, {
          message: typeof args.message === 'string' ? args.message : undefined,
          branchName: typeof args.branchName === 'string' ? args.branchName : undefined
        })
        return { content: `✓ ${res.summary}\n${res.url}`, isError: false }
      } catch (err) {
        return { content: err instanceof Error ? err.message : String(err), isError: true }
      }
    }
  }
}

export async function disconnectGithub(projectId: string): Promise<void> {
  updateIntegrations(projectId, {
    github: {
      connected: false,
      login: undefined,
      repoFullName: undefined,
      remoteUrl: undefined,
      defaultBranch: undefined,
      private: undefined
    }
  })
  const project = getProject(projectId)
  if (!project?.folderPath) return
  try {
    const git = simpleGit({ baseDir: project.folderPath })
    const remotes = await git.getRemotes(true)
    if (remotes.some((r) => r.name === 'origin')) {
      await git.removeRemote('origin')
    }
  } catch {
    /* ignore */
  }
}

function withTokenInUrl(cloneUrl: string, token: string): string {
  // https://github.com/user/repo.git → https://x-access-token:TOKEN@github.com/user/repo.git
  const cleaned = cloneUrl.replace(/\.git$/i, '') + '.git'
  const m = cleaned.match(/^https:\/\/github\.com\/(.+)$/i)
  if (!m) throw new Error('כתובת GitHub לא נתמכת')
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${m[1]}`
}
