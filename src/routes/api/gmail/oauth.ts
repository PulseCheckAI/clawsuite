// Gmail OAuth2 — disconnect handler.  DELETE /api/gmail/oauth
// Clears the persisted token. Connection state is read via /oauth/status.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { deleteToken } from '@/server/gmail-oauth-store'

export const Route = createFileRoute('/api/gmail/oauth')({
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
