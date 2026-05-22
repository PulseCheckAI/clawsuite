import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  discoverAllLocalRunners,
  type LocalRunnerResult,
} from '../../../server/local-llm'

/**
 * GET /api/llm/local
 *
 * Per-runner local-LLM discovery. Returns one entry per probed runner with
 * `reachable`, `baseUrl`, `models`, and an `emptyHint` string when the runner
 * is reachable but has no models loaded.
 *
 * Distinct from /api/models which flattens local models into the unified
 * model catalog (with provider-prefixed ids like `ollama/qwen3:32b`).
 */
export const Route = createFileRoute('/api/llm/local')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let providers: LocalRunnerResult[]
        try {
          providers = await discoverAllLocalRunners()
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }

        return json({
          ok: true,
          providers,
        })
      },
    },
  },
})
