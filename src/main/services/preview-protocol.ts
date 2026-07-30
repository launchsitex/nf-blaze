import { protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { extname, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getProject } from './storage'
import { resolveSafePath } from './filesystem'

const SCHEME = 'nfblaze'

function loadSelectClientScript(): string {
  const candidates = [
    // dev (cwd = repo root) | packaged (out/main → שורש ה-asar) | fallback ישן
    join(process.cwd(), 'packages', 'vite-plugin-nf-source', 'src', 'client.js'),
    join(__dirname, '..', '..', 'packages', 'vite-plugin-nf-source', 'src', 'client.js'),
    join(__dirname, '..', '..', '..', 'packages', 'vite-plugin-nf-source', 'src', 'client.js')
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const mod = readFileSync(p, 'utf-8')
      const m = mod.match(/export const SELECT_CLIENT_SCRIPT = String\.raw`([\s\S]*?)`/)
      if (m?.[1]) return m[1]
    } catch {
      /* next */
    }
  }
  // Minimal fallback
  return `(function(){window.addEventListener('message',function(e){if(e.data&&e.data.type==='nf-blaze:set-select-mode'){/* no tags */}});try{window.parent.postMessage({type:'nf-blaze:select-ready'},'*')}catch(e){}})();`
}

function injectSelectClient(html: string): string {
  if (html.includes('data-nf-blaze-select-client')) return html
  const script = `<script data-nf-blaze-select-client="1">${loadSelectClientScript()}</script>`
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}</body>`)
  }
  return html + script
}

/** Must be called before app.ready */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

function mimeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Static HTML preview over custom protocol.
 * URL shape: nfblaze://preview/<projectId>/<relative/path>
 * Example: nfblaze://preview/abc-uuid/index.html
 *
 * React/Vite (package.json scripts.dev) use the live preview service instead —
 * this protocol remains the path for plain HTML/CSS/JS projects and build fallbacks.
 */
export function buildPreviewUrl(projectId: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = clean.split('/').map(encodeURIComponent).join('/')
  return `${SCHEME}://preview/${encodeURIComponent(projectId)}/${parts}`
}

export function registerPreviewProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // hostname is "preview", pathname: /<projectId>/index.html
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (url.hostname !== 'preview' || segments.length < 2) {
        return new Response('Not found', { status: 404 })
      }
      const projectId = segments[0]
      const relativePath = segments.slice(1).join('/')
      const project = getProject(projectId)
      if (!project?.folderPath) {
        return new Response('Project not found', { status: 404 })
      }
      const full = resolveSafePath(project.folderPath, relativePath)
      if (!existsSync(full)) {
        return new Response(`File not found: ${relativePath}`, { status: 404 })
      }
      const fileUrl = pathToFileURL(full).toString()
      const res = await net.fetch(fileUrl)
      const buf = await res.arrayBuffer()
      const mime = mimeFor(full)
      if (mime.startsWith('text/html')) {
        let html = Buffer.from(buf).toString('utf-8')
        html = injectSelectClient(html)
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'no-store'
          }
        })
      }
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'no-store'
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return new Response(msg, { status: 500 })
    }
  })
}
