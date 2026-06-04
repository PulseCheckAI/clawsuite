// ── /api/users/$id ───────────────────────────────────────────────────────────
// ADMIN-ONLY: enable/disable a dashboard user. Flag-gated on multi-user auth.
//   PATCH { disabled: boolean }
// ──────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import {
  isMultiUserEnabled,
  requireAdmin,
  setUserDisabled,
} from '@/server/auth-users'
import { requireJsonContentType } from '@/server/rate-limit'

const PatchSchema = z.object({ disabled: z.boolean() })

export const Route = createFileRoute('/api/users/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        if (!isMultiUserEnabled()) {
          return json(
            { ok: false, error: 'Multi-user auth is not enabled' },
            { status: 400 },
          )
        }
        if (!requireAdmin(request)) {
          return json(
            { ok: false, error: 'Forbidden — admin only' },
            { status: 403 },
          )
        }
        const raw = await request.json().catch(() => ({}))
        const parsed = PatchSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        const ok = await setUserDisabled(params.id, parsed.data.disabled)
        return json({ ok })
      },
    },
  },
})
