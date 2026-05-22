// GET /api/media/skills — return the skill registry + generator profiles.
//
// The skill registry is hard-coded in the adapter today. The endpoint exists
// so the UI can hydrate from a single source of truth and so a future
// plugin loader can extend the list server-side without a UI re-deploy.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  safeErrorMessage,
} from '@/server/rate-limit'
import { listGeneratorProfiles, listSkills } from '@/server/wan2gp-adapter'

export const Route = createFileRoute('/api/media/skills')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ip = getClientIp(request)
        if (!rateLimit(`media-skills:${ip}`, 60, 60_000)) {
          return rateLimitResponse()
        }

        try {
          return json({
            ok: true,
            skills: listSkills(),
            profiles: listGeneratorProfiles(),
          })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
