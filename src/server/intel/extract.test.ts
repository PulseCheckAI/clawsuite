import { describe, expect, it } from 'vitest'
import { htmlToText, isExtractableUrl } from './extract'

describe('isExtractableUrl', () => {
  it('accepts http(s) only', () => {
    expect(isExtractableUrl('https://a.com/x')).toBe(true)
    expect(isExtractableUrl('http://a.com/x')).toBe(true)
  })
  it('rejects non-http schemes and junk', () => {
    expect(isExtractableUrl('javascript:alert(1)')).toBe(false)
    expect(isExtractableUrl('file:///etc/passwd')).toBe(false)
    expect(isExtractableUrl('data:text/html,x')).toBe(false)
    expect(isExtractableUrl('')).toBe(false)
    expect(isExtractableUrl('not a url')).toBe(false)
  })
})

describe('htmlToText', () => {
  it('strips scripts, styles, tags and collapses whitespace', () => {
    const html =
      '<html><head><style>.a{}</style><script>bad()</script></head>' +
      '<body><h1>Title</h1><p>Hello   world</p></body></html>'
    expect(htmlToText(html)).toBe('Title Hello world')
  })
  it('caps to max length with ellipsis', () => {
    expect(htmlToText('<p>abcdefghij</p>', 5)).toBe('abcd…')
  })
})
