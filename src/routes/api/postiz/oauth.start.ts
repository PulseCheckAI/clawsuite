// Postiz Cloud OAuth2 — start handler.
// GET /api/postiz/oauth/start
//
// Generates an HMAC-signed state token, sets it in an HttpOnly cookie scoped
// to /api/postiz/oauth, and redirects the browser to the Postiz authorize
// endpoint. The callback handler validates the cookie matches the state
// returned by Postiz before exchanging the code.
//
// Per https://docs.postiz.com — authorize URL accepts client_id,
// response_type, state. No redirect_uri here: the redirect URI registered
// with the Postiz app at provisioning time is used server-side.
//
// Env vars (referenced by NAME only — values are never logged):
//   POSTIZ_CLOUD_CLIENT_ID       — required, OAuth client id
//   POSTIZ_CLOUD_REDIRECT_URI    — required, must match the URI registered with Postiz
//   POSTIZ_CLOUD_AUTHORIZE_URL   — optional, defaults to https://platform.postiz.com/oauth/authorize
//   POSTIZ_CLOUD_STATE_SECRET    — optional, dedicated HMAC key for the state cookie.
//                                  Falls back to CLAWSUITE_PASSWORD (already required in
//                                  production by src/server/auth-middleware.ts). Either
//                                  must be set or the flow refuses to start.

import { createHmac, randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const DEFAULT_AUTHORIZE_URL = 'https://platform.postiz.com/oauth/authorize'
const STATE_COOKIE_NAME = 'postiz_oauth_state'
const STATE_COOKIE_MAX_AGE_SECONDS = 600

function buildStateCookie(value: string): string {
  const isProd = process.env.NODE_ENV === 'production'
  const attrs = [
    `${STATE_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/postiz/oauth',
    `Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}`,
  ]
  if (isProd) attrs.push('Secure')
  return attrs.join('; ')
}

export const Route = createFileRoute('/api/postiz/oauth/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const clientId = process.env.POSTIZ_CLOUD_CLIENT_ID
        if (!clientId || clientId.length === 0) {
          return json(
            { ok: false, error: 'POSTIZ_CLOUD_CLIENT_ID missing' },
            { status: 500 },
          )
        }

        const redirectUri = process.env.POSTIZ_CLOUD_REDIRECT_URI
        if (!redirectUri || redirectUri.length === 0) {
          // Read but only validated for presence — the redirect URI is not
          // sent on the authorize URL (Postiz uses the URI registered with
          // the app server-side). Refuse to start without it configured so
          // operators don't get a confusing callback failure later.
          return json(
            { ok: false, error: 'POSTIZ_CLOUD_REDIRECT_URI missing' },
            { status: 500 },
          )
        }

        // HMAC secret for the state cookie. Prefer the dedicated
        // POSTIZ_CLOUD_STATE_SECRET; fall back to CLAWSUITE_PASSWORD which is
        // already required in production by src/server/auth-middleware.ts so
        // operators don't need to add a new env var just for this flow.
        const stateSecret =
          process.env.POSTIZ_CLOUD_STATE_SECRET ||
          process.env.CLAWSUITE_PASSWORD
        if (!stateSecret || stateSecret.length === 0) {
          return json(
            {
              ok: false,
              error:
                'No HMAC secret for OAuth state cookie. Set POSTIZ_CLOUD_STATE_SECRET (preferred) or CLAWSUITE_PASSWORD.',
            },
            { status: 500 },
          )
        }

        const authorizeUrl =
          process.env.POSTIZ_CLOUD_AUTHORIZE_URL &&
          process.env.POSTIZ_CLOUD_AUTHORIZE_URL.length > 0
            ? process.env.POSTIZ_CLOUD_AUTHORIZE_URL
            : DEFAULT_AUTHORIZE_URL

        const state = randomBytes(16).toString('hex')
        const mac = createHmac('sha256', stateSecret)
          .update(state)
          .digest('hex')
        const cookieValue = `${state}.${mac}`

        const target =
          `${authorizeUrl}?client_id=${encodeURIComponent(clientId)}` +
          `&response_type=code` +
          `&state=${encodeURIComponent(state)}`

        return new Response(null, {
          status: 302,
          headers: {
            Location: target,
            'Set-Cookie': buildStateCookie(cookieValue),
          },
        })
      },
    },
  },
})
