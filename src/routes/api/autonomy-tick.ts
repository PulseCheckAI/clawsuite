import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { autonomyTick } from '../../server/autonomy-loop'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

// POST /api/autonomy-tick — fire one tick of the autonomy loop on demand.
// Always-available regardless of PULSEOS_AUTONOMY_LOOP_ENABLED so operators
// can drive the loop manually from the dashboard or curl during dev.
// Rate-limited: 30 manual ticks/min/IP to prevent dispatch storms.
//
// Other methods (GET, PUT, DELETE, …) return 405 with an Allow: POST hint
// so ops debugging with `curl` shows the right error instead of the SPA
// fallback HTML.
const methodNotAllowed = () =>
  new Response(
    JSON.stringify({
      ok: false,
      error: 'Method not allowed. Use POST.',
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        Allow: 'POST',
      },
    },
  )

export const Route = createFileRoute('/api/autonomy-tick')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        if (!rateLimit(`autonomy-tick:${getClientIp(request)}`, 30, 60_000)) {
          return rateLimitResponse()
        }
        const result = await autonomyTick()
        return json(result)
      },
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
})
