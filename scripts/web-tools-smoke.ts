/** Manual smoke: node/tsx scripts/web-tools-smoke.ts — hits the real network */
import { webSearchTool, webFetchTool } from '../agent/tools/web'

async function main(): Promise<void> {
  const ctx = { rootDir: process.cwd() }

  const search = await webSearchTool({ query: 'modern SaaS landing page design best practices' }, ctx)
  console.log('--- web_search ok:', search.ok)
  console.log(search.ok ? search.content.slice(0, 600) : search.error)

  const fetchRes = await webFetchTool({ url: 'https://example.com' }, ctx)
  console.log('--- web_fetch ok:', fetchRes.ok)
  console.log(fetchRes.ok ? fetchRes.content.slice(0, 300) : fetchRes.error)
}

main().catch((e) => {
  console.error('smoke failed:', e)
  process.exit(1)
})
