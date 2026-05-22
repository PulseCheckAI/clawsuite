// Import an OPML document (string body) → bulk-create rss sources.
//   POST /api/intel/opml-import   { opml: "<opml>...</opml>" }

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { parseOpml } from '@/server/intel/opml'
import { createSources, type NewSource } from '@/server/intel/sources-store'

export const Route = createFileRoute('/api/intel/opml-import')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }
        const opml = typeof body.opml === 'string' ? body.opml : ''
        if (!opml)
          return json(
            { ok: false, error: 'opml string required' },
            { status: 400 },
          )
        const feeds = parseOpml(opml)
        const rows: NewSource[] = feeds.map((f) => ({
          label: f.label,
          kind: 'rss',
          route_or_url: f.url,
          folder: f.folder,
        }))
        const created = await createSources(rows)
        return json({ ok: true, parsed: feeds.length, created })
      },
    },
  },
})
