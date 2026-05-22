// Fetch + map feed items into intel.items rows. Pure helpers (dedupeHash,
// mapFeedItems) are unit-tested; ingestSource does network + DB.

import { createHash } from 'node:crypto'
import {
  parseFeed,
  rsshubBase,
  sanitizeRoute,
  type RssItem,
} from '@/routes/api/rss/feed'
import type { IntelSource, NewIntelItem } from './types'
import { insertItems } from './items-store'

const MAX_FEED_BYTES = 600_000
const FETCH_TIMEOUT_MS = 20_000

export function dedupeHash(sourceId: string, link: string): string {
  return createHash('sha256').update(`${sourceId}\n${link}`).digest('hex')
}

function toIso(pubDate: string | null): string | null {
  if (!pubDate) return null
  const t = Date.parse(pubDate)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function mapFeedItems(
  sourceId: string,
  items: RssItem[],
): NewIntelItem[] {
  return items
    .filter((it) => it.link)
    .map((it) => ({
      source_id: sourceId,
      title: it.title || '(untitled)',
      link: it.link,
      author: null,
      pub_date: toIso(it.pubDate),
      raw_snippet: it.description || '',
      dedupe_hash: dedupeHash(sourceId, it.link),
    }))
}

// Resolve a source to a fetchable URL. rsshub → internal RSSHub base + route;
// rss → the operator-entered full URL (validated http(s) at create time).
function resolveUrl(source: IntelSource): string | null {
  if (source.kind === 'rsshub') {
    const route = sanitizeRoute(source.route_or_url)
    return route ? `${rsshubBase()}${route}` : null
  }
  if (source.kind === 'rss') {
    try {
      const u = new URL(source.route_or_url)
      return u.protocol === 'http:' || u.protocol === 'https:'
        ? source.route_or_url
        : null
    } catch {
      return null
    }
  }
  return null // email handled by ingest-email.ts (Phase 2)
}

export interface IngestResult {
  sourceId: string
  fetched: number
  inserted: number
  error?: string
}

export async function ingestSource(source: IntelSource): Promise<IngestResult> {
  const target = resolveUrl(source)
  if (!target) {
    return {
      sourceId: source.id,
      fetched: 0,
      inserted: 0,
      error: 'unresolvable source',
    }
  }
  let xml = ''
  try {
    const res = await fetch(target, {
      headers: {
        Accept:
          'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      return {
        sourceId: source.id,
        fetched: 0,
        inserted: 0,
        error: `HTTP ${res.status}`,
      }
    }
    xml = await res.text()
  } catch (e) {
    return {
      sourceId: source.id,
      fetched: 0,
      inserted: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
  if (xml.length > MAX_FEED_BYTES) {
    return {
      sourceId: source.id,
      fetched: 0,
      inserted: 0,
      error: 'feed too large',
    }
  }
  const { items } = parseFeed(xml, 50)
  const rows = mapFeedItems(source.id, items)
  const inserted = await insertItems(rows)
  return { sourceId: source.id, fetched: items.length, inserted }
}
