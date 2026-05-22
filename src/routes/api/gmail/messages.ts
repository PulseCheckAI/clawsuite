// Gmail — recent messages.  GET /api/gmail/messages
// Lists recent message IDs then fetches metadata (Subject/From/Date) for each,
// bounded to MAX_DETAIL to cap the fanout. Honest empty/disconnected states.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { callGmail } from './_client'

const MAX_DETAIL = 10

interface GmailListResp {
  messages?: Array<{ id: string; threadId?: string }>
}
interface GmailMessageRaw {
  id: string
  snippet?: string
  payload?: { headers?: Array<{ name: string; value: string }> }
}

export interface GmailMessage {
  id: string
  subject: string | null
  from: string | null
  date: string | null
  snippet: string | null
}

function header(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string | null {
  if (!headers) return null
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? null
}

export const Route = createFileRoute('/api/gmail/messages')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const list = await callGmail<GmailListResp>(
          `/gmail/v1/users/me/messages?maxResults=${MAX_DETAIL}`,
        )
        if (!list.ok) {
          return json({
            ok: false,
            connected: false,
            error: list.error,
            messages: [],
          })
        }

        const ids = (list.data.messages ?? []).slice(0, MAX_DETAIL)
        const details = await Promise.all(
          ids.map((m) =>
            callGmail<GmailMessageRaw>(
              `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            ),
          ),
        )

        const messages: GmailMessage[] = details
          .filter((d): d is { ok: true; data: GmailMessageRaw } => d.ok)
          .map((d) => ({
            id: d.data.id,
            subject: header(d.data.payload?.headers, 'Subject'),
            from: header(d.data.payload?.headers, 'From'),
            date: header(d.data.payload?.headers, 'Date'),
            snippet: d.data.snippet ?? null,
          }))

        return json({ ok: true, connected: true, messages })
      },
    },
  },
})
