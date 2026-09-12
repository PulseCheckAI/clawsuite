import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isAuthenticated } from '../../server/auth-middleware'
import { SUPABASE_URL } from '../../lib/supabase-constants'

// ── /api/founder-metrics ─────────────────────────────────────────────────────
//
// Server-side proxy for the founder-dashboard RPCs (founder_metrics,
// founder_pipeline_health, founder_dq_alerts, founder_venue_results).
//
// SECURITY (2026-06-12 audit): these are SECURITY DEFINER functions that were
// EXECUTE-grantable to the `anon` role, so anyone with the public publishable
// key could read MRR/ARR, churn, the full prospect funnel, and ETL internals by
// calling the RPCs directly — bypassing any UI login. `anon`/`authenticated`
// EXECUTE has been REVOKED; the functions are now reachable ONLY via
// `service_role`, behind this isAuthenticated() gate.
//
// Authorization model mirrors /api/cc-kv: the dashboard is a founder-only
// surface, so a valid authenticated session IS the founder authorization — no
// per-email allow-list needed. The service-role key is server-only and never
// reaches the browser.
//
// Usage: GET /api/founder-metrics  → { ok, founder_metrics, founder_pipeline_health,
//                                      founder_dq_alerts, founder_venue_results }
// ─────────────────────────────────────────────────────────────────────────────

// Same resolution as src/server/auth-users.ts serviceRoleKey().
function serviceRoleKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEYS ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    undefined
  )
}

let adminClient: SupabaseClient | undefined
function admin(): SupabaseClient {
  if (adminClient) return adminClient
  const key = serviceRoleKey()
  if (!key) throw new Error('service-role key not configured')
  adminClient = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  })
  return adminClient
}

const FOUNDER_RPCS = [
  'founder_metrics',
  'founder_pipeline_health',
  'founder_dq_alerts',
  'founder_venue_results',
] as const

export const Route = createFileRoute('/api/founder-metrics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        if (!serviceRoleKey()) {
          return json(
            { ok: false, error: 'server missing service-role key' },
            { status: 500 },
          )
        }
        try {
          const db = admin()
          const out: Record<string, unknown> = { ok: true }
          for (const fn of FOUNDER_RPCS) {
            const { data, error } = await db.rpc(fn)
            if (error) {
              return json(
                { ok: false, error: `${fn}: ${error.message}` },
                { status: 502 },
              )
            }
            out[fn] = data
          }
          return json(out)
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          return json({ ok: false, error: reason }, { status: 500 })
        }
      },
    },
  },
})
