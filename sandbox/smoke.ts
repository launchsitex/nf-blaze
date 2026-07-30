/**
 * Live smoke against real E2B.
 *
 * Requires: E2B_API_KEY in the environment.
 * Run: npx tsx sandbox/smoke.ts
 *   or: npm run sandbox:smoke
 */
import { createSession, destroySession } from './index'

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    console.error('Missing E2B_API_KEY — set it and retry.')
    process.exit(1)
  }

  const sessionId = `smoke-${Date.now()}`
  console.log('Creating session', sessionId)

  const runtime = await createSession(sessionId, {
    timeoutMs: 10 * 60 * 1000,
    previewPort: 3000
  })

  console.log('sandboxId:', runtime.sandboxId)

  await runtime.writeFiles([
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: 'nf-blaze-smoke',
          private: true,
          scripts: {
            build: 'mkdir -p dist && cp index.html dist/index.html',
            preview: 'python3 -m http.server 3000'
          }
        },
        null,
        2
      )
    },
    {
      path: 'index.html',
      content:
        '<!doctype html><html><body><h1>NF-Blaze E2B smoke</h1></body></html>'
    }
  ])
  console.log('Wrote files')

  const install = await runtime.npmInstall({ timeoutMs: 5 * 60 * 1000 })
  console.log('npm install exit:', install.exitCode)
  if (install.stderr) console.log(install.stderr.slice(0, 500))

  const build = await runtime.npmBuild({ timeoutMs: 2 * 60 * 1000 })
  console.log('npm run build exit:', build.exitCode)

  const url = await runtime.startPreview({ command: 'npm run preview', port: 3000 })
  console.log('Preview URL:', url)
  console.log('Open that URL in a browser — you should see "NF-Blaze E2B smoke".')

  await destroySession(sessionId)
  console.log('Destroyed session. OK.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
