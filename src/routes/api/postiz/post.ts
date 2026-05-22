// Postiz module — publish or schedule a multi-platform post.
// POST /api/postiz/post
//
// Body shape (from the composer):
//   {
//     content: string,                 // required, post body
//     platforms: string[],             // required, ≥1 account id OR identifier
//     mediaUrls?: string[],            // optional, URLs of pre-uploaded media
//     scheduleAt?: string,             // optional ISO8601 — omit for "post now"
//   }
//
// LinkedIn is explicitly rejected — if any account in the payload resolves
// to a LinkedIn identifier, the route returns 400. The LinkedIn surface is
// owned by the dedicated LinkedIn module; Postiz must never duplicate-post
// there. NOTE: the composer typically sends account UUIDs, NOT platform
// identifier strings, so the guard fetches the integrations list and maps
// id → identifier before the prefix check. Skipping that mapping (i.e.
// running isForbiddenPlatform() on raw UUIDs) is a silent no-op — UUIDs
// never start with 'linkedin'.
//
// Failure envelope (consistent with other postiz/* routes):
//   { ok: false, error: string, hint?: string, posts?: never[] }
//
// Postiz API contract — assumptions (TODO: verify against a live instance):
//   Path:    POST /public/v1/posts
//   Auth:    Authorization: <POSTIZ_API_KEY>
//   Body:    {
//              type: 'draft' | 'schedule' | 'now',
//              date: string ISO8601,
//              posts: Array<{ integration: { id }, value: Array<{ content, image? }> }>
//            }
//   On a fresh Postiz instance the exact shape can drift between minor
//   versions — see the GitHub README "Public API" section for the latest.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { requireJsonContentType } from '@/server/rate-limit'
import {
  getPostizClient,
  isForbiddenPlatform,
  normalizePostizSdkResult,
  POSTIZ_NOT_CONFIGURED,
  postizSdkError,
} from './_client'

interface PostBody {
  content?: unknown
  platforms?: unknown
  mediaUrls?: unknown
  scheduleAt?: unknown
}

function isStringArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0)
  )
}

export const Route = createFileRoute('/api/postiz/post')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ctErr = requireJsonContentType(request)
        if (ctErr) return ctErr

        let body: PostBody
        try {
          body = (await request.json()) as PostBody
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const content =
          typeof body.content === 'string' ? body.content.trim() : ''
        if (!content) {
          return json(
            { ok: false, error: 'content is required' },
            { status: 400 },
          )
        }

        if (!isStringArray(body.platforms) || body.platforms.length === 0) {
          return json(
            { ok: false, error: 'platforms must be a non-empty string array' },
            { status: 400 },
          )
        }

        // Hard-reject LinkedIn. This is the load-bearing safety check that
        // keeps the Postiz pipeline from double-posting on top of the
        // dedicated LinkedIn module. The composer sends account UUIDs (not
        // platform identifier strings), so we MUST resolve each id to its
        // identifier before the prefix check — otherwise the guard is a
        // no-op (UUIDs never start with 'linkedin'). We also keep the raw
        // identifier check as a defense-in-depth pass in case the composer
        // is ever changed to send identifiers directly.
        const directHit = body.platforms.find((p) => isForbiddenPlatform(p))
        if (directHit) {
          return json(
            {
              ok: false,
              error:
                'LinkedIn is not supported by this module — use the dedicated LinkedIn surface to post there.',
              forbidden: directHit,
            },
            { status: 400 },
          )
        }

        // Migrated from raw fetch to `@postiz/node` SDK. We build one client
        // and reuse it for both the integration lookup and the post call so
        // auth resolution happens once per request.
        const client = getPostizClient()
        if (!client) {
          return json(
            { ...POSTIZ_NOT_CONFIGURED },
            { status: POSTIZ_NOT_CONFIGURED.status },
          )
        }

        // Fetch the integrations list once and map id → identifier so we can
        // catch LinkedIn entries that arrive as UUIDs. If the integrations
        // call fails we surface the failure (rather than silently allowing
        // the post through) — this guard is load-bearing.
        let integrations
        try {
          integrations = normalizePostizSdkResult<unknown>(
            await client.integrations(),
          )
        } catch (err) {
          integrations = postizSdkError(err)
        }
        if (!integrations.ok) {
          return json(
            {
              ok: false,
              error: `Could not verify accounts against Postiz before posting: ${integrations.error}`,
              hint: integrations.hint,
            },
            { status: integrations.status },
          )
        }
        // Normalize the integrations payload — Postiz may return an array
        // directly or wrap it in `{ integrations: [...] }`.
        let integrationList: unknown[] = []
        if (Array.isArray(integrations.data)) {
          integrationList = integrations.data
        } else if (
          integrations.data !== null &&
          typeof integrations.data === 'object' &&
          Array.isArray(
            (integrations.data as { integrations?: unknown }).integrations,
          )
        ) {
          integrationList = (integrations.data as { integrations: unknown[] })
            .integrations
        }
        const idToIdentifier = new Map<string, string>()
        for (const item of integrationList) {
          if (!item || typeof item !== 'object') continue
          const rec = item as { id?: unknown; identifier?: unknown }
          if (
            typeof rec.id === 'string' &&
            typeof rec.identifier === 'string'
          ) {
            idToIdentifier.set(rec.id, rec.identifier)
          }
        }
        const resolvedHit = body.platforms.find((p) => {
          const identifier = idToIdentifier.get(p)
          return (
            typeof identifier === 'string' && isForbiddenPlatform(identifier)
          )
        })
        if (resolvedHit) {
          return json(
            {
              ok: false,
              error:
                'LinkedIn is not supported by this module — use the dedicated LinkedIn surface to post there.',
              forbidden: idToIdentifier.get(resolvedHit) ?? resolvedHit,
            },
            { status: 400 },
          )
        }

        const mediaUrls = isStringArray(body.mediaUrls) ? body.mediaUrls : []

        let scheduleAt: string | null = null
        if (typeof body.scheduleAt === 'string' && body.scheduleAt.length > 0) {
          const parsed = Date.parse(body.scheduleAt)
          if (!Number.isFinite(parsed)) {
            return json(
              {
                ok: false,
                error: 'scheduleAt must be a valid ISO8601 timestamp',
              },
              { status: 400 },
            )
          }
          scheduleAt = new Date(parsed).toISOString()
        }

        // Build the Postiz payload. Each platform identifier from the
        // composer maps to one "post" entry. We send `integration.id` if the
        // value looks like a UUID, otherwise fall back to `integration.identifier`
        // — Postiz accepts both depending on version.
        // Decide id-vs-identifier using the REAL integrations map, not a regex.
        // This Postiz build issues cuid ids (e.g. "cmpel…") that contain
        // non-hex letters, so the old UUID/hex regex misclassified them as
        // identifiers and Postiz rejected the post with "All posts must have an
        // integration id". If the value is a known integration id, send {id};
        // otherwise treat it as a platform identifier string.
        const posts = body.platforms.map((p) => ({
          integration: idToIdentifier.has(p) ? { id: p } : { identifier: p },
          value: [
            {
              content,
              // Postiz's public posts DTO requires `image` to ALWAYS be an
              // array — it 400s with "posts.0.value.0.image must be an array"
              // if the field is omitted. Send [] for text-only posts.
              image: mediaUrls.map((url) => ({ path: url })),
            },
          ],
        }))

        // SDK `CreatePostDto` declares `type`, `shortLink`, `date`, `tags`,
        // and `posts` as required fields. The legacy payload omitted
        // `shortLink` and `tags` — Postiz tolerated that, but the SDK's
        // TypeScript shape doesn't. We default to safe values (no short-link
        // rewriting, no tags) so behavior is unchanged versus the raw-fetch
        // path. Surplus fields server-side are ignored as before.
        const payload = {
          type: (scheduleAt ? 'schedule' : 'now') as 'schedule' | 'now',
          shortLink: false,
          date: scheduleAt ?? new Date().toISOString(),
          tags: [],
          posts,
        }

        // Posts may take 10–30s when Postiz also has to re-upload media to
        // each network. Restore legacy `callPostiz` parity by capping the
        // upstream wait at 30s — the SDK does not expose a timeout knob
        // (no AbortSignal option on client.post), so we race the SDK call
        // against a manual setTimeout. Without this, media-heavy posts can
        // hang a server thread indefinitely if Postiz never responds.
        const POSTIZ_POST_TIMEOUT_MS = 30_000
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        let result
        try {
          // Cast: the SDK declares strict provider-extension settings shapes
          // in `CreatePostDto.posts[].settings`, but Postiz's server treats
          // settings as optional and will ignore extras. Our payload omits
          // them entirely. Casting through `unknown` keeps the wire format
          // identical to the prior `callPostiz` path while satisfying the
          // SDK's stricter compile-time shape.
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(
                new Error(
                  `Postiz post creation timed out after ${POSTIZ_POST_TIMEOUT_MS / 1000}s`,
                ),
              )
            }, POSTIZ_POST_TIMEOUT_MS)
          })
          const raw = await Promise.race([
            client.post(
              payload as unknown as Parameters<typeof client.post>[0],
            ),
            timeoutPromise,
          ])
          result = normalizePostizSdkResult<unknown>(raw)
        } catch (err) {
          result = postizSdkError(err)
        } finally {
          // Non-negotiable: an unfired setTimeout pins the event loop and
          // accumulates per-request — clearing on BOTH success and error
          // is what keeps the process from leaking timers under load.
          if (timeoutId) clearTimeout(timeoutId)
        }

        if (!result.ok) {
          return json(
            { ok: false, error: result.error, hint: result.hint },
            { status: result.status },
          )
        }

        return json({
          ok: true,
          scheduled: Boolean(scheduleAt),
          scheduleAt,
          response: result.data,
        })
      },
    },
  },
})
