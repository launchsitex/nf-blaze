/**
 * Smoke test: register nfblaze preview protocol, serve a temp HTML site, verify fetch.
 * Run: npx electron scripts/smoke-preview.cjs
 */
const { app, protocol, net, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync, rmSync, existsSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')
const { pathToFileURL } = require('url')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nfblaze',
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

const root = join(tmpdir(), `nf-blaze-smoke-${Date.now()}`)
mkdirSync(join(root, 'css'), { recursive: true })
writeFileSync(
  join(root, 'index.html'),
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="css/style.css"><title>T</title></head><body><h1 id="ok">שלום מחיפה</h1></body></html>',
  'utf-8'
)
writeFileSync(join(root, 'css', 'style.css'), 'h1{color:#e8a04a}', 'utf-8')

app.whenReady().then(async () => {
  let failed = false
  try {
    protocol.handle('nfblaze', async (request) => {
      const url = new URL(request.url)
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      // nfblaze://preview/demo/index.html → hostname preview, path /demo/index.html
      const rel = segments.slice(1).join('/') || 'index.html'
      const full = join(root, rel)
      if (!existsSync(full)) return new Response('missing', { status: 404 })
      const res = await net.fetch(pathToFileURL(full).toString())
      const buf = await res.arrayBuffer()
      const mime = full.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'
      return new Response(buf, { status: 200, headers: { 'Content-Type': mime } })
    })

    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    })

    const previewUrl = 'nfblaze://preview/demo/index.html'
    await win.loadURL(previewUrl)
    const title = await win.webContents.executeJavaScript('document.title')
    const heading = await win.webContents.executeJavaScript(
      'document.getElementById("ok")?.textContent || ""'
    )
    const color = await win.webContents.executeJavaScript(
      'getComputedStyle(document.getElementById("ok")).color'
    )

    console.log('TITLE:', title)
    console.log('HEADING:', heading)
    console.log('COLOR:', color)

    if (heading !== 'שלום מחיפה') {
      throw new Error(`Expected Hebrew heading, got: ${heading}`)
    }
    // CSS loaded if color is not default black (rgb(0,0,0)) — amber-ish
    if (!color || color === 'rgb(0, 0, 0)') {
      // still OK if CSS async; check stylesheet count
      const sheets = await win.webContents.executeJavaScript('document.styleSheets.length')
      if (sheets < 1) throw new Error('CSS stylesheet not loaded')
    }

    console.log('SMOKE_PREVIEW_OK')
    win.close()
  } catch (err) {
    failed = true
    console.error('SMOKE_PREVIEW_FAIL', err)
  } finally {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    app.exit(failed ? 1 : 0)
  }
})
