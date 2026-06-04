// ── /api/gateway/rpc — read-only Gateway RPC console backend ──────────────────
// Exposes a SAFE, read-only subset of the OpenClaw Gateway WebSocket RPC catalog
// for the System > RPC Console surface. Mutating methods are NOT allowlisted, so
// this console can inspect but never change gateway state. Gated by the dashboard
// perimeter (isAuthenticated).
//   GET  -> { ok, methods }        the allowlist
//   POST { method, params? } -> { ok, method, ts, result }
// ──────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { isAuthenticated } from '@/server/auth-middleware'
import { gatewayRpc } from '@/server/gateway'
import { requireJsonContentType } from '@/server/rate-limit'

// Read-only / inspect methods only. Anything that mutates (config.set/apply,
// send, exec.approval.resolve, node.invoke, cron.add, …) is intentionally absent.
const READONLY_METHODS = [
  'health',
  'status',
  'diagnostics.stability',
  'gateway.identity.get',
  'system-presence',
  'last-heartbeat',
  'models.list',
  'usage.status',
  'usage.cost',
  'channels.status',
  'sessions.list',
  'cron.list',
  'commands.list',
  'tools.catalog',
  'tools.effective',
  'skills.status',
  'node.list',
  'agents.list',
  'config.get',
  'config.schema',
] as const

const allow = new Set<string>(READONLY_METHODS)

const Schema = z.object({
  method: z.string().max(120),
  params: z.unknown().optional(),
})

export const Route = createFileRoute('/api/gateway/rpc')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, methods: READONLY_METHODS })
      },
      POST: async ({ request }) => {
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const raw = await request.json().catch(() => ({}))
        const parsed = Schema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        if (!allow.has(parsed.data.method)) {
          return json(
            {
              ok: false,
              error: `Method not allowed in the read-only console: ${parsed.data.method}`,
            },
            { status: 403 },
          )
        }
        try {
          const result = await gatewayRpc(
            parsed.data.method,
            parsed.data.params,
          )
          return json({
            ok: true,
            method: parsed.data.method,
            ts: Date.now(),
            result,
          })
        } catch (e) {
          return json(
            {
              ok: false,
              method: parsed.data.method,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 502 },
          )
        }
      },
    },
  },
})
