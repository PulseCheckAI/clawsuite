// Server-only Supabase admin client for the MarginOps schemas (gold / platinum /
// governance). Service-role bypasses RLS — the GraphQL resolver enforces the
// tenant scope (organizationId) EXPLICITLY on every query. Mirrors intel/db.ts.
//
// gold + platinum are PostgREST-exposed (verified in pgrst.db_schemas), so
// supabase-js can read them directly — same access path as the intel layer.

import { config as loadDotenv } from 'dotenv'
import type { SupabaseClient } from '@supabase/supabase-js'

// override: true so the dashboard .env wins over a frozen pm2-daemon env
// (same rationale as intel/db.ts).
loadDotenv({ override: true })

export type MarginSchema = 'gold' | 'platinum' | 'governance'

// One cached client per schema (supabase-js binds a single schema per client).
const _clients = new Map<MarginSchema, SupabaseClient>()

export async function getMarginDb(
  schema: MarginSchema,
): Promise<SupabaseClient> {
  const cached = _clients.get(schema)
  if (cached) return cached
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEYS ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY) must be set',
    )
  }
  const client = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema },
  }) as unknown as SupabaseClient
  _clients.set(schema, client)
  return client
}

export function _injectMarginDbForTests(
  schema: MarginSchema,
  client: SupabaseClient | null,
): void {
  if (client) _clients.set(schema, client)
  else _clients.delete(schema)
}
