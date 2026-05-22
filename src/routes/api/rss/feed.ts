// RSS module — fetch + parse an RSSHub feed for the curation cockpit.
// GET /api/rss/feed?route=/hackernews&limit=20
//
// Called from: src/screens/rss/rss-screen.tsx via fetch('/api/rss/feed?...').
//
// SSRF-safe by construction: this never fetches an arbitrary URL. It only ever
// hits the configured RSSHub base (default http://localhost:1200 — PulseOS runs
// on the host so it reaches the RSSHub container's published port directly) and
// appends a caller-supplied *path* after validating it starts with '/' and has
// no scheme or '..' traversal. The path is what RSSHub calls a "route"
// (e.g. /hackernews, /reddit/r/restaurants, /github/trending/daily/any).

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const DEFAULT_RSSHUB = 'http://localhost:1200'

export interface RssItem {
  title: string
  link: string
  description: string // plain-text snippet (HTML stripped, capped)
  pubDate: string | null
}

export function rsshubBase(): string {
  const raw = process.env.RSSHUB_URL
  const base = raw && raw.length > 0 ? raw : DEFAULT_RSSHUB
  return base.replace(/\/+$/, '')
}

// Accept only a path-style RSSHub route. Reject anything that smells like an
// absolute URL, a protocol, or directory traversal — this is the SSRF guard.
export function sanitizeRoute(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let r = raw.trim()
  if (!r) return null
  if (/^[a-z]+:\/\//i.test(r)) return null // no http://, file://, etc.
  if (r.includes('..')) return null
  if (!r.startsWith('/')) r = '/' + r
  if (r.startsWith('//')) return null // no protocol-relative //host
  if (/\s/.test(r)) return null
  return r
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function pickTag(block: string, tag: string): string {
  // Defensive: `tag` is always a source literal today, but guard against any
  // future untrusted caller turning this into a regex-injection vector.
  if (!/^[\w:]+$/.test(tag)) return ''
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? decodeEntities(m[1]).trim() : ''
}

// Only surface http(s) links — strips javascript:/data:/etc. URIs that would
// otherwise land in an <a href> in the UI.
function safeLink(raw: string): string {
  return /^https?:\/\//i.test(raw.trim()) ? raw.trim() : ''
}

function toSnippet(html: string, max = 280): string {
  const text = decodeEntities(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// Minimal RSS 2.0 / Atom parser — no new dependency. Handles the shapes RSSHub
// emits (RSS <item> with <link>, and Atom <entry> with <link href="">).
export function parseFeed(
  xml: string,
  limit: number,
): { title: string; items: RssItem[] } {
  const feedTitle = pickTag(xml, 'title') || 'Feed'
  const items: RssItem[] = []

  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []
  for (const block of itemBlocks) {
    items.push({
      title: pickTag(block, 'title') || '(untitled)',
      link: safeLink(pickTag(block, 'link')),
      description: toSnippet(
        pickTag(block, 'description') || pickTag(block, 'content:encoded'),
      ),
      pubDate: pickTag(block, 'pubDate') || null,
    })
    if (items.length >= limit) break
  }

  if (items.length === 0) {
    // Atom fallback
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
    for (const block of entries) {
      const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i)
      items.push({
        title: pickTag(block, 'title') || '(untitled)',
        link: hrefMatch ? safeLink(decodeEntities(hrefMatch[1])) : '',
        description: toSnippet(
          pickTag(block, 'summary') || pickTag(block, 'content'),
        ),
        pubDate:
          pickTag(block, 'updated') || pickTag(block, 'published') || null,
      })
      if (items.length >= limit) break
    }
  }

  return { title: feedTitle, items }
}

export const Route = createFileRoute('/api/rss/feed')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const route = sanitizeRoute(url.searchParams.get('route'))
        if (!route) {
          return json(
            {
              ok: false,
              error:
                'Invalid route. Pass an RSSHub path like /hackernews or /reddit/r/restaurants (no full URLs).',
            },
            { status: 400 },
          )
        }
        const limitRaw = Number(url.searchParams.get('limit') ?? '20')
        const limit = Number.isFinite(limitRaw)
          ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
          : 20

        const target = `${rsshubBase()}${route}`
        let res: Response
        try {
          res = await fetch(target, {
            headers: {
              Accept:
                'application/rss+xml, application/atom+xml, application/xml, text/xml',
            },
            signal: AbortSignal.timeout(20_000),
          })
        } catch {
          return json(
            {
              ok: false,
              error: `RSSHub unreachable at ${rsshubBase()}. Is the RSSHub container running on :1200?`,
              items: [],
            },
            { status: 502 },
          )
        }

        if (!res.ok) {
          return json(
            {
              ok: false,
              error: `RSSHub returned ${res.status} for ${route}. Check the route exists (see docs.rsshub.app).`,
              items: [],
            },
            { status: res.status === 404 ? 404 : 502 },
          )
        }

        const xml = await res.text().catch(() => '')
        // Hard size cap BEFORE the regex parser runs. V8 regexes aren't
        // interruptible, so the 20s fetch timeout can't rescue us from
        // catastrophic backtracking on a huge malformed (e.g. never-closed)
        // feed body from a third-party origin. Real RSS feeds are far smaller.
        if (xml.length > 600_000) {
          return json(
            {
              ok: false,
              error: 'Feed too large to parse safely (>600KB).',
              items: [],
            },
            { status: 502 },
          )
        }
        const { title, items } = parseFeed(xml, limit)
        return json({
          ok: true,
          feedTitle: title,
          route,
          count: items.length,
          items,
        })
      },
    },
  },
})
