// Integration Hub — overview endpoint.
// GET /api/integrations → { stats, connections, categories }
// All real data from integrations.* (no mock). Never returns credential columns.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getCategoryCounts,
  getHubStats,
  listConnections,
} from '@/server/integrations/store'

export const Route = createFileRoute('/api/integrations/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          // Fetch connections + categories ONCE, then derive stats from them
          // (getHubStats accepts them) — avoids re-querying the same tables.
          const [connections, categories] = await Promise.all([
            listConnections(),
            getCategoryCounts(),
          ])
          const stats = await getHubStats(connections, categories)
          return json({ ok: true, stats, connections, categories })
        } catch (e) {
          return json(
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 502 },
          )
        }
      },
    },
  },
})
