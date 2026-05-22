// CRUD for intel content sources.
//   GET    /api/intel/sources          → list
//   POST   /api/intel/sources          → create { label, kind, route_or_url, folder?, interest_weight?, enabled? }
//   PUT    /api/intel/sources          → update { id, ...patch }
//   DELETE /api/intel/sources?id=...    → remove

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  createSource,
  deleteSource,
  listSources,
  updateSource,
} from '@/server/intel/sources-store'
import type { SourceKind } from '@/server/intel/types'

const KINDS: SourceKind[] = ['rsshub', 'rss', 'email']

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export const Route = createFileRoute('/api/intel/sources')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        return json({ ok: true, sources: await listSources() })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }
        const label = typeof body.label === 'string' ? body.label.trim() : ''
        const kind = body.kind as SourceKind
        const routeOrUrl =
          typeof body.route_or_url === 'string' ? body.route_or_url.trim() : ''
        if (!label || !KINDS.includes(kind) || !routeOrUrl)
          return json(
            {
              ok: false,
              error: 'label, kind (rsshub|rss|email), route_or_url required',
            },
            { status: 400 },
          )
        if (kind === 'rss' && !isHttpUrl(routeOrUrl))
          return json(
            {
              ok: false,
              error: 'rss source route_or_url must be an http(s) URL',
            },
            { status: 400 },
          )
        const source = await createSource({
          label,
          kind,
          route_or_url: routeOrUrl,
          folder: typeof body.folder === 'string' ? body.folder : null,
          interest_weight:
            typeof body.interest_weight === 'number'
              ? body.interest_weight
              : undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        })
        return json({ ok: true, source })
      },

      PUT: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }
        const id = typeof body.id === 'string' ? body.id : ''
        if (!id)
          return json({ ok: false, error: 'id required' }, { status: 400 })
        const { id: _omit, ...patch } = body
        const source = await updateSource(id, patch as never)
        return json({ ok: true, source })
      },

      DELETE: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const id = new URL(request.url).searchParams.get('id') ?? ''
        if (!id)
          return json({ ok: false, error: 'id required' }, { status: 400 })
        await deleteSource(id)
        return json({ ok: true })
      },
    },
  },
})
