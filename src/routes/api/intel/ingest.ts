// Run one ingest cycle over all enabled sources. Called by the sidecar and the
// "Refresh" button. Best-effort per source — one failure never aborts the rest.
//   POST /api/intel/ingest

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { listEnabledSources, markPolled } from '@/server/intel/sources-store'
import { ingestSource, type IngestResult } from '@/server/intel/ingest-rss'

export const Route = createFileRoute('/api/intel/ingest')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        let sources
        try {
          sources = await listEnabledSources()
        } catch (e) {
          return json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          )
        }
        let inserted = 0
        const results: IngestResult[] = []
        for (const s of sources) {
          // Best-effort per source — one failure (ingest or markPolled) never aborts the rest.
          try {
            const r = await ingestSource(s)
            inserted += r.inserted
            results.push(r)
            await markPolled(
              s.id,
              r.error ? `error: ${r.error}` : `ok (${r.inserted} new)`,
            )
          } catch (e) {
            results.push({
              sourceId: s.id,
              fetched: 0,
              inserted: 0,
              error: e instanceof Error ? e.message : String(e),
            })
          }
        }
        return json({ ok: true, sources: sources.length, inserted, results })
      },
    },
  },
})
