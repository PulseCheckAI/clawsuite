// Record a thumbs vote on an item (signal for future personalization).
//   POST /api/intel/feedback   { item_id: string, vote: -1 | 0 | 1 }

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getIntelDb } from '@/server/intel/db'

export const Route = createFileRoute('/api/intel/feedback')({
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
        const itemId = typeof body.item_id === 'string' ? body.item_id : ''
        const vote = body.vote
        if (!itemId || (vote !== -1 && vote !== 0 && vote !== 1)) {
          return json(
            { ok: false, error: 'item_id and vote (-1|0|1) required' },
            { status: 400 },
          )
        }
        const db = await getIntelDb()
        const { error } = await db
          .from('feedback')
          .insert({ item_id: itemId, vote })
        if (error)
          return json({ ok: false, error: error.message }, { status: 500 })
        return json({ ok: true })
      },
    },
  },
})
