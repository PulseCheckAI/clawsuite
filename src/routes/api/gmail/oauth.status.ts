// Gmail OAuth2 — status handler.  GET /api/gmail/oauth/status
// Returns metadata about the persisted token. NEVER the token values.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { readToken } from '@/server/gmail-oauth-store'

export const Route = createFileRoute('/api/gmail/oauth/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const token = readToken()
        if (!token) return json({ ok: true, connected: false })
        return json({
          ok: true,
          connected: true,
          scope: token.scope,
          expiresAt: token.expires_at,
          obtainedAt: token.obtained_at,
        })
      },
    },
  },
})
