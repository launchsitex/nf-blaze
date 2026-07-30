import path from 'node:path'
import { transformJsxSource } from './transform.js'
import { SELECT_CLIENT_SCRIPT } from './client.js'

/**
 * @param {{ root?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function nfSourcePlugin(options = {}) {
  let root = options.root || process.cwd()
  let enabled = false

  return {
    name: 'nf-blaze-source',
    enforce: 'pre',
    apply: 'serve', // development only — never in production build
    configResolved(config) {
      root = config.root || root
      enabled = config.command === 'serve'
    },
    transform(code, id) {
      if (!enabled) return null
      if (id.includes('node_modules')) return null
      const clean = id.split('?')[0]
      if (!/\.[jt]sx$/.test(clean)) return null

      let rel = path.relative(root, clean).split(path.sep).join('/')
      if (rel.startsWith('..')) rel = path.basename(clean)

      try {
        return transformJsxSource(code, rel)
      } catch (err) {
        this.warn(
          `[nf-blaze-source] transform failed for ${rel}: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
        return null
      }
    },
    transformIndexHtml(html) {
      if (!enabled) return html
      if (html.includes('data-nf-blaze-select-client')) return html
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { type: 'module', 'data-nf-blaze-select-client': '1' },
            children: SELECT_CLIENT_SCRIPT,
            injectTo: 'body'
          }
        ]
      }
    }
  }
}

export default nfSourcePlugin
