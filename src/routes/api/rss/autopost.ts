// RSS Cockpit → Postiz auto-post RUN cycle.
// POST /api/rss/autopost  → runs one cycle now (used by the in-process scheduler
//                            and the "Run now" button in the UI).
//
// Cycle: read config → fetch the configured RSSHub feed → drop items whose link
// is already in the dedupe set → post up to maxPerRun NEW items to the configured
// Postiz channels → record the posted links + result.
//
// Reuse strategy: this calls the EXISTING /api/rss/feed and /api/postiz/post
// routes over loopback rather than duplicating their logic. That keeps the
// load-bearing Postiz LinkedIn-guard + SDK quirks in one place (post.ts). This
// relies on auth being satisfied for loopback — currently CLAWSUITE_PASSWORD is
// unset so isAuthenticated() returns true; if a password is later set, switch
// these to direct server-function imports (TODO) since the scheduler has no cookie.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  patchAutopostConfig,
  readAutopostConfig,
  type RssAutopostResult,
} from '@/server/rss-autopost-store'
import { imageUrlForItem } from '@/server/pollinations'

interface FeedItem {
  title: string
  link: string
}

function selfBase(): string {
  const override = process.env.PULSEOS_SELF_URL
  if (override && override.length > 0) return override.replace(/\/+$/, '')
  return `http://127.0.0.1:${process.env.PORT || '3010'}`
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Run one auto-post cycle. Returns a result summary and persists it. Safe to
 * call repeatedly; dedupe + maxPerRun prevent re-posting and flooding.
 */
export async function runAutopost(
  opts: { force?: boolean } = {},
): Promise<RssAutopostResult> {
  const at = new Date().toISOString()
  const cfg = readAutopostConfig()

  if (!cfg.enabled) return { at, posted: 0, skipped: 0, errors: ['disabled'] }

  // Due-check: when called by the scheduler (not forced), skip if the configured
  // interval hasn't elapsed since lastRunAt. The "Run now" button passes force.
  if (!opts.force && cfg.lastRunAt) {
    const elapsedMin = (Date.now() - new Date(cfg.lastRunAt).getTime()) / 60_000
    if (Number.isFinite(elapsedMin) && elapsedMin < cfg.intervalMinutes) {
      return {
        at,
        posted: 0,
        skipped: 0,
        errors: [
          `not due (${Math.ceil(cfg.intervalMinutes - elapsedMin)}m left)`,
        ],
      }
    }
  }

  // Effective feed list: prefer the multi-feed array, fall back to the legacy
  // single feedRoute so existing configs keep working.
  const feeds = cfg.feedRoutes.length
    ? cfg.feedRoutes
    : cfg.feedRoute
      ? [cfg.feedRoute]
      : []
  if (feeds.length === 0 || cfg.platforms.length === 0) {
    const res: RssAutopostResult = {
      at,
      posted: 0,
      skipped: 0,
      errors: ['not configured (feedRoutes + platforms required)'],
    }
    patchAutopostConfig({ lastRunAt: at, lastResult: res })
    return res
  }

  const base = selfBase()

  // 1) fetch EVERY configured feed; accumulate items. Best-effort per feed —
  //    a single bad feed is recorded in errors but never aborts the whole run.
  const items: FeedItem[] = []
  const feedErrors: string[] = []
  for (const route of feeds) {
    try {
      const r = await fetch(
        `${base}/api/rss/feed?route=${encodeURIComponent(route)}&limit=50`,
        { signal: AbortSignal.timeout(25_000) },
      )
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        items?: FeedItem[]
      }
      if (!r.ok || !body.ok) {
        feedErrors.push(`feed ${route}: ${body.error || `HTTP ${r.status}`}`)
        continue
      }
      if (Array.isArray(body.items)) items.push(...body.items)
    } catch (e) {
      feedErrors.push(`feed ${route} unreachable: ${errMsg(e)}`)
    }
  }
  if (items.length === 0) {
    const res: RssAutopostResult = {
      at,
      posted: 0,
      skipped: 0,
      errors: feedErrors.length ? feedErrors : ['no items from any feed'],
    }
    patchAutopostConfig({ lastRunAt: at, lastResult: res })
    return res
  }

  // 2) dedupe → NEW items only, across all feeds (backlog set + within-run set
  //    so the same link appearing in two feeds is posted once).
  const seen = new Set(cfg.seenLinks)
  const seenThisRun = new Set<string>()
  const fresh: FeedItem[] = []
  for (const it of items) {
    if (!it.link || seen.has(it.link) || seenThisRun.has(it.link)) continue
    seenThisRun.add(it.link)
    fresh.push(it)
  }
  const toPost = fresh.slice(0, cfg.maxPerRun) // safety cap; remainder drains next run

  // 3) post each new item
  let posted = 0
  const errors: string[] = [...feedErrors]
  const newlySeen: string[] = []
  for (const it of toPost) {
    const content = cfg.contentTemplate
      .replace(/\{title\}/g, it.title || '')
      .replace(/\{link\}/g, it.link || '')
      .trim()
    // Free image-per-post: a stable Pollinations Flux URL that Postiz fetches
    // directly. No key, no job polling — the URL IS the image. Off by default.
    const mediaUrls = cfg.generateImages
      ? [imageUrlForItem({ title: it.title })]
      : []
    try {
      const r = await fetch(`${base}/api/postiz/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, platforms: cfg.platforms, mediaUrls }),
        // Postiz fetches+generates the image on first hit, so allow more time
        // when image generation is on.
        signal: AbortSignal.timeout(cfg.generateImages ? 60_000 : 30_000),
      })
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (r.ok && body.ok !== false) {
        posted += 1
        newlySeen.push(it.link) // only mark posted-OK links as seen
      } else {
        errors.push(
          `post failed [${it.link}]: ${body.error || `HTTP ${r.status}`}`,
        )
      }
    } catch (e) {
      errors.push(`post error [${it.link}]: ${errMsg(e)}`)
    }
  }

  const result: RssAutopostResult = {
    at,
    posted,
    skipped: Math.max(items.length - posted, 0),
    errors,
  }
  patchAutopostConfig({
    seenLinks: [...cfg.seenLinks, ...newlySeen],
    lastRunAt: at,
    lastResult: result,
  })
  return result
}

export const Route = createFileRoute('/api/rss/autopost')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const force = new URL(request.url).searchParams.get('force') === '1'
        const result = await runAutopost({ force })
        return json({ ok: true, result })
      },
    },
  },
})
