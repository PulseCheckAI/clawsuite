// ── /api/users ───────────────────────────────────────────────────────────────
// ADMIN-ONLY user management (list + create). Flag-gated on multi-user auth.
//   GET  → list dashboard users        (admin only)
//   POST → create a dashboard user     (admin only)
// Every handler requires isMultiUserEnabled() AND a logged-in user with role
// 'admin' (requireAdmin). Disabled/operator/viewer/customer users get 403.
// ──────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import {
  isMultiUserEnabled,
  requireAdmin,
  listUsers,
  createUser,
} from '@/server/auth-users'
import { requireJsonContentType } from '@/server/rate-limit'

// Single role (admin) — not accepted from the client; createUser hardcodes it.
const CreateUserSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(1000),
  orgId: z.string().uuid().nullable().optional(),
})

function notEnabled() {
  return json(
    { ok: false, error: 'Multi-user auth is not enabled' },
    { status: 400 },
  )
}

function forbidden() {
  return json({ ok: false, error: 'Forbidden — admin only' }, { status: 403 })
}

export const Route = createFileRoute('/api/users/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isMultiUserEnabled()) return notEnabled()
        if (!requireAdmin(request)) return forbidden()
        const users = await listUsers()
        return json({ ok: true, users })
      },
      POST: async ({ request }) => {
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        if (!isMultiUserEnabled()) return notEnabled()
        if (!requireAdmin(request)) return forbidden()

        const raw = await request.json().catch(() => ({}))
        const parsed = CreateUserSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        const result = await createUser(parsed.data)
        if (!result.ok) {
          return json({ ok: false, error: result.error }, { status: 400 })
        }
        return json({ ok: true, userId: result.userId })
      },
    },
  },
})
