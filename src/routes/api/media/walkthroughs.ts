// ── /api/media/walkthroughs ─────────────────────────────────────────────────
// GET proxy → http://127.0.0.1:8140/jobs (remotion-studio render server).
//
// Defensive contract: if the render server is unreachable we still return
// HTTP 200 with { jobs: [], render_service_status: 'down' } so the panel
// renders an empty grid + a red status pill instead of a 5xx. Network
// reachability is a SEPARATE signal from "there are no jobs"; we surface
// both via render_service_status so the UI can show the right empty state.
//
// Sorting: render.mjs already sorts by started_at DESC (newest first) and
// caps at 50 — we trust that order and pass through.
//
// No org filter today: the render server stores no per-org metadata, so
// every authed user sees every job. Flagged for v2 (per-org filtering
// requires a schema change on render.mjs's job ring buffer).
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { RENDER_FETCH_TIMEOUT_MS, renderBaseUrl } from '@/server/render-server'

export const Route = createFileRoute('/api/media/walkthroughs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const base = renderBaseUrl()
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), RENDER_FETCH_TIMEOUT_MS)
        try {
          const res = await fetch(`${base}/jobs`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          })
          if (!res.ok) {
            // Render server returned non-2xx — treat as "up but angry".
            const text = await res.text().catch(() => '')
            return json(
              {
                jobs: [],
                render_service_status: 'degraded',
                upstream_status: res.status,
                upstream_body: text || null,
              },
              { status: 200 },
            )
          }
          const body = (await res.json().catch(() => null)) as {
            jobs?: Array<unknown>
          } | null
          const jobs = Array.isArray(body?.jobs) ? body!.jobs : []
          return json({ jobs, render_service_status: 'up' }, { status: 200 })
        } catch (e) {
          // Network failure / timeout — render server down. Empty list +
          // red status pill; the dashboard route keeps polling and recovers
          // automatically when the sidecar comes back.
          return json(
            {
              jobs: [],
              render_service_status: 'down',
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 200 },
          )
        } finally {
          clearTimeout(t)
        }
      },
    },
  },
})
