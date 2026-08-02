export const IPC = {
  // Settings / secrets
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_SET_KEY: 'settings:set-key',
  SETTINGS_HAS_KEY: 'settings:has-key',
  SETTINGS_CLEAR_KEY: 'settings:clear-key',

  // Security scan (on-demand, from the אבטחה tab)
  SECURITY_SCAN: 'security:scan',

  // משוב ודיווח באגים → פורטל הרישיונות
  FEEDBACK_SUBMIT: 'feedback:submit',

  // License
  LICENSE_STATUS: 'license:status',
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_CLEAR: 'license:clear',
  LICENSE_REVALIDATE: 'license:revalidate',

  // MCP servers (global mcp.json)
  MCP_LIST: 'mcp:list',
  MCP_SAVE: 'mcp:save',
  MCP_REMOVE: 'mcp:remove',
  MCP_TEST: 'mcp:test',

  // Projects
  PROJECTS_LIST: 'projects:list',
  PROJECTS_CREATE: 'projects:create',
  PROJECTS_IMPORT: 'projects:import',
  PROJECTS_IMPORT_GITHUB: 'projects:import-github',

  // Version history (restore points)
  SNAPSHOTS_LIST: 'snapshots:list',
  SNAPSHOTS_RESTORE: 'snapshots:restore',
  SNAPSHOTS_DIFF: 'snapshots:diff',
  CHAT_SET_APPROVAL: 'chat:set-approval',

  // Multiple chats per project
  CHATS_LIST: 'chats:list',
  CHATS_CREATE: 'chats:create',
  CHATS_SWITCH: 'chats:switch',
  CHATS_DELETE: 'chats:delete',
  CHATS_SUMMARIZE_NEW: 'chats:summarize-new',
  PROJECTS_UPDATE: 'projects:update',
  PROJECTS_DELETE: 'projects:delete',
  PROJECTS_GET: 'projects:get',
  PROJECTS_PICK_FOLDER: 'projects:pick-folder',
  PROJECTS_LIST_TEMPLATES: 'projects:list-templates',
  PROJECTS_PLAN_GET: 'projects:plan-get',
  PROJECTS_MEMORY_GET: 'projects:memory-get',

  // Project convention index (agent/index)
  PROJECT_INDEX_ENSURE: 'project-index:ensure',
  PROJECT_INDEX_REFRESH: 'project-index:refresh',
  PROJECT_INDEX_GET: 'project-index:get',

  // Files (scoped to project folder)
  FILES_TREE: 'files:tree',
  FILES_READ: 'files:read',
  FILES_WRITE: 'files:write',
  FILES_DELETE: 'files:delete',
  FILES_OPEN_EXTERNAL: 'files:open-external',
  FILES_PREVIEW_URL: 'files:preview-url',
  FILES_FIND_HTML: 'files:find-html',

  // Chat
  CHAT_GET: 'chat:get',
  CHAT_CLEAR: 'chat:clear',
  CHAT_SEND: 'chat:send',
  CHAT_SEND_STREAM: 'chat:send-stream',
  CHAT_STREAM_EVENT: 'chat:stream-event',
  CHAT_ABORT: 'chat:abort',
  CHAT_UNDO: 'chat:undo',
  CHAT_CAN_UNDO: 'chat:can-undo',
  CHAT_ESTIMATE_CONTEXT: 'chat:estimate-context',

  // Shell (scoped, allowlisted)
  SHELL_RUN: 'shell:run',
  SHELL_EVENT: 'shell:event',

  // Live / static preview
  PREVIEW_LIVE_ENSURE: 'preview:live-ensure',
  PREVIEW_LIVE_RESTART: 'preview:live-restart',
  PREVIEW_LIVE_STOP: 'preview:live-stop',
  PREVIEW_LIVE_URL: 'preview:live-url',
  PREVIEW_LIVE_STATUS: 'preview:live-status',
  PREVIEW_LIVE_EVENT: 'preview:live-event',
  PREVIEW_IS_VITE: 'preview:is-vite',

  // עדכוני גרסה
  APP_UPDATE_STATUS: 'app:update-status',
  APP_UPDATE_CHECK: 'app:update-check',
  APP_UPDATE_RETRY: 'app:update-retry',
  APP_UPDATE_INSTALL: 'app:update-install',
  APP_UPDATE_SNOOZE: 'app:update-snooze',
  APP_UPDATE_EVENT: 'app:update-event',
  APP_SEEN_VERSION_GET: 'app:seen-version-get',
  APP_SEEN_VERSION_SET: 'app:seen-version-set',

  // Integrations — GitHub / Supabase
  INTEG_GET: 'integ:get',
  // חיבור חשבון בלחיצה אחת (OAuth) — משותף לשלוש הפלטפורמות
  INTEG_OAUTH_CONNECT: 'integ:oauth-connect',
  INTEG_OAUTH_CANCEL: 'integ:oauth-cancel',
  INTEG_GITHUB_SET_TOKEN: 'integ:github-set-token',
  INTEG_GITHUB_CLEAR_TOKEN: 'integ:github-clear-token',
  INTEG_GITHUB_STATUS: 'integ:github-status',
  INTEG_GITHUB_VALIDATE: 'integ:github-validate',
  INTEG_GITHUB_BRANCHES: 'integ:github-branches',
  INTEG_GITHUB_SET_BRANCH: 'integ:github-set-branch',
  INTEG_GITHUB_LIST_REPOS: 'integ:github-list-repos',
  INTEG_GITHUB_CREATE_REPO: 'integ:github-create-repo',
  INTEG_GITHUB_LINK: 'integ:github-link',
  INTEG_GITHUB_PUSH: 'integ:github-push',
  INTEG_GITHUB_PUBLISH: 'integ:github-publish',
  INTEG_GITHUB_DISCONNECT: 'integ:github-disconnect',
  INTEG_SUPABASE_CONNECT: 'integ:supabase-connect',
  INTEG_SUPABASE_TEST: 'integ:supabase-test',
  INTEG_SUPABASE_DISCONNECT: 'integ:supabase-disconnect',
  INTEG_SUPABASE_ACCOUNT_STATUS: 'integ:supabase-account-status',
  INTEG_SUPABASE_ACCOUNT_DISCONNECT: 'integ:supabase-account-disconnect',
  INTEG_SUPABASE_LIST_PROJECTS: 'integ:supabase-list-projects',
  INTEG_SUPABASE_LINK_PROJECT: 'integ:supabase-link-project',

  INTEG_VERCEL_STATUS: 'integ:vercel-status',
  INTEG_VERCEL_SET_TOKEN: 'integ:vercel-set-token',
  INTEG_VERCEL_CLEAR_TOKEN: 'integ:vercel-clear-token',
  INTEG_VERCEL_SET_PLATFORM: 'integ:vercel-set-platform',
  INTEG_VERCEL_CLEAR_PLATFORM: 'integ:vercel-clear-platform',
  INTEG_VERCEL_VALIDATE: 'integ:vercel-validate',
  INTEG_VERCEL_LIST_PROJECTS: 'integ:vercel-list-projects',
  INTEG_VERCEL_DEPLOY: 'integ:vercel-deploy',
  INTEG_VERCEL_REDEPLOY: 'integ:vercel-redeploy',
  INTEG_VERCEL_DISCONNECT: 'integ:vercel-disconnect',
  INTEG_VERCEL_FETCH_LOG: 'integ:vercel-fetch-log',

  // App
  APP_GET_VERSION: 'app:get-version',
  APP_GET_PATH: 'app:get-path',
  APP_OPEN_PATH: 'app:open-path',
  APP_RUNTIME_ENV: 'app:runtime-env',
  APP_OPEN_EXTERNAL: 'app:open-external'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
