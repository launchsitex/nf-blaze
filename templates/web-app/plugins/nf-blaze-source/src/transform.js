/**
 * Adds data-nf-file / data-nf-line / data-nf-component to JSX host elements,
 * so the element picker can map a clicked element back to its source location.
 *
 * @babel/* is OPTIONAL and loaded lazily: projects without it (e.g. a plain
 * Vite project) still get the element picker via the injected client script —
 * they just don't get file/line tagging. This guarantees injecting the plugin
 * into a foreign project never breaks its dev server.
 */

/** @type {{parse:Function, traverse:Function, t:any, generate:Function} | null | undefined} */
let babel
/** types helper, set once babel is loaded — used by the helpers below */
let t

async function loadBabel() {
  if (babel !== undefined) return babel
  try {
    const [parser, traverseMod, types, generateMod] = await Promise.all([
      import('@babel/parser'),
      import('@babel/traverse'),
      import('@babel/types'),
      import('@babel/generator')
    ])
    const traverse =
      typeof traverseMod.default === 'function'
        ? traverseMod.default
        : traverseMod.default?.default || traverseMod.traverse
    const generate =
      typeof generateMod.default === 'function'
        ? generateMod.default
        : generateMod.default?.default || generateMod.generate
    babel = { parse: parser.parse, traverse, t: types, generate }
  } catch {
    babel = null // אין babel — מדלגים על תיוג JSX; הבורר עדיין עובד
  }
  return babel
}

function componentNameFromNode(opening) {
  const name = opening.name
  if (t.isJSXIdentifier(name)) return name.name
  if (t.isJSXMemberExpression(name)) {
    const parts = []
    let cur = name
    while (t.isJSXMemberExpression(cur)) {
      parts.unshift(cur.property.name)
      cur = cur.object
    }
    if (t.isJSXIdentifier(cur)) parts.unshift(cur.name)
    return parts.join('.')
  }
  return 'Unknown'
}

function isFragmentName(opening) {
  const n = componentNameFromNode(opening)
  return n === 'Fragment' || n === 'React.Fragment'
}

function hasAttr(opening, attrName) {
  return opening.attributes.some(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === attrName
  )
}

/**
 * @param {string} code
 * @param {string} relFile path relative to project root (posix)
 * @returns {Promise<{code:string, map:any}|null>} null when babel is unavailable
 */
export async function transformJsxSource(code, relFile) {
  const b = await loadBabel()
  if (!b) return null
  t = b.t

  const ast = b.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'classProperties', 'decorators-legacy']
  })

  b.traverse(ast, {
    JSXOpeningElement(path) {
      const opening = path.node
      if (opening.selfClosing === undefined) return
      if (isFragmentName(opening)) return
      if (hasAttr(opening, 'data-nf-file')) return

      const line = opening.loc?.start.line ?? 0
      const comp = componentNameFromNode(opening)

      opening.attributes.push(
        t.jsxAttribute(t.jsxIdentifier('data-nf-file'), t.stringLiteral(relFile)),
        t.jsxAttribute(t.jsxIdentifier('data-nf-line'), t.stringLiteral(String(line))),
        t.jsxAttribute(t.jsxIdentifier('data-nf-component'), t.stringLiteral(comp))
      )
    }
  })

  const out = b.generate(
    ast,
    { retainLines: true, compact: false, jsescOption: { minimal: true } },
    code
  )
  return { code: out.code, map: out.map }
}
