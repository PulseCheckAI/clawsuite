// RSS Cockpit → Postiz auto-post CONFIG endpoint.
// GET  /api/rss/autopost-config  → current config (seenLinks returned as a count)
// PUT  /api/rss/autopost-config  → update config; seeds the dedupe set on enable
//
// SEED-ON-ENABLE: when the poster is turned on (or the feed route changes while
// enabled), we mark every CURRENT feed item as already-seen so enabling does NOT
// blast the existing backlog to your live channels. Only items that appear AFTER
// enabling will be posted.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  readAutopostConfig,
  writeAutopostConfig,
  type RssAutopostConfig,
} from '@/server/rss-autopost-store'

function selfBase(): string {
  const override = process.env.PULSEOS_SELF_URL
  if (override && override.length > 0) return override.replace(/\/+$/, '')
  return `http://127.0.0.1:${process.env.PORT || '3010'}`
}

function clampInt(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : d
  return Math.min(Math.max(n, min), max)
}

// Response view: drop the (potentially large) seenLinks array, expose its size.
function publicView(cfg: RssAutopostConfig) {
  const { seenLinks, ...rest } = cfg
  return { ...rest, seenCount: seenLinks.length }
}

// Fetch current feed item links (for seeding the dedupe set). Best-effort: an
// unreachable feed seeds nothing, which is safe — worst case the first real run
// posts up to maxPerRun items, never the whole backlog.
async function fetchFeedLinks(route: string): Promise<string[]> {
  if (!route) return []
  try {
    const r = await fetch(
      `${selfBase()}/api/rss/feed?route=${encodeURIComponent(route)}&limit=50`,
      { signal: AbortSignal.timeout(25_000) },
    )
    const body = (await r.json().catch(() => ({}))) as {
      ok?: boolean
      items?: Array<{ link?: unknown }>
    }
    if (!r.ok || !body.ok || !Array.isArray(body.items)) return []
    return body.items
      .map((it) => it.link)
      .filter((l): l is string => typeof l === 'string' && l.length > 0)
  } catch {
    return []
  }
}

export const Route = createFileRoute('/api/rss/autopost-config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, config: publicView(readAutopostConfig()) })
      },

      PUT: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const prev = readAutopostConfig()
        const next: RssAutopostConfig = { ...prev }

        if (typeof body.feedRoute === 'string')
          next.feedRoute = body.feedRoute.trim()
        if (Array.isArray(body.feedRoutes)) {
          next.feedRoutes = body.feedRoutes
            .filter(
              (r): r is string => typeof r === 'string' && r.trim().length > 0,
            )
            .map((r) => r.trim())
        }
        if (Array.isArray(body.platforms)) {
          next.platforms = body.platforms.filter(
            (p): p is string => typeof p === 'string' && p.length > 0,
          )
        }
        if (body.intervalMinutes !== undefined) {
          next.intervalMinutes = clampInt(body.intervalMinutes, 30, 5, 1440)
        }
        if (body.maxPerRun !== undefined) {
          next.maxPerRun = clampInt(body.maxPerRun, 5, 1, 25)
        }
        if (
          typeof body.contentTemplate === 'string' &&
          body.contentTemplate.length > 0
        ) {
          next.contentTemplate = body.contentTemplate
        }
        if (typeof body.generateImages === 'boolean')
          next.generateImages = body.generateImages
        if (typeof body.enabled === 'boolean') next.enabled = body.enabled

        // Guard: can't enable without at least one feed + one channel.
        const effectiveFeeds = next.feedRoutes.length
          ? next.feedRoutes
          : next.feedRoute
            ? [next.feedRoute]
            : []
        if (
          next.enabled &&
          (effectiveFeeds.length === 0 || next.platforms.length === 0)
        ) {
          return json(
            {
              ok: false,
              error:
                'Cannot enable: set a feedRoute and at least one channel first.',
            },
            { status: 400 },
          )
        }

        // Seed-on-enable: when turning on, or changing the feed while on, mark
        // all current items seen so the backlog isn't posted.
        const turnedOn = next.enabled && !prev.enabled
        const prevFeeds = prev.feedRoutes.length
          ? prev.feedRoutes
          : prev.feedRoute
            ? [prev.feedRoute]
            : []
        const feedsChangedWhileOn =
          next.enabled &&
          JSON.stringify([...effectiveFeeds].sort()) !==
            JSON.stringify([...prevFeeds].sort())
        if (turnedOn || feedsChangedWhileOn) {
          const linkLists = await Promise.all(
            effectiveFeeds.map((r) => fetchFeedLinks(r)),
          )
          next.seenLinks = linkLists.flat()
          next.lastResult = null
        }

        writeAutopostConfig(next)
        return json({
          ok: true,
          seeded: turnedOn || feedsChangedWhileOn,
          config: publicView(readAutopostConfig()),
        })
      },
    },
  },
})
