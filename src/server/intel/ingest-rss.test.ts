import { describe, expect, it } from 'vitest'
import { dedupeHash, mapFeedItems } from './ingest-rss'
import type { RssItem } from '@/routes/api/rss/feed'

describe('dedupeHash', () => {
  it('is stable and source-scoped', () => {
    const a = dedupeHash('src-1', 'https://x.com/a')
    expect(a).toBe(dedupeHash('src-1', 'https://x.com/a'))
    expect(a).not.toBe(dedupeHash('src-2', 'https://x.com/a'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('mapFeedItems', () => {
  it('maps RssItems to NewIntelItem rows, dropping items without a link', () => {
    const items: RssItem[] = [
      {
        title: 'A',
        link: 'https://x.com/a',
        description: 'snip',
        pubDate: 'Tue, 20 May 2026 10:00:00 GMT',
      },
      { title: 'No link', link: '', description: 'x', pubDate: null },
    ]
    const rows = mapFeedItems('src-1', items)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source_id: 'src-1',
      title: 'A',
      link: 'https://x.com/a',
      raw_snippet: 'snip',
      dedupe_hash: dedupeHash('src-1', 'https://x.com/a'),
    })
    expect(rows[0].pub_date).toBe(
      new Date('Tue, 20 May 2026 10:00:00 GMT').toISOString(),
    )
  })
})
