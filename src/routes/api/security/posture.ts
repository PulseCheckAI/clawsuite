// ── /api/security/posture — dashboard exposure posture ───────────────────────
// Fast, in-process security posture for the System > Security & Exposure card.
// Surfaces the high-signal exposure facts (esp. whether auth is BYPASSED — the
// critical finding) without the slow `openclaw security audit` CLI. Read-only.
// ──────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '@/server/auth-middleware'
import { isMultiUserEnabled } from '@/server/auth-users'

export const Route = createFileRoute('/api/security/posture')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const nodeEnv = process.env.NODE_ENV ?? 'development'
        const passwordProtection = isPasswordProtectionEnabled()
        const multiUser = isMultiUserEnabled()
        const allowedOrigins = process.env.CLAWSUITE_ALLOWED_ORIGINS ?? null
        // Auth is bypassed whenever no password is configured (only possible
        // outside production — prod refuses to start without one).
        const authBypassed = !passwordProtection

        return json({
          ok: true,
          ts: Date.now(),
          posture: {
            nodeEnv,
            passwordProtection,
            authBypassed,
            multiUser,
            allowedOrigins,
          },
        })
      },
    },
  },
})
