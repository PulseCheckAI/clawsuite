// Sub-project D Phase 4 — Supabase admin client used by /api/linkedin/* routes.
// Service-role key bypasses RLS (UI reads only org-scoped data; the API route
// is the trust boundary).
//
// Singleton — same instance reused across requests.

import { config as loadDotenv } from 'dotenv'
import type { SupabaseClient } from '@supabase/supabase-js'

// override: true so the dashboard's .env wins over a stale pm2-daemon frozen
// env (the daemon captures its parent shell's env at start time and never
// refreshes — rotated SUPABASE_* keys exported into that shell stay frozen
// otherwise, surfacing as "Unregistered API key" on every Supabase call).
loadDotenv({ override: true })

let _supabase: SupabaseClient | null = null

export async function getLinkedInSupabase(): Promise<SupabaseClient> {
  if (_supabase) return _supabase
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL
  // Prefer the new sb_secret_* key, fall back to the legacy service-role JWT.
  // Either is accepted by Supabase — same precedence as the MCP config.
  const key =
    process.env.SUPABASE_SECRET_KEYS ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY) must be set',
    )
  }
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

export function _injectLinkedInSupabaseForTests(
  client: SupabaseClient | null,
): void {
  _supabase = client
}
