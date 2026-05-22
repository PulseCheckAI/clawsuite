import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isAuthenticated } from '../../server/auth-middleware'

// ── /api/cc-sidecars?file=<memory|calendar|team> ────────────────────────────
//
// Server-side reader for the artifacts-panel/_data/*.json sidecars.
// Closes the audit's "artifacts-panel/_data not consumed by dashboard" gap.
//
// The HTML mockups at artifacts-panel/{14-memory,15-calendar,16-digital-office,
// 17-team-structure}.html all consume these JSONs via fetch. The React
// dashboard had no equivalent reader, so the same data was effectively
// invisible to /dashboard. This route gives the dashboard the same view.
//
// Allow-listed file names; resolves relative to monorepo root so it works
// whether the dev server starts from os/dashboard-clawsuite/ or from the
// outer pulsecheck-ai/ working dir.
//
// Liveness policy: these JSONs are real-data snapshots (memory-index.json
// is generated from the Claude auto-memory dir; calendar.json from
// main/apps/windmill/f/**/*.schedule.yaml; team.json from .claude/agents/
// + brain/COMMAND-CENTER-MEMORY.md). Not mock data. They refresh at the
// cadence the producer scripts run; the dashboard simply re-reads.
// ────────────────────────────────────────────────────────────────────────────

const ALLOWED = {
  memory: 'memory-index.json',
  calendar: 'calendar.json',
  team: 'team.json',
} as const

type SidecarKey = keyof typeof ALLOWED

export const Route = createFileRoute('/api/cc-sidecars')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const fileKey = url.searchParams.get('file') as SidecarKey | null
        if (!fileKey || !(fileKey in ALLOWED)) {
          return json(
            {
              ok: false,
              error:
                'missing or unknown ?file= (allowed: memory, calendar, team)',
            },
            { status: 400 },
          )
        }
        const fileName = ALLOWED[fileKey]
        // Try cwd-relative first (dev server in os/dashboard-clawsuite/),
        // then walk up to the monorepo root. The first hit wins.
        const tries = [
          path.resolve(
            process.cwd(),
            '..',
            '..',
            'artifacts-panel',
            '_data',
            fileName,
          ),
          path.resolve(process.cwd(), 'artifacts-panel', '_data', fileName),
          path.resolve(
            process.cwd(),
            '..',
            'artifacts-panel',
            '_data',
            fileName,
          ),
        ]
        for (const p of tries) {
          try {
            const raw = await fs.readFile(p, 'utf-8')
            const data: unknown = JSON.parse(raw)
            return json({ ok: true, file: fileKey, path: p, data })
          } catch {
            // try next candidate path
          }
        }
        return json(
          {
            ok: false,
            error: `sidecar ${fileName} not found in any of ${tries.join(' | ')}`,
          },
          { status: 404 },
        )
      },
    },
  },
})
