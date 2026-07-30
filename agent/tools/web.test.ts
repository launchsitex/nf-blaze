import { describe, expect, it } from 'vitest'
import {
  decodeHtmlEntities,
  htmlToText,
  parseDuckDuckGoHtml,
  resolveDdgUrl
} from './web'

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toBe(
      'a & b <c> "d" \'e\''
    )
    expect(decodeHtmlEntities('&#x05E9;&#x05DC;&#x05D5;&#x05DD;')).toBe('שלום')
    expect(decodeHtmlEntities('one&nbsp;two')).toBe('one two')
  })
})

describe('htmlToText', () => {
  it('strips scripts, styles and tags but keeps text structure', () => {
    const html = [
      '<html><head><style>.x{color:red}</style><script>alert(1)</script></head>',
      '<body><h1>כותרת</h1><p>פסקה ראשונה</p><div>פסקה שנייה</div></body></html>'
    ].join('')
    const text = htmlToText(html)
    expect(text).toContain('כותרת')
    expect(text).toContain('פסקה ראשונה')
    expect(text).toContain('פסקה שנייה')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
  })

  it('keeps absolute link targets for follow-up fetches', () => {
    const html = '<p>ראו <a href="https://example.com/docs">התיעוד</a> כאן</p>'
    expect(htmlToText(html)).toContain('התיעוד (https://example.com/docs)')
  })

  it('drops relative link hrefs but keeps the label', () => {
    const html = '<a href="/about">אודות</a>'
    const text = htmlToText(html)
    expect(text).toContain('אודות')
    expect(text).not.toContain('/about')
  })
})

describe('resolveDdgUrl', () => {
  it('decodes uddg redirect links', () => {
    const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc'
    expect(resolveDdgUrl(href)).toBe('https://example.com/page')
  })

  it('passes through direct links', () => {
    expect(resolveDdgUrl('https://example.com')).toBe('https://example.com')
    expect(resolveDdgUrl('//cdn.example.com/x')).toBe('https://cdn.example.com/x')
  })
})

describe('parseDuckDuckGoHtml', () => {
  const page = `
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite-one.com%2F">Site <b>One</b> Title</a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite-one.com%2F">First snippet text</a>
    </div>
    <div class="result">
      <a rel="nofollow" class="result__a" href="https://site-two.org/page">Site Two</a>
      <a class="result__snippet" href="https://site-two.org/page">Second snippet</a>
    </div>
  `

  it('extracts titles, resolved urls and snippets', () => {
    const results = parseDuckDuckGoHtml(page)
    expect(results.length).toBe(2)
    expect(results[0]).toEqual({
      title: 'Site One Title',
      url: 'https://site-one.com/',
      snippet: 'First snippet text'
    })
    expect(results[1]!.url).toBe('https://site-two.org/page')
    expect(results[1]!.snippet).toBe('Second snippet')
  })

  it('returns empty array for a page without results', () => {
    expect(parseDuckDuckGoHtml('<html><body>no results here</body></html>')).toEqual([])
  })
})
