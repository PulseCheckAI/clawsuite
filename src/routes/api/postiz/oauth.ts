// Postiz Cloud OAuth2 — disconnect handler.
// DELETE /api/postiz/oauth
//
// Clears the persisted access token. After this returns, subsequent Postiz
// API calls fall back to POSTIZ_API_KEY (self-host) or fail with the
// "not configured" error. The browser-side flow re-runs /oauth/start to
// reconnect.
//
// No GET handler — connection state is exposed by /api/postiz/oauth/status.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { deleteToken } from '@/server/postiz-oauth-store'

export const Route = createFileRoute('/api/postiz/oauth')({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        deleteToken()
        return json({ ok: true })
      },
    },
  },
})
