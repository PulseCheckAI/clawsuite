// ── /api/voice-engine/context — resolve the org the dashboard should bind to
// Browser asks once on mount; uses returned `orgId` to filter realtime
// channels + populate body fields. Two resolution paths:
//
//   1. Signed-in user (multi-user mode) → their `dashboard_users.org_id`.
//   2. Fallback → process.env.VOICE_HUB_ORG_ID (the same org the server-side
//      proxy stamps onto every voice-engine request). Single-tenant deploy.
//
// Returns `{ orgId: string | null, source: 'user' | 'env' | 'none' }`. The
// browser only treats `orgId` as bindable when it's a non-empty string.
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getRequestUser, isMultiUserEnabled } from '@/server/auth-users'
import { getServerOrgId } from '@/server/voice-engine'

export const Route = createFileRoute('/api/voice-engine/context')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        let orgId: string | null = null
        let source: 'user' | 'env' | 'none' = 'none'
        if (isMultiUserEnabled()) {
          const u = getRequestUser(request)
          if (u?.orgId) {
            orgId = u.orgId
            source = 'user'
          }
        }
        if (!orgId) {
          const env = getServerOrgId()
          if (env) {
            orgId = env
            source = 'env'
          }
        }
        return json({ ok: true, orgId, source })
      },
    },
  },
})
