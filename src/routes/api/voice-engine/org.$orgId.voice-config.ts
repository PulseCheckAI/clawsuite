// ── /api/voice-engine/org/$orgId/voice-config — GET + PUT (merge-patch) ────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { forwardToVoiceEngine, isVoiceEngineReady } from '@/server/voice-engine'

export const Route = createFileRoute(
  '/api/voice-engine/org/$orgId/voice-config',
)({
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
        const orgId = String(params.orgId || '').trim()
        if (!orgId) {
          return json({ ok: false, error: 'missing orgId' }, { status: 400 })
        }
        const res = await forwardToVoiceEngine({
          path: `/api/org/${encodeURIComponent(orgId)}/voice-config`,
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
        const orgId = String(params.orgId || '').trim()
        if (!orgId) {
          return json({ ok: false, error: 'missing orgId' }, { status: 400 })
        }
        const body = await request.json().catch(() => null)
        if (body === null) {
          return json({ ok: false, error: 'invalid JSON' }, { status: 400 })
        }
        const res = await forwardToVoiceEngine({
          path: `/api/org/${encodeURIComponent(orgId)}/voice-config`,
          method: 'PUT',
          body,
        })
        return json(res.body as any, { status: res.status })
      },
    },
  },
})
