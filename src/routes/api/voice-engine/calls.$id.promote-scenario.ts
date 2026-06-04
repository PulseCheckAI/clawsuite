// ── /api/voice-engine/calls/$id/promote-scenario ────────────────────────────
// POST → forwards to /api/calls/:id/promote-scenario with the {name,description?}
// body. Returns the new scenario row when successful.
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { forwardToVoiceEngine, isVoiceEngineReady } from '@/server/voice-engine'

export const Route = createFileRoute(
  '/api/voice-engine/calls/$id/promote-scenario',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
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
        if (!id) {
          return json({ ok: false, error: 'missing id' }, { status: 400 })
        }
        const body = await request.json().catch(() => null)
        if (body === null || typeof body.name !== 'string') {
          return json(
            { ok: false, error: 'invalid body — `name` required' },
            { status: 400 },
          )
        }
        const res = await forwardToVoiceEngine({
          path: `/api/calls/${encodeURIComponent(id)}/promote-scenario`,
          method: 'POST',
          body,
        })
        return json(res.body as any, { status: res.status })
      },
    },
  },
})
