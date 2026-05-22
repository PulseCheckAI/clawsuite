// ── Supabase client singleton ──────────────────────────────────────────────
// Browser-side client used by the Mission Control dashboard to subscribe to
// realtime postgres_changes on command_center.{todos, agent_logs, autonomy_stats}.
//
// Project-scoped publishable key — same one the dashboard already uses for
// REST reads. The command_center tables ship `FOR ALL USING (true)` RLS
// policies (per the tutorial spec + autonomy_stats migration) so the
// publishable key can subscribe + read.
//
// HMR-safe via globalThis cache so React Fast Refresh doesn't spin up
// duplicate WebSocket connections on every save.
// ───────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-constants'

const KEY = '__pulseos_supabase_client__' as const
declare global {
  // eslint-disable-next-line no-var
  var __pulseos_supabase_client__: SupabaseClient | undefined
}

export function getSupabaseClient(): SupabaseClient {
  const existing = (globalThis as any)[KEY] as SupabaseClient | undefined
  if (existing) return existing
  // No `db.schema` constraint at the client level — realtime channel
  // listeners pass schema per subscription ({ schema: 'command_center' }
  // on each .on('postgres_changes', …)), and we don't use .from() queries
  // from this client. Constraining the schema generic at construction
  // narrows the return type and breaks the SupabaseClient default-export
  // alias used by callers.
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 5 } },
  })
  ;(globalThis as any)[KEY] = client
  return client
}
