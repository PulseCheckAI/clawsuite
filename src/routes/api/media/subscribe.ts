// ── /api/media/subscribe ────────────────────────────────────────────────────
// WebSocket-upgrade endpoint for the render-server job event stream.
//
// The ACTUAL upgrade is handled outside this file. TanStack Start file-routes
// are HTTP-request/response handlers; the `upgrade` event on a node:http
// server fires BEFORE the fetch handler ever sees the request. The real proxy
// lives in serve.mjs's `httpServer.on('upgrade', ...)` block, driven by the
// PROXY_ROUTES SSOT in src/server/security-headers.mjs (entry with
// `prefix: '/api/media/subscribe'`, `target: 'render-ws'`,
// `rewriteTo: '/jobs/subscribe'`).
//
// This file exists so:
//   1. Tooling that walks routes (codegen, route listings, type tests) sees
//      the endpoint declared.
//   2. A plain HTTP GET against /api/media/subscribe gives the operator a
//      pointed 426 ("Upgrade Required") instead of TanStack's generic 404 —
//      a much better debugging signal when the WS upgrade misfires.
//   3. The TanStack Start file-route convention stays the SSOT for any
//      future per-org filter / auth side-effect we want bound to this path
//      that doesn't apply to the raw upgrade frame.
//
// DEV NOTE: in `vite dev` the upgrade is handled by Vite's built-in proxy
// (see vite.config.ts server.proxy['/api/media/subscribe']). The /api route
// file is only the HTTP fallthrough in either environment.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

export const Route = createFileRoute('/api/media/subscribe')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        // The client made a non-upgrade HTTP request. Tell them what to do.
        return json(
          {
            ok: false,
            error: 'upgrade_required',
            detail:
              'This endpoint serves a WebSocket stream. Open it with `new WebSocket("/api/media/subscribe")` instead.',
          },
          {
            status: 426,
            headers: {
              // RFC 7231: 426 responses MUST include an Upgrade header.
              Upgrade: 'websocket',
              Connection: 'Upgrade',
            },
          },
        )
      },
    },
  },
})
