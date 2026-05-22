// GET /api/media/status/$jobId — poll a Wan2GP job's status.
//
// Mirrors the file-naming convention used by /api/sessions/$sessionKey.status.ts:
// `status.$jobId.ts` ⇒ /api/media/status/$jobId.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  safeErrorMessage,
} from '@/server/rate-limit'
import { getJobStatus } from '@/server/wan2gp-adapter'

export const Route = createFileRoute('/api/media/status/$jobId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const ip = getClientIp(request)
        // Allow brisk polling (every 2s ≈ 30/min) plus a little headroom for
        // multiple concurrent jobs in the operator's queue.
        if (!rateLimit(`media-status:${ip}`, 120, 60_000)) {
          return rateLimitResponse()
        }

        const jobId = params.jobId?.trim() ?? ''
        if (!jobId) {
          return json(
            { ok: false, error: 'jobId is required' },
            { status: 400 },
          )
        }

        try {
          const status = await getJobStatus(jobId)
          return json({ ok: true, status })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 502 },
          )
        }
      },
    },
  },
})
