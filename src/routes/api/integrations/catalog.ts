// Integration Hub — catalog browser (the "add any future one" surface).
// GET /api/integrations/catalog?category=&q=&limit= → { items }
// Reads integrations.integration_catalog (504 integrations). Metadata only.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { listCatalog } from '@/server/integrations/store'

export const Route = createFileRoute('/api/integrations/catalog')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const category = url.searchParams.get('category') ?? undefined
        const q = url.searchParams.get('q') ?? undefined
        const limitRaw = url.searchParams.get('limit')
        const limitNum = limitRaw ? Number(limitRaw) : undefined
        try {
          const items = await listCatalog({
            category,
            q,
            limit:
              typeof limitNum === 'number' && Number.isFinite(limitNum)
                ? limitNum
                : undefined,
          })
          return json({ ok: true, items })
        } catch (e) {
          return json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          )
        }
      },
    },
  },
})
