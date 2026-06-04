// ── /api/voice-engine/grok-token ───────────────────────────────────────────
// Browser-facing proxy → grok-voice-agent token server (uvicorn on
// http://127.0.0.1:8220). The XAI_API_KEY never leaves the backend; the
// browser only sees the short-lived ephemeral session token (good ~300s),
// which it uses as `xai-client-secret.<token>` WS subprotocol.
//
// Why a proxy at all? Two reasons:
//   1. The token server is gated by `Authorization: Bearer DASHBOARD_AUTH_SECRET`
//      — the secret stays in pm2 / .env, never the browser.
//   2. We re-use the existing dashboard session cookie (isAuthenticated) so
//      only signed-in operators can mint xAI ephemerals against our quota.
//
// Mirror of hume-token.ts (same auth / proxy shape, different upstream port).
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const DEFAULT_TOKEN_SERVER_URL = 'http://127.0.0.1:8220'

function tokenServerUrl(): string {
  const raw = process.env.XAI_TOKEN_SERVER_URL?.trim()
  return raw && raw.length > 0
    ? raw.replace(/\/$/, '')
    : DEFAULT_TOKEN_SERVER_URL
}

function dashboardAuthSecret(): string | undefined {
  return process.env.DASHBOARD_AUTH_SECRET?.trim() || undefined
}

export const Route = createFileRoute('/api/voice-engine/grok-token')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const secret = dashboardAuthSecret()
        if (!secret) {
          // Fail loud — a missing secret means we'd be sending unauth'd
          // requests at the token server, which itself fails closed.
          return json(
            {
              ok: false,
              error:
                'DASHBOARD_AUTH_SECRET not set on dashboard — cannot reach xAI token server',
            },
            { status: 503 },
          )
        }

        const upstream = new URL('/token', tokenServerUrl())

        let res: Response
        try {
          res = await fetch(upstream.toString(), {
            method: 'GET',
            headers: { Authorization: `Bearer ${secret}` },
            // 10s — xAI ephemeral mint is normally <1s; if the token server
            // is wedged we surface that fast.
            signal: AbortSignal.timeout(10_000),
          })
        } catch (e) {
          return json(
            {
              ok: false,
              error: `xai token server unreachable: ${
                e instanceof Error ? e.message : String(e)
              }`,
            },
            { status: 502 },
          )
        }

        const body = (await res.json().catch(() => null)) as {
          client_secret?: string
          expires_in?: number
          model?: string
          voice?: string
          instructions?: string
          session_defaults?: Record<string, unknown>
          detail?: string
        } | null

        if (!res.ok || !body || !body.client_secret) {
          return json(
            {
              ok: false,
              error: body?.detail ?? `xai token server returned ${res.status}`,
            },
            { status: res.status },
          )
        }

        return json({
          ok: true,
          client_secret: body.client_secret,
          expires_in: body.expires_in ?? null,
          model: body.model ?? 'grok-voice-latest',
          voice: body.voice ?? 'Eve',
          instructions: body.instructions ?? '',
          session_defaults: body.session_defaults ?? {},
        })
      },
    },
  },
})
