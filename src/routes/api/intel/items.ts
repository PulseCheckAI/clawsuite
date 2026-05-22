// Browse + mutate intel items.
//   GET /api/intel/items?sourceId=&folder=&unread=1&saved=1&limit=50
//   PUT /api/intel/items   { id, read?, saved? }

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { listItems, setItemState } from '@/server/intel/items-store'

export const Route = createFileRoute('/api/intel/items')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const p = new URL(request.url).searchParams
        const limitRaw = Number(p.get('limit') ?? '50')
        const items = await listItems({
          sourceId: p.get('sourceId') ?? undefined,
          folder: p.get('folder') ?? undefined,
          unreadOnly: p.get('unread') === '1',
          savedOnly: p.get('saved') === '1',
          limit: Number.isFinite(limitRaw) ? limitRaw : 50,
        })
        return json({ ok: true, items })
      },

      PUT: async ({ request }) => {
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
        const id = typeof body.id === 'string' ? body.id : ''
        if (!id)
          return json({ ok: false, error: 'id required' }, { status: 400 })
        const patch: { read?: boolean; saved?: boolean } = {}
        if (typeof body.read === 'boolean') patch.read = body.read
        if (typeof body.saved === 'boolean') patch.saved = body.saved
        const item = await setItemState(id, patch)
        return json({ ok: true, item })
      },
    },
  },
})
