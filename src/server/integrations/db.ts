// Server-only Supabase admin client for the integrations.* schema.
// Service-role bypasses RLS — the Integration Hub is an internal command-center
// surface that shows ALL connections + the full catalog. Mirrors intel/db.ts.
//
// integrations.* is PostgREST-exposed (verified in pgrst.db_schemas), so
// supabase-js reads it directly — same access path as the intel + margin layers.

import { config as loadDotenv } from 'dotenv'
import type { SupabaseClient } from '@supabase/supabase-js'

loadDotenv({ override: true })

let _db: SupabaseClient | null = null

export async function getIntegrationsDb(): Promise<SupabaseClient> {
  if (_db) return _db
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEYS ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY) must be set',
    )
  }
  _db = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: 'integrations' },
  }) as unknown as SupabaseClient
  return _db
}

export function _injectIntegrationsDbForTests(
  client: SupabaseClient | null,
): void {
  _db = client
}
