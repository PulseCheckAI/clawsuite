// Sub-project D Phase 4 — recent LinkedIn comments (newest first).
// GET /api/linkedin/comments?limit=50

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getLinkedInSupabase } from '@/server/linkedin-supabase'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const Route = createFileRoute('/api/linkedin/comments')({
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
            .schema('silver')
            .from('linkedin_comments')
            .select(
              'comment_urn,content_id,post_urn,author_urn,author_name,author_headline,body,posted_at,reactions_count,parent_comment_urn,first_seen_at',
            )
            .order('posted_at', { ascending: false })
            .limit(limit)

          if (error) {
            return json({ ok: false, error: error.message }, { status: 503 })
          }

          return json({ ok: true, comments: data ?? [] })
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
