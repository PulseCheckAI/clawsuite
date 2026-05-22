import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireLocalOrAuth } from '../../server/auth-middleware'
import { getAutonomyState } from '../../server/autonomy-loop'

// GET /api/autonomy-status — current state of the autonomy loop.
// requireLocalOrAuth: lets the local dashboard poll cheaply without a session
// cookie while still requiring auth when reached from a non-loopback origin.
export const Route = createFileRoute('/api/autonomy-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, state: getAutonomyState() })
      },
    },
  },
})
