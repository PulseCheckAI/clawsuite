// LinkedIn module — kick off OAuth flow via the running LinkedIn MCP.
// POST /api/linkedin/auth/start
// Body: { identity_type: 'person' | 'organization' }
//
// Calls the pm2-managed MCP at http://127.0.0.1:8120/mcp via JSON-RPC
// (tools/call linkedin_authenticate) and returns the LinkedIn authorization
// URL. Frontend opens the URL in a new tab; LinkedIn redirects back to the
// MCP's own /oauth/callback handler (NOT this route) on consent.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const MCP_URL = process.env.LINKEDIN_MCP_URL ?? 'http://127.0.0.1:8120/mcp'

interface AuthenticatePayload {
  authorization_url: string
  state: string
  expires_in_seconds: number
  scopes: string[]
  next_steps: string[]
}

function parseSseLine(line: string): unknown | null {
  // The MCP streamable-HTTP transport returns `event: message\ndata: {...}`.
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  try {
    return JSON.parse(trimmed.slice('data:'.length).trim())
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/linkedin/auth/start')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let body: { identity_type?: unknown } = {}
        try {
          body = (await request.json()) as { identity_type?: unknown }
        } catch {
          // empty body is fine; default to person
        }
        const identityType =
          body.identity_type === 'organization' ? 'organization' : 'person'

        const rpcBody = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: 'linkedin_authenticate',
            arguments: { identity_type: identityType },
          },
        }

        let mcpResponse: Response
        try {
          mcpResponse = await fetch(MCP_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify(rpcBody),
            signal: AbortSignal.timeout(15_000),
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: `MCP unreachable at ${MCP_URL}: ${err instanceof Error ? err.message : String(err)}`,
              hint: 'Is pulseos-linkedin-mcp running with MCP_TRANSPORT=http on port 8120?',
            },
            { status: 502 },
          )
        }

        if (!mcpResponse.ok) {
          const text = await mcpResponse.text().catch(() => '')
          return json(
            {
              ok: false,
              error: `MCP returned HTTP ${mcpResponse.status}`,
              body: text.slice(0, 500),
            },
            { status: 502 },
          )
        }

        const raw = await mcpResponse.text()
        let envelope: unknown = null
        for (const line of raw.split(/\r?\n/)) {
          const parsed = parseSseLine(line)
          if (parsed) {
            envelope = parsed
            break
          }
        }
        if (!envelope) {
          try {
            envelope = JSON.parse(raw)
          } catch {
            // leave as null
          }
        }

        if (!envelope || typeof envelope !== 'object') {
          return json(
            {
              ok: false,
              error: 'MCP returned unparseable response',
              raw_preview: raw.slice(0, 500),
            },
            { status: 502 },
          )
        }

        const env = envelope as {
          error?: { code: number; message: string }
          result?: {
            content?: Array<{ type: string; text: string }>
            isError?: boolean
          }
        }
        if (env.error) {
          return json(
            { ok: false, error: env.error.message, code: env.error.code },
            { status: 502 },
          )
        }
        const text = env.result?.content?.[0]?.text
        if (!text) {
          return json(
            { ok: false, error: 'MCP response missing content[0].text' },
            { status: 502 },
          )
        }

        let inner: {
          ok: boolean
          data?: AuthenticatePayload
          error?: { code: string; message: string }
        }
        try {
          inner = JSON.parse(text)
        } catch (err) {
          return json(
            {
              ok: false,
              error: `Failed to parse MCP tool result: ${err instanceof Error ? err.message : String(err)}`,
              text_preview: text.slice(0, 500),
            },
            { status: 502 },
          )
        }

        if (!inner.ok || !inner.data) {
          return json(
            {
              ok: false,
              error: inner.error?.message ?? 'MCP tool returned ok=false',
              code: inner.error?.code,
            },
            { status: 502 },
          )
        }

        return json({
          ok: true,
          identity_type: identityType,
          authorization_url: inner.data.authorization_url,
          scopes: inner.data.scopes,
          expires_in_seconds: inner.data.expires_in_seconds,
        })
      },
    },
  },
})
