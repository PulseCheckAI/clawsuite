// Sub-project D Phase 4 — worker health + queue depth endpoint.
// GET /api/linkedin/status

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAuthenticated } from '@/server/auth-middleware'
import { getLinkedInSupabase } from '@/server/linkedin-supabase'

const __dirname_resolved =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(
  __dirname_resolved,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
)
const HEARTBEAT_PATH = path.join(
  REPO_ROOT,
  'artifacts-panel',
  '_data',
  'linkedin-worker-status.json',
)

const STALE_MS = 120_000
const OFFLINE_MS = 600_000

interface HeartbeatPayload {
  updated_at: string
  loop_started_at: string
  jobs_claimed_total: number
  jobs_processed_total: number
  jobs_failed_total: number
  last_poll_completed_at: string | null
  current_pending_count: number | null
  last_error: string | null
}

async function readHeartbeat(): Promise<HeartbeatPayload | null> {
  try {
    const raw = await readFile(HEARTBEAT_PATH, 'utf-8')
    return JSON.parse(raw) as HeartbeatPayload
  } catch {
    return null
  }
}

function classifyStatus(
  heartbeat: HeartbeatPayload | null,
): 'online' | 'stale' | 'offline' {
  if (!heartbeat) return 'offline'
  const ageMs = Date.now() - new Date(heartbeat.updated_at).getTime()
  if (ageMs < STALE_MS) return 'online'
  if (ageMs < OFFLINE_MS) return 'stale'
  return 'offline'
}

export const Route = createFileRoute('/api/linkedin/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const heartbeat = await readHeartbeat()
        const status = classifyStatus(heartbeat)

        try {
          const supabase = await getLinkedInSupabase()
          const { count: pendingCount } = await supabase
            .schema('command_center')
            .from('linkedin_read_schedule')
            .select('schedule_id', { count: 'exact', head: true })
            .lte('next_poll_at', new Date().toISOString())
            .neq('age_bucket', 'stop')

          const { count: erroredCount } = await supabase
            .schema('command_center')
            .from('linkedin_read_schedule')
            .select('schedule_id', { count: 'exact', head: true })
            .gt('consecutive_errors', 0)

          const { data: oldestRow } = await supabase
            .schema('command_center')
            .from('linkedin_read_schedule')
            .select('next_poll_at')
            .neq('age_bucket', 'stop')
            .order('next_poll_at', { ascending: true })
            .limit(1)

          return json({
            ok: true,
            status,
            heartbeat,
            queue: {
              pending: pendingCount ?? 0,
              errored: erroredCount ?? 0,
              oldest_next_poll_at:
                (oldestRow?.[0]?.next_poll_at as string | undefined) ?? null,
            },
          })
        } catch (err) {
          return json({
            ok: true,
            status,
            heartbeat,
            queue: {
              pending: null,
              errored: null,
              oldest_next_poll_at: null,
              error: err instanceof Error ? err.message : String(err),
            },
          })
        }
      },
    },
  },
})
