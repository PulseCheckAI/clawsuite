// HubSpot — recent contacts.  GET /api/hubspot/contacts
// Returns the latest contacts via the CRM v3 API. Honest empty/disconnected
// states — never fabricated rows.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { callHubSpot } from './_client'

interface HubSpotContactRaw {
  id: string
  properties?: {
    email?: string | null
    firstname?: string | null
    lastname?: string | null
    company?: string | null
    createdate?: string | null
  }
}
interface HubSpotContactsPage {
  results?: HubSpotContactRaw[]
}

export interface HubSpotContact {
  id: string
  email: string | null
  name: string | null
  company: string | null
  createdAt: string | null
}

export const Route = createFileRoute('/api/hubspot/contacts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const result = await callHubSpot<HubSpotContactsPage>(
          '/crm/v3/objects/contacts?limit=20&properties=email,firstname,lastname,company,createdate&archived=false',
        )
        if (!result.ok) {
          // 200 with ok:false so the UI can render a connect/empty state
          // instead of throwing — mirrors the Postiz analytics contract.
          return json({
            ok: false,
            connected: false,
            error: result.error,
            contacts: [],
          })
        }

        const contacts: HubSpotContact[] = (result.data.results ?? []).map(
          (c) => {
            const p = c.properties ?? {}
            const name =
              [p.firstname, p.lastname].filter(Boolean).join(' ').trim() || null
            return {
              id: c.id,
              email: p.email ?? null,
              name,
              company: p.company ?? null,
              createdAt: p.createdate ?? null,
            }
          },
        )

        return json({ ok: true, connected: true, contacts })
      },
    },
  },
})
