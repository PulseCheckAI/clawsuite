import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { gatewayReconnect, gatewayRpc } from '../../server/gateway'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

// OpenClaw 2026.5.7 removed the `gateway.restart` RPC method. This route
// now defaults to a LOCAL reconnect of the singleton WS client — that's
// the actual recovery path for the "Gateway client is shut down" state
// users see after HMR/transient disconnects (the gateway daemon itself
// stays running on :18789 the whole time).
// The upstream RPC is still attempted first as a best-effort soft restart
// for older OpenClaw versions; failure is non-fatal.
export const Route = createFileRoute('/api/gateway-restart')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const ip = getClientIp(request)
        if (!rateLimit(`gateway-restart:${ip}`, 10, 60_000)) {
          return rateLimitResponse()
        }

        // Best-effort upstream graceful restart (older OpenClaw); ignore failures.
        let upstreamMessage: string | null = null
        try {
          await gatewayRpc<{ ok?: boolean; error?: string }>(
            'gateway.restart',
            {},
          )
        } catch (err) {
          upstreamMessage = err instanceof Error ? err.message : String(err)
        }

        // LOCAL reconnect — actually recovers the shut-down WS client.
        try {
          await gatewayReconnect()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (
            msg.includes('ECONNREFUSED') ||
            msg.includes('connection refused')
          ) {
            return json(
              {
                ok: false,
                error:
                  'Gateway daemon not reachable. Start it: openclaw gateway run --port 18789',
              },
              { status: 503 },
            )
          }
          return json(
            { ok: false, error: msg, upstreamMessage },
            { status: 500 },
          )
        }

        return json({
          ok: true,
          reconnected: true,
          upstreamRestart: upstreamMessage === null,
          upstreamMessage,
        })
      },
    },
  },
})
