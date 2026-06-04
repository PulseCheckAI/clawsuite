// ── /api/voice-engine/scenarios — list (GET) + create (POST) ───────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { forwardToVoiceEngine, isVoiceEngineReady } from '@/server/voice-engine'

export const Route = createFileRoute('/api/voice-engine/scenarios')({
  server: {
    handlers: {
      GET: async ({ request }) => {
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
        const url = new URL(request.url)
        const qs = url.searchParams.toString()
        const res = await forwardToVoiceEngine({
          path: `/api/scenarios${qs ? `?${qs}` : ''}`,
          method: 'GET',
        })
        return json(res.body as any, { status: res.status })
      },
      POST: async ({ request }) => {
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
        const body = await request.json().catch(() => null)
        if (body === null) {
          return json({ ok: false, error: 'invalid JSON' }, { status: 400 })
        }
        const res = await forwardToVoiceEngine({
          path: '/api/scenarios',
          method: 'POST',
          body,
        })
        return json(res.body as any, { status: res.status })
      },
    },
  },
})
