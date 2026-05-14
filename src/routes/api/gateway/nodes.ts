import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { gatewayRpc } from '@/server/gateway'
import { isAuthenticated } from '@/server/auth-middleware'

export const Route = createFileRoute('/api/gateway/nodes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const result = await gatewayRpc<Record<string, unknown>>(
            'node.list',
            {},
          )
          return json({ ok: true, data: result })
        } catch {
          // node.list may not exist on all gateway versions — degrade silently
          return json({ ok: true, data: { nodes: [] } })
        }
      },
    },
  },
})
