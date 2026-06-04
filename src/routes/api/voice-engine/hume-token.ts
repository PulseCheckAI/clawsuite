// ── /api/voice-engine/hume-token ────────────────────────────────────────────
// Browser-facing proxy → hume-evi-agent token server (uvicorn on
// http://127.0.0.1:8210). The Hume API key + secret never leave the backend;
// the browser only sees the short-lived EVI access token (good ~30 min).
//
// Why a proxy at all? Two reasons:
//   1. The token server is gated by `Authorization: Bearer DASHBOARD_AUTH_SECRET`
//      — the secret stays in pm2 / .env, never the browser.
//   2. We re-use the existing dashboard session cookie (isAuthenticated) so
//      only signed-in operators can mint EVI tokens against our quota.
//
// Optional `person_id` query param is forwarded through. When present, the
// token server fetches that person's behavioral DNA via H3's memory_brief
// module and returns it as `dynamic_variables` so the React `<VoiceProvider>`
// can pass it to Hume on connect.
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const DEFAULT_TOKEN_SERVER_URL = 'http://127.0.0.1:8210'

function tokenServerUrl(): string {
  const raw = process.env.HUME_TOKEN_SERVER_URL?.trim()
  return raw && raw.length > 0
    ? raw.replace(/\/$/, '')
    : DEFAULT_TOKEN_SERVER_URL
}

function dashboardAuthSecret(): string | undefined {
  return process.env.DASHBOARD_AUTH_SECRET?.trim() || undefined
}

export const Route = createFileRoute('/api/voice-engine/hume-token')({
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
                'DASHBOARD_AUTH_SECRET not set on dashboard — cannot reach Hume token server',
            },
            { status: 503 },
          )
        }

        const url = new URL(request.url)
        const personId = url.searchParams.get('person_id')?.trim() || ''
        const upstream = new URL('/token', tokenServerUrl())
        if (personId) {
          upstream.searchParams.set('person_id', personId)
        }

        let res: Response
        try {
          res = await fetch(upstream.toString(), {
            method: 'GET',
            headers: { Authorization: `Bearer ${secret}` },
            // 10s — Hume mint is normally <1s; if the token server is wedged
            // we want to surface that fast, not stall the dashboard route.
            signal: AbortSignal.timeout(10_000),
          })
        } catch (e) {
          return json(
            {
              ok: false,
              error: `hume token server unreachable: ${
                e instanceof Error ? e.message : String(e)
              }`,
            },
            { status: 502 },
          )
        }

        const body = (await res.json().catch(() => null)) as {
          access_token?: string
          expires_in?: number
          config_id?: string
          dynamic_variables?: Record<string, unknown>
          detail?: string
        } | null

        if (!res.ok || !body || !body.access_token) {
          return json(
            {
              ok: false,
              error: body?.detail ?? `hume token server returned ${res.status}`,
            },
            { status: res.status },
          )
        }

        return json({
          ok: true,
          access_token: body.access_token,
          expires_in: body.expires_in ?? null,
          config_id: body.config_id ?? null,
          dynamic_variables: body.dynamic_variables ?? null,
        })
      },
    },
  },
})
