import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789'

// Derive the gateway's HTTP /health URL from the (ws[s]) gateway URL. The
// browser cannot fetch the loopback gateway directly (cross-origin → CORS),
// so the Debug Console hits this same-origin proxy and we fetch server-side.
function gatewayHealthUrl(): string {
  const raw = process.env.CLAWDBOT_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL
  try {
    const u = new URL(raw)
    const httpProtocol = u.protocol === 'wss:' ? 'https:' : 'http:'
    return `${httpProtocol}//${u.host}/health`
  } catch {
    return 'http://127.0.0.1:18789/health'
  }
}

export const Route = createFileRoute('/api/gateway/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        try {
          const response = await fetch(gatewayHealthUrl(), {
            signal: controller.signal,
          })
          const body = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          return json(body, { status: response.ok ? 200 : 502 })
        } catch {
          return json({ status: 'unreachable' }, { status: 503 })
        } finally {
          clearTimeout(timeout)
        }
      },
    },
  },
})
