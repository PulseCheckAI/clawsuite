// Sub-project D Phase 4 — top LinkedIn posts last 30d.
// GET /api/linkedin/posts?limit=20

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getLinkedInSupabase } from '@/server/linkedin-supabase'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export const Route = createFileRoute('/api/linkedin/posts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const parsed = parseInt(url.searchParams.get('limit') ?? '', 10)
        const limit = Number.isFinite(parsed)
          ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
          : DEFAULT_LIMIT

        try {
          const supabase = await getLinkedInSupabase()
          const { data, error } = await supabase
            .schema('gold')
            .from('v_linkedin_post_performance')
            .select('*')
            .limit(limit)

          if (error) {
            return json({ ok: false, error: error.message }, { status: 503 })
          }

          return json({ ok: true, posts: data ?? [] })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
