import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isPasswordProtectionEnabled,
  isAuthenticated,
} from '../../server/auth-middleware'
import { isMultiUserEnabled, getRequestUser } from '../../server/auth-users'

export const Route = createFileRoute('/api/auth-check')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return Promise.race([
          (async () => {
            const authRequired = isPasswordProtectionEnabled()
            const authenticated = isAuthenticated(request)
            const multiUser = isMultiUserEnabled()
            const u = multiUser ? getRequestUser(request) : null

            return json({
              authenticated,
              authRequired,
              multiUser,
              user: u ? { email: u.email, role: u.role, orgId: u.orgId } : null,
            })
          })(),
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(
                json(
                  {
                    // Fail CLOSED on timeout: a slow server must read as
                    // "auth required + not authenticated", never as open.
                    authenticated: false,
                    authRequired: true,
                    error: 'server_timeout',
                  },
                  { status: 200 },
                ),
              )
            }, 4_000)
          }),
        ])
      },
    },
  },
})
