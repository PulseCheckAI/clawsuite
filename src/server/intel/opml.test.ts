import { describe, expect, it } from 'vitest'
import { parseOpml, type OpmlFeed } from './opml'

describe('parseOpml', () => {
  it('extracts feeds with folder from nested outlines', () => {
    const xml = `<?xml version="1.0"?>
<opml version="1.0"><body>
  <outline text="Tech" title="Tech">
    <outline type="rss" text="Hacker News" title="Hacker News"
             xmlUrl="https://hnrss.org/frontpage" htmlUrl="https://news.ycombinator.com"/>
  </outline>
  <outline type="rss" text="Top Level" title="Top Level"
           xmlUrl="https://example.com/feed.xml"/>
</body></opml>`
    const feeds: OpmlFeed[] = parseOpml(xml)
    expect(feeds).toEqual([
      {
        label: 'Hacker News',
        url: 'https://hnrss.org/frontpage',
        folder: 'Tech',
      },
      { label: 'Top Level', url: 'https://example.com/feed.xml', folder: null },
    ])
  })

  it('ignores outlines without xmlUrl and dedupes by url', () => {
    const xml = `<opml><body>
      <outline text="No Feed Here"/>
      <outline type="rss" text="A" xmlUrl="https://a.com/feed"/>
      <outline type="rss" text="A dup" xmlUrl="https://a.com/feed"/>
    </body></opml>`
    expect(parseOpml(xml)).toEqual([
      { label: 'A', url: 'https://a.com/feed', folder: null },
    ])
  })

  it('returns [] for empty or malformed input', () => {
    expect(parseOpml('')).toEqual([])
    expect(parseOpml('<nonsense/>')).toEqual([])
  })
})
