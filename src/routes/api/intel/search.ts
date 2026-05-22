// Semantic search over enriched items.
//   GET /api/intel/search?q=<query>&k=<1-50>
// Embeds the query, runs cosine match via intel.match_intel_items, then hydrates
// the matched item rows and returns them ranked by similarity.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { embed } from '@/server/intel/llm'
import { matchItems } from '@/server/intel/item-ai-store'
import { getIntelDb } from '@/server/intel/db'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const Route = createFileRoute('/api/intel/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const p = new URL(request.url).searchParams
        const q = (p.get('q') || '').trim()
        if (!q) return json({ ok: false, error: 'q required' }, { status: 400 })
        const kRaw = Number(p.get('k') || '20')
        const k = Number.isFinite(kRaw)
          ? Math.min(Math.max(Math.trunc(kRaw), 1), 50)
          : 20

        let vector: number[]
        try {
          vector = await embed(q)
        } catch (e) {
          return json(
            { ok: false, error: `embed: ${errMsg(e)}` },
            { status: 502 },
          )
        }

        const matches = await matchItems(vector, k)
        if (matches.length === 0)
          return json({ ok: true, query: q, results: [] })

        const ids = matches.map((m) => m.item_id)
        const db = await getIntelDb()
        const { data, error } = await db
          .from('items')
          .select('id,title,link,raw_snippet,pub_date,read,saved')
          .in('id', ids)
        if (error)
          return json({ ok: false, error: error.message }, { status: 500 })

        const byId = new Map((data ?? []).map((r: { id: string }) => [r.id, r]))
        const results = matches
          .filter((m) => byId.has(m.item_id))
          .map((m) => ({ ...byId.get(m.item_id), similarity: m.similarity }))
        return json({ ok: true, query: q, results })
      },
    },
  },
})
