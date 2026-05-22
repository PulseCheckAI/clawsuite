// Ask the knowledge layer (LightRAG graph+vector RAG over feeds + vault).
//   GET  /api/intel/ask?q=<question>&mode=hybrid
//   POST /api/intel/ask  { q, mode? }
// Returns a cited answer synthesized by LightRAG. 502 if the LightRAG server
// is down (it runs separately at LIGHTRAG_BASE_URL).

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  askKnowledge,
  knowledgeHealth,
  type RagMode,
} from '@/server/intel/knowledge'

const MODES: RagMode[] = ['naive', 'local', 'global', 'hybrid', 'mix']

function pickMode(raw: string | null): RagMode {
  return MODES.includes(raw as RagMode) ? (raw as RagMode) : 'hybrid'
}

async function answer(q: string, mode: RagMode) {
  if (!(await knowledgeHealth())) {
    return json(
      { ok: false, error: 'Knowledge engine (LightRAG) is not reachable.' },
      { status: 502 },
    )
  }
  try {
    const text = await askKnowledge(q, mode)
    return json({ ok: true, query: q, mode, answer: text })
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}

export const Route = createFileRoute('/api/intel/ask')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const p = new URL(request.url).searchParams
        const q = (p.get('q') || '').trim()
        if (!q) return json({ ok: false, error: 'q required' }, { status: 400 })
        return answer(q, pickMode(p.get('mode')))
      },
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
        const q = typeof body.q === 'string' ? body.q.trim() : ''
        if (!q) return json({ ok: false, error: 'q required' }, { status: 400 })
        const mode = pickMode(typeof body.mode === 'string' ? body.mode : null)
        return answer(q, mode)
      },
    },
  },
})
