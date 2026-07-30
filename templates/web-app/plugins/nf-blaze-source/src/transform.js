import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import _generate from '@babel/generator'

const traverse = typeof _traverse === 'function' ? _traverse : _traverse.default
const generate = typeof _generate === 'function' ? _generate : _generate.default

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
 * Add data-nf-file / data-nf-line / data-nf-component to JSX host elements.
 * @param {string} code
 * @param {string} relFile path relative to project root (posix)
 */
export function transformJsxSource(code, relFile) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'classProperties', 'decorators-legacy']
  })

  traverse(ast, {
    JSXOpeningElement(path) {
      const opening = path.node
      if (opening.selfClosing === undefined) return
      if (isFragmentName(opening)) return
      if (hasAttr(opening, 'data-nf-file')) return

      // Skip lowercase? No — we want div/button/etc. tagged too.
      const line = opening.loc?.start.line ?? 0
      const comp = componentNameFromNode(opening)

      opening.attributes.push(
        t.jsxAttribute(t.jsxIdentifier('data-nf-file'), t.stringLiteral(relFile)),
        t.jsxAttribute(t.jsxIdentifier('data-nf-line'), t.stringLiteral(String(line))),
        t.jsxAttribute(t.jsxIdentifier('data-nf-component'), t.stringLiteral(comp))
      )
    }
  })

  const out = generate(
    ast,
    { retainLines: true, compact: false, jsescOption: { minimal: true } },
    code
  )
  return { code: out.code, map: out.map }
}
