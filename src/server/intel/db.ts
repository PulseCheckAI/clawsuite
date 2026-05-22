// Server-only Supabase admin client for the intel.* schema.
// Service-role key bypasses RLS — /api/intel/* routes are the trust boundary.
// Singleton; mirrors src/server/linkedin-supabase.ts.

import { config as loadDotenv } from 'dotenv'
import type { SupabaseClient } from '@supabase/supabase-js'

// override: true so the dashboard .env wins over a frozen pm2-daemon env
// (same rationale as linkedin-supabase.ts).
loadDotenv({ override: true })

let _db: SupabaseClient | null = null

export async function getIntelDb(): Promise<SupabaseClient> {
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
  // Cast: db.schema:'intel' narrows the SupabaseClient generic away from the
  // default 'public' shape; we keep the loose default type at compile time
  // (runtime stays bound to the intel schema). Stores cast their own results.
  _db = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: 'intel' },
  }) as unknown as SupabaseClient
  return _db
}

export function _injectIntelDbForTests(client: SupabaseClient | null): void {
  _db = client
}
