import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

// ── /api/cc-kv ──────────────────────────────────────────────────────────────
//
// Server-side proxy that reads ModuleRenderInput payloads from the
// pulsecheck-cc-edge Cloudflare Worker (KV-backed, populated by the Windmill
// aggregators under main/apps/windmill/f/command_center/aggregator_*.deno.ts).
//
// Closes the integration gap surfaced by the 2026-05-14 integration audit:
// the Mission Control dashboard was previously islanded from the Windmill→KV
// aggregator pipeline that publishes System Pulse / Pipeline / MarginOps /
// Pending Decisions / Comms Triage / Knowledge / Investor KPIs / Brief Feed.
//
// Usage: GET /api/cc-kv?module=system-pulse
//        GET /api/cc-kv?module=pipeline
//        ...
//
// Why proxy and not fetch direct from the browser:
//   - Allow-list the module IDs at the proxy boundary so a UI bug can't
//     pull arbitrary subpaths from the worker.
//   - Standardize the lens=founder&brand=all scope (the dashboard is a
//     founder surface; no token-aware lens needed yet).
//   - Hide the worker hostname from the client so we can swap edges later.
//   - Surface a stable error envelope when the worker is configuring/down.
// ────────────────────────────────────────────────────────────────────────────

const CC_EDGE_HOST = 'https://pulsecheck-cc-edge.thiago-costa-144.workers.dev'

// Mirrors the ALLOWED_MODULES set in apps/cloudflare-worker-cc-edge/src/kv-proxy.ts.
// Kept here as a defense-in-depth allow-list; if the worker accepts a new
// module ID before this list is updated, the proxy still rejects it.
const ALLOWED_MODULES = new Set([
  'system-pulse',
  'pending-decisions',
  'marginops-live',
  'pipeline',
  'comms-triage',
  'knowledge',
  'intel-drift',
  'growth-desk',
  'agent-stream',
  'investor-preview',
  'investor-kpis',
  'brief-feed',
])

const FETCH_TIMEOUT_MS = 5000

export const Route = createFileRoute('/api/cc-kv')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const moduleId = url.searchParams.get('module')
        if (!moduleId) {
          return json(
            { ok: false, error: 'missing ?module=<id>' },
            { status: 400 },
          )
        }
        if (!ALLOWED_MODULES.has(moduleId)) {
          return json(
            { ok: false, error: 'unknown module', module: moduleId },
            { status: 404 },
          )
        }

        const target = `${CC_EDGE_HOST}/api/cc/${encodeURIComponent(moduleId)}?lens=founder&brand=all`

        const ac = new AbortController()
        const timeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
        try {
          const res = await fetch(target, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: ac.signal,
          })
          if (!res.ok) {
            return json(
              {
                ok: false,
                error: `edge returned HTTP ${res.status}`,
                module: moduleId,
              },
              { status: 502 },
            )
          }
          const payload = await res.json()
          return json({ ok: true, module: moduleId, payload })
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          return json(
            {
              ok: false,
              error: reason.includes('aborted')
                ? 'edge timeout'
                : `edge unreachable: ${reason}`,
              module: moduleId,
            },
            { status: 504 },
          )
        } finally {
          clearTimeout(timeout)
        }
      },
    },
  },
})
