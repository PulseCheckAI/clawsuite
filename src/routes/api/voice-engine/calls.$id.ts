// ── /api/voice-engine/calls/$id — proxy → voice-engine /api/calls/:id ──────
// GET → fetch single call row (full transcript + whisper_verify_result).
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { forwardToVoiceEngine, isVoiceEngineReady } from '@/server/voice-engine'

export const Route = createFileRoute('/api/voice-engine/calls/$id')({
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
        if (!id) {
          return json({ ok: false, error: 'missing id' }, { status: 400 })
        }
        const res = await forwardToVoiceEngine({
          path: `/api/calls/${encodeURIComponent(id)}`,
          method: 'GET',
        })
        return json(res.body as any, { status: res.status })
      },
    },
  },
})
