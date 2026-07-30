import { Octokit } from '@octokit/rest'
import simpleGit from 'simple-git'
import { existsSync } from 'fs'
import { join } from 'path'
import type { GithubRepoInfo, GithubUserInfo } from '../../../shared/types'
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
  const { data } = await client.users.getAuthenticated()
  return {
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url
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
