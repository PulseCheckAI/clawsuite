// ── /api/media/render ───────────────────────────────────────────────────────
// POST proxy → http://127.0.0.1:8140/render (remotion-studio render server).
//
// Body shape: { composition_id, props, output_format?='mp4' }
// Response : { job_id, status: 'queued' } (forwarded verbatim from render
//             server) or { error: ... } on validation failure.
//
// Validates composition_id locally BEFORE the network hop so a typo fails
// fast with a clean error. render.mjs validates the same set server-side
// (VALID_COMPOSITION_IDS in render.mjs:40) — this is belt-and-suspenders.
//
// We do NOT validate the `props` shape here: the renderer mounts the zod
// schema from os/remotion-studio/src/types/props.ts at render time, and
// duplicating the schema on the dashboard side would create a drift
// hazard. Bad props surface as a `failed` job with the validator error
// in `job.error` — the walkthroughs grid renders that string in-place.
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  RENDER_FETCH_TIMEOUT_MS,
  renderBaseUrl,
  VALID_COMPOSITION_IDS,
} from '@/server/render-server'

interface RenderBody {
  composition_id?: unknown
  props?: unknown
  output_format?: unknown
}

export const Route = createFileRoute('/api/media/render')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const body = (await request
          .json()
          .catch(() => null)) as RenderBody | null
        if (body === null) {
          return json({ ok: false, error: 'invalid JSON' }, { status: 400 })
        }

        const compositionId = body.composition_id
        if (typeof compositionId !== 'string' || compositionId.length === 0) {
          return json(
            { ok: false, error: 'composition_id is required' },
            { status: 400 },
          )
        }
        if (!VALID_COMPOSITION_IDS.has(compositionId)) {
          return json(
            {
              ok: false,
              error: `unknown composition_id: ${compositionId}`,
              valid: Array.from(VALID_COMPOSITION_IDS),
            },
            { status: 400 },
          )
        }

        // Forward verbatim — render.mjs writes props to a temp file +
        // shells out to remotion render. We do not transform props here.
        const forwardBody = {
          composition_id: compositionId,
          props: body.props ?? {},
          output_format:
            typeof body.output_format === 'string' ? body.output_format : 'mp4',
        }

        const base = renderBaseUrl()
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), RENDER_FETCH_TIMEOUT_MS)
        try {
          const res = await fetch(`${base}/render`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(forwardBody),
            signal: controller.signal,
          })
          const parsed = (await res.json().catch(() => null)) as unknown
          // Pass through whatever the render server said — including the
          // 202/400/500 status code, so the UI can react accordingly.
          return json((parsed ?? { ok: res.ok }) as any, {
            status: res.status,
          })
        } catch (e) {
          // Network failure / timeout — distinguish from "render failed"
          // by using 503 (Service Unavailable). The UI surfaces the
          // detail to the operator.
          return json(
            {
              ok: false,
              error: 'render service unreachable',
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
