// Postiz module — list scheduled posts.
// GET /api/postiz/scheduled
//
// Wraps Postiz GET /public/v1/posts (Postiz public API). LinkedIn-bound posts
// are filtered out before reaching the UI.
//
// Postiz API contract — assumptions (TODO: verify against a live instance):
//   Path:    GET /public/v1/posts?display=schedule
//   Returns: { posts: Array<{
//                id: string,
//                publishDate: string ISO8601,
//                state: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT',
//                integration: { id, identifier, name, picture? },
//                content?: string,
//                image?: Array<{ path: string }>,
//                error?: string
//              }> }
//
// Called from: src/routes/postiz.tsx (Scheduled tab).

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getPostizClient,
  isForbiddenPlatform,
  normalizePostizSdkResult,
  POSTIZ_NOT_CONFIGURED,
  postizSdkError,
} from './_client'

export interface ScheduledPost {
  id: string
  publishDate: string
  state: string
  platform: {
    id: string | null
    identifier: string
    name: string
    picture: string | null
  }
  content: string
  mediaUrls: string[]
  error: string | null
}

interface RawPost {
  id?: unknown
  publishDate?: unknown
  state?: unknown
  integration?: unknown
  content?: unknown
  image?: unknown
  error?: unknown
}

function normalizePost(raw: RawPost): ScheduledPost | null {
  const id = typeof raw.id === 'string' ? raw.id : null
  if (!id) return null
  // Regression guard: the UI tab is "Scheduled" and the legacy
  // `?display=schedule` query param is no longer available on `postList()`
  // (SDK's GetPostsDto has only {startDate,endDate,customer} — no state
  // field). Without this filter, postList() returns posts in ANY state
  // matching the date window (PUBLISHED, ERROR, DRAFT, QUEUE), and the
  // Scheduled tab would show all of them. Filter explicitly to QUEUE
  // (case-insensitive — Postiz emits 'QUEUE' but be defensive).
  const stateStr = typeof raw.state === 'string' ? raw.state : ''
  if (stateStr.toUpperCase() !== 'QUEUE') return null
  const integration =
    raw.integration && typeof raw.integration === 'object'
      ? (raw.integration as Record<string, unknown>)
      : null
  const identifier =
    integration && typeof integration.identifier === 'string'
      ? integration.identifier
      : 'unknown'
  if (isForbiddenPlatform(identifier)) return null

  let mediaUrls: string[] = []
  if (Array.isArray(raw.image)) {
    mediaUrls = raw.image
      .map((m) => {
        if (!m || typeof m !== 'object') return null
        const path = (m as { path?: unknown }).path
        return typeof path === 'string' ? path : null
      })
      .filter((s): s is string => s !== null)
  }

  return {
    id,
    publishDate:
      typeof raw.publishDate === 'string'
        ? raw.publishDate
        : new Date(0).toISOString(),
    state: typeof raw.state === 'string' ? raw.state : 'UNKNOWN',
    platform: {
      id:
        integration && typeof integration.id === 'string'
          ? integration.id
          : null,
      identifier,
      name:
        integration && typeof integration.name === 'string'
          ? integration.name
          : identifier,
      picture:
        integration && typeof integration.picture === 'string'
          ? integration.picture
          : null,
    },
    content: typeof raw.content === 'string' ? raw.content : '',
    mediaUrls,
    error: typeof raw.error === 'string' ? raw.error : null,
  }
}

export const Route = createFileRoute('/api/postiz/scheduled')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Migrated from raw fetch (`callPostiz`) to `@postiz/node` SDK's
        // `postList(filters)`. The SDK serializes `filters` into query
        // params on `GET /public/v1/posts` — note the legacy query string
        // `?display=schedule` is no longer used because the SDK's
        // `GetPostsDto` doesn't model a `display` field. Instead we pass
        // a wide date window (now → +90d) which Postiz interprets as the
        // active schedule horizon; the previous handler relied on Postiz's
        // default-window behavior, this codifies a sensible one explicitly.
        // `customer` is a string (empty = all customers, the typical
        // single-tenant case for self-host).
        const client = getPostizClient()
        if (!client) {
          return json(
            { ...POSTIZ_NOT_CONFIGURED, posts: [] },
            { status: POSTIZ_NOT_CONFIGURED.status },
          )
        }

        const now = Date.now()
        const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000
        const filters = {
          startDate: new Date(now).toISOString(),
          endDate: new Date(now + ninetyDaysMs).toISOString(),
          customer: '',
        }

        let result
        try {
          result = normalizePostizSdkResult<unknown>(
            await client.postList(filters),
          )
        } catch (err) {
          result = postizSdkError(err)
        }

        if (!result.ok) {
          return json(
            {
              ok: false,
              error: result.error,
              hint: result.hint,
              posts: [],
            },
            { status: result.status },
          )
        }

        let rawList: unknown[] = []
        if (Array.isArray(result.data)) {
          rawList = result.data
        } else if (
          result.data !== null &&
          typeof result.data === 'object' &&
          Array.isArray((result.data as { posts?: unknown }).posts)
        ) {
          rawList = (result.data as { posts: unknown[] }).posts
        }

        const posts: ScheduledPost[] = []
        for (const item of rawList) {
          if (!item || typeof item !== 'object') continue
          const normalized = normalizePost(item as RawPost)
          if (normalized) posts.push(normalized)
        }
        // Sort soonest-first
        posts.sort(
          (a, b) =>
            new Date(a.publishDate).getTime() -
            new Date(b.publishDate).getTime(),
        )

        return json({ ok: true, posts })
      },
    },
  },
})
