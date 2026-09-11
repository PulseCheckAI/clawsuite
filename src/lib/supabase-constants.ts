// ── Supabase constants — single source of truth ────────────────────────────
//
// The dashboard, the autonomy loop, and any future Supabase consumer should
// import the URL + publishable key from here, NOT inline literal copies. Three
// callsites previously hardcoded the same key (src/lib/supabase-client.ts,
// src/server/autonomy-loop.ts, src/screens/mission-control/mission-control-screen.tsx),
// which made rotation a three-file scavenger hunt and normalized hardcoding
// for future contributors.
//
// Security boundary: this is a Supabase PUBLISHABLE key, not service_role.
// It's safe to ship to browsers because the underlying tables (`command_center.*`)
// have row-level security enabled. The current RLS policy is `FOR ALL USING (true)`
// — local-only file:// desktop posture. To lock down for cloud, change those
// policies; the key shape doesn't need to.
//
// To rotate: change `SUPABASE_PUBLISHABLE_KEY` here, restart the dev server.
// All three callsites pick up the new value on next request.
// ────────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL = 'https://zcjgjfersccwwhjmaflw.supabase.co'

export const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_krMU4pMkUZQNQT9bbO68jw_IahpZoEd'

// Convenience for REST callers that want the standard PostgREST headers
// shape against the command_center schema. Used by the server-side autonomy
// loop. Browser-side callers using @supabase/supabase-js don't need this.
export function commandCenterHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Accept-Profile': 'command_center',
    'Content-Profile': 'command_center',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}
