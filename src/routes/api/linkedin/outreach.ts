// LinkedIn Outreach API — the review-queue engine.
//   GET  /api/linkedin/outreach[?status=draft]   → list queue items
//   POST /api/linkedin/outreach                   → { action: 'generate' | 'update', ... }
//     generate: { action:'generate', limit?:number }  → discover→resolve→draft→queue
//     update:   { action:'update', id, patch:{ connection_note?, dm_message?,
//                 person_name?, person_title?, linkedin_url?, status? } }
//
// Sending is intentionally NOT here — it's gated on Linked API (linkedin-cli).
// This route only discovers, drafts, and manages the review queue.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '@/server/rate-limit'
import { redactError } from '@/server/_redact'
import {
  generateQueue,
  listQueue,
  updateItem,
  type OutreachStatus,
} from '@/server/linkedin-outreach'

interface PostBody {
  action?: string
  limit?: number
  id?: string
  patch?: {
    connection_note?: string
    dm_message?: string
    person_name?: string
    person_title?: string
    linkedin_url?: string
    status?: OutreachStatus
  }
}

export const Route = createFileRoute('/api/linkedin/outreach')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const status = new URL(request.url).searchParams.get('status')
          const items = await listQueue(
            status ? { status: status as OutreachStatus } : undefined,
          )
          return json({ ok: true, items })
        } catch (err) {
          return json({ ok: false, error: redactError(err) }, { status: 500 })
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        if (
          !rateLimit(`linkedin-outreach:${getClientIp(request)}`, 20, 60_000)
        ) {
          return rateLimitResponse()
        }

        let body: PostBody
        try {
          body = (await request.json()) as PostBody
        } catch (err) {
          return json(
            { ok: false, error: `Invalid JSON body: ${redactError(err)}` },
            { status: 400 },
          )
        }

        try {
          if (body.action === 'generate') {
            const res = await generateQueue({
              limit: typeof body.limit === 'number' ? body.limit : undefined,
              createdBy: 'dashboard',
            })
            return json({ ok: true, ...res })
          }
          if (body.action === 'update') {
            if (typeof body.id !== 'string') {
              return json(
                { ok: false, error: 'id is required' },
                { status: 400 },
              )
            }
            const item = await updateItem(body.id, body.patch ?? {})
            return json({ ok: true, item })
          }
          return json(
            { ok: false, error: `unknown action: ${String(body.action)}` },
            { status: 400 },
          )
        } catch (err) {
          return json({ ok: false, error: redactError(err) }, { status: 500 })
        }
      },
    },
  },
})
