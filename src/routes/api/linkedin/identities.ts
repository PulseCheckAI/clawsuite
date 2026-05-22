// LinkedIn module — list authenticated identities from the encrypted vault.
// GET /api/linkedin/identities
//
// Returns metadata only (display_name, scopes, expires_at, last_refreshed_at,
// identity_type, linkedin_id). NEVER returns access_token_encrypted or
// refresh_token_encrypted — those stay inside integrations.linkedin_oauth and
// are only decrypted by the MCP server when making LinkedIn API calls.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getLinkedInSupabase } from '@/server/linkedin-supabase'

interface IdentityRow {
  identity_type: 'person' | 'organization'
  linkedin_id: string
  display_name: string
  scopes: string[]
  expires_at: string
  refresh_expires_at: string | null
  last_refreshed_at: string
  organization_id: string
}

export const Route = createFileRoute('/api/linkedin/identities')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const supabase = await getLinkedInSupabase()
          const { data, error } = await supabase
            .schema('integrations')
            .from('linkedin_oauth')
            .select(
              'identity_type, linkedin_id, display_name, scopes, expires_at, refresh_expires_at, last_refreshed_at, organization_id',
            )
            .order('last_refreshed_at', { ascending: false })

          if (error) {
            return json(
              { ok: false, error: error.message, identities: [] },
              { status: 503 },
            )
          }

          return json({
            ok: true,
            identities: (data ?? []) as IdentityRow[],
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              identities: [],
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
