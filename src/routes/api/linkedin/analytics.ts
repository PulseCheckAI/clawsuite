// LinkedIn composer — fetch analytics (reactions, comments) for a single post.
// GET /api/linkedin/analytics?post_urn=urn:li:share:...
//
// Proxies to the MCP tool `linkedin_get_post_analytics`. Phase-1 MCP returns
// reactions + comments via the socialActions endpoint; impressions/clicks
// require Marketing-API approval and come later via the Phase-3 ETL.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { callLinkedInMcp } from './_mcp'

interface AnalyticsResult {
  post_urn: string
  reactions_count?: number
  comments_count?: number
  shares_count?: number
  likes_count?: number
  impressions_count?: number | null
  click_count?: number | null
  fetched_at?: string
  note?: string
}

export const Route = createFileRoute('/api/linkedin/analytics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const postUrn = url.searchParams.get('post_urn')?.trim() ?? ''
        if (!postUrn) {
          return json(
            { ok: false, error: 'post_urn query param required' },
            { status: 400 },
          )
        }

        const result = await callLinkedInMcp<AnalyticsResult>(
          'linkedin_get_post_analytics',
          { post_urn: postUrn },
          20_000,
        )

        if (!result.ok) {
          return json(
            {
              ok: false,
              error: result.error,
              code: result.code,
              hint: result.hint,
            },
            { status: result.status },
          )
        }

        return json({
          ok: true,
          postUrn: result.data.post_urn,
          // Normalize the various count fields the MCP may surface. Anything
          // missing stays null — the UI renders "—" when null.
          reactionsCount:
            result.data.reactions_count ?? result.data.likes_count ?? null,
          commentsCount: result.data.comments_count ?? null,
          sharesCount: result.data.shares_count ?? null,
          impressionsCount: result.data.impressions_count ?? null,
          clickCount: result.data.click_count ?? null,
          fetchedAt: result.data.fetched_at ?? new Date().toISOString(),
          note: result.data.note ?? null,
        })
      },
    },
  },
})
