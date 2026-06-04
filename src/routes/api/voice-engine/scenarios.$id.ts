// ── /api/voice-engine/scenarios/$id — GET / PUT / DELETE ───────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { forwardToVoiceEngine, isVoiceEngineReady } from '@/server/voice-engine'

export const Route = createFileRoute('/api/voice-engine/scenarios/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ready = isVoiceEngineReady()
        if (!ready.ok) {
          return json(
            {
              ok: false,
              error: `voice-engine not configured: ${ready.reason}`,
            },
            { status: 503 },
          )
        }
        const id = String(params.id || '').trim()
        if (!id)
          return json({ ok: false, error: 'missing id' }, { status: 400 })
        const res = await forwardToVoiceEngine({
          path: `/api/scenarios/${encodeURIComponent(id)}`,
          method: 'GET',
        })
        return json(res.body as any, { status: res.status })
      },
      PUT: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ready = isVoiceEngineReady()
        if (!ready.ok) {
          return json(
            {
              ok: false,
              error: `voice-engine not configured: ${ready.reason}`,
            },
            { status: 503 },
          )
        }
        const id = String(params.id || '').trim()
        if (!id)
          return json({ ok: false, error: 'missing id' }, { status: 400 })
        const body = await request.json().catch(() => null)
        if (body === null) {
          return json({ ok: false, error: 'invalid JSON' }, { status: 400 })
        }
        const res = await forwardToVoiceEngine({
          path: `/api/scenarios/${encodeURIComponent(id)}`,
          method: 'PUT',
          body,
        })
        return json(res.body as any, { status: res.status })
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ready = isVoiceEngineReady()
        if (!ready.ok) {
          return json(
            {
              ok: false,
              error: `voice-engine not configured: ${ready.reason}`,
            },
            { status: 503 },
          )
        }
        const id = String(params.id || '').trim()
        if (!id)
          return json({ ok: false, error: 'missing id' }, { status: 400 })
        const res = await forwardToVoiceEngine({
          path: `/api/scenarios/${encodeURIComponent(id)}`,
          method: 'DELETE',
        })
        return json(res.body as any, { status: res.status })
      },
    },
  },
})
