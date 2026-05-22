// Enrich un-enriched items (embed + best-effort summary/tags/score).
//   POST /api/intel/enrich   { limit?: number }   (default 10, cap 50)
// Used by the "Enrich now" action and the pipeline sidecar's enrich stage.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { listUnenriched } from '@/server/intel/item-ai-store'
import { enrichBatch } from '@/server/intel/enrich'

export const Route = createFileRoute('/api/intel/enrich')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        let limit = 10
        try {
          const b = (await request.json()) as { limit?: unknown }
          if (typeof b.limit === 'number')
            limit = Math.min(Math.max(Math.trunc(b.limit), 1), 50)
        } catch {
          // empty body → default limit
        }
        const items = await listUnenriched(limit)
        const results = await enrichBatch(
          items.map((i) => ({
            id: i.id,
            title: i.title,
            raw_snippet: i.raw_snippet,
            full_text: i.full_text,
          })),
        )
        return json({
          ok: true,
          processed: results.length,
          embedded: results.filter((r) => r.embedded).length,
          summarized: results.filter((r) => r.summarized).length,
          results,
        })
      },
    },
  },
})
