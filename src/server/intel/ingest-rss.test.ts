import { afterEach, describe, expect, it, vi } from 'vitest'

// insertItems is the DB write that previously threw and crashed the dev server.
vi.mock('./items-store', () => ({
  insertItems: vi.fn(async () => {
    throw new Error('fetch failed')
  }),
}))

import { dedupeHash, ingestSource, mapFeedItems } from './ingest-rss'
import type { RssItem } from '@/routes/api/rss/feed'
import type { IntelSource } from './types'

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

describe('ingestSource resilience', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves with an error result (never throws) when the DB write fails', async () => {
    const xml =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>' +
      '<item><title>A</title><link>https://x.com/a</link></item></channel></rss>'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => xml,
      })),
    )
    const source = {
      id: 'src-1',
      kind: 'rss',
      route_or_url: 'https://feed.example.com/rss',
    } as unknown as IntelSource

    // Must not reject — a Supabase blip becomes a per-source error, not a crash.
    const res = await ingestSource(source)
    expect(res.sourceId).toBe('src-1')
    expect(res.inserted).toBe(0)
    expect(res.error).toBeTruthy()
  })
})
