// ── /api/media/render-status/:jobId ────────────────────────────────────────
// GET proxy → http://127.0.0.1:8140/jobs/:id (remotion-studio render server).
//
// Why a dedicated path instead of reusing /api/media/status/$jobId:
//   * /api/media/status/$jobId is wired to the Wan2GP adapter (image/video
//     gen), NOT remotion. Re-using it would conflate two unrelated job
//     systems with different status shapes, different lifecycles, and
//     different upstream services.
//
// Why a dedicated route instead of deriving from /walkthroughs (the prior
// behaviour of mediaApi.getRenderStatus):
//   * The list-poll caches in the operator's browser. A single-job lookup
//     wants the live upstream value, not a 5s-stale list snapshot.
//   * The list endpoint masks "service down" as `render_service_status:
//     down` + empty jobs[] (correct for the panel — show empty grid not
//     5xx). A single-job caller cannot tell "queued" apart from "service
//     down" in that shape; it needs the upstream status code.
//
// Defensive contract: render-service-down → HTTP 503 with
//   { ok: false, error: 'render_service_unreachable', detail }
// so the caller can render a degraded state without try/catch ceremony.
// Upstream 404 (job aged out of the ring buffer) passes through verbatim.
// Upstream 2xx passes through with status + url + error fields.
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getClientIp, rateLimit, rateLimitResponse } from '@/server/rate-limit'
import { RENDER_FETCH_TIMEOUT_MS, renderBaseUrl } from '@/server/render-server'

// Match the existing stream.$jobId.ts validation pattern (UUID-ish, 1..64
// chars of [A-Za-z0-9_-]). Strict enough to block path traversal before we
// touch the upstream URL. render.mjs uses crypto.randomUUID() so real ids
// are RFC4122 v4; this regex stays a little looser so a debugging op who
// hand-mints a synthetic id still works.
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const Route = createFileRoute('/api/media/render-status/$jobId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const ip = getClientIp(request)
        // The UI polls every ~1.5s for the first 60s after submit, then
        // falls back to the list-poll. 120/min/IP leaves plenty of
        // headroom for multiple concurrent jobs in the operator's queue.
        if (!rateLimit(`media-render-status:${ip}`, 120, 60_000)) {
          return rateLimitResponse()
        }

        const jobId = String(params.jobId ?? '').trim()
        if (!JOB_ID_RE.test(jobId)) {
          return json({ ok: false, error: 'invalid job id' }, { status: 400 })
        }

        const base = renderBaseUrl()
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), RENDER_FETCH_TIMEOUT_MS)
        try {
          const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          })
          const parsed = (await res.json().catch(() => null)) as unknown
          // Pass through the upstream status verbatim — including 404
          // when the job has aged out of the 200-item ring buffer.
          return json((parsed ?? { ok: res.ok }) as any, {
            status: res.status,
          })
        } catch (e) {
          // Network failure / timeout → 503. Single-job lookup must NOT
          // mask "service down" as "queued"; the caller renders a
          // degraded state from this signal.
          return json(
            {
              ok: false,
              error: 'render_service_unreachable',
              detail: e instanceof Error ? e.message : String(e),
            },
            { status: 503 },
          )
        } finally {
          clearTimeout(t)
        }
      },
    },
  },
})
