import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getAutonomyState } from '../../server/autonomy-loop'

// GET /api/autonomy-status — current state of the autonomy loop.
// Read-only; no auth gate so the dashboard can poll cheaply.
export const Route = createFileRoute('/api/autonomy-status')({
  server: {
    handlers: {
      GET: async () => {
        return json({ ok: true, state: getAutonomyState() })
      },
    },
  },
})
