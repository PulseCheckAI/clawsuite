// Postiz Cloud OAuth2 — status handler.
// GET /api/postiz/oauth/status
//
// Returns metadata about the persisted Postiz Cloud token. NEVER includes
// the access_token value — only the public-safe fields the UI status card
// renders.
//
// Response shapes (all use the dashboard-wide { ok, ... } envelope):
//   { ok: true, connected: false }
//   { ok: true, connected: true, organizationId, cus, obtainedAt }
//   { ok: false, error: 'Unauthorized' }   // 401

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { readToken } from '@/server/postiz-oauth-store'

export const Route = createFileRoute('/api/postiz/oauth/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const token = readToken()
        if (!token) {
          return json({ ok: true, connected: false })
        }

        return json({
          ok: true,
          connected: true,
          organizationId: token.organization_id,
          cus: token.cus,
          obtainedAt: token.obtained_at,
        })
      },
    },
  },
})
