// ── /api/voice-engine/voices — list voices (built-ins + org cloned) ────────
// + /voices/clone proxy (POST).

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { forwardToVoiceEngine, isVoiceEngineReady } from '@/server/voice-engine'

export const Route = createFileRoute('/api/voice-engine/voices')({
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
          path: `/api/voices${qs ? `?${qs}` : ''}`,
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
        // Voice cloning uploads audio bytes via portable-tts — give it a
        // longer leash (engine default would be fine but be explicit).
        const res = await forwardToVoiceEngine({
          path: '/api/voices/clone',
          method: 'POST',
          body,
          timeoutMs: 60_000,
        })
        return json(res.body as any, { status: res.status })
      },
    },
  },
})
