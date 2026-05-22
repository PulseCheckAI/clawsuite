// Gmail (Google) OAuth2 — start handler.  GET /api/gmail/oauth/start
//
// HMAC-signed state cookie + 302 to Google's authorize endpoint.
// access_type=offline + prompt=consent are REQUIRED to receive a refresh_token.
//
// Env (referenced by NAME only):
//   GMAIL_CLIENT_ID     — required
//   GMAIL_REDIRECT_URI  — required, must match the Google app's redirect
//   GMAIL_SCOPE         — optional; defaults to gmail.readonly
//   GMAIL_AUTHORIZE_URL — optional; defaults to Google's v2 auth endpoint
//   GMAIL_STATE_SECRET  — optional HMAC key; falls back to CLAWSUITE_PASSWORD

import { createHmac, randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const DEFAULT_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const STATE_COOKIE_NAME = 'gmail_oauth_state'
const STATE_COOKIE_MAX_AGE_SECONDS = 600

function buildStateCookie(value: string): string {
  const attrs = [
    `${STATE_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/gmail/oauth',
    `Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}`,
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

export const Route = createFileRoute('/api/gmail/oauth/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const clientId = process.env.GMAIL_CLIENT_ID
        if (!clientId) {
          return json(
            { ok: false, error: 'GMAIL_CLIENT_ID missing' },
            { status: 500 },
          )
        }
        const redirectUri = process.env.GMAIL_REDIRECT_URI
        if (!redirectUri) {
          return json(
            { ok: false, error: 'GMAIL_REDIRECT_URI missing' },
            { status: 500 },
          )
        }
        const stateSecret =
          process.env.GMAIL_STATE_SECRET || process.env.CLAWSUITE_PASSWORD
        if (!stateSecret) {
          return json(
            {
              ok: false,
              error:
                'No HMAC secret for OAuth state cookie. Set GMAIL_STATE_SECRET (preferred) or CLAWSUITE_PASSWORD.',
            },
            { status: 500 },
          )
        }

        const scope =
          process.env.GMAIL_SCOPE && process.env.GMAIL_SCOPE.length > 0
            ? process.env.GMAIL_SCOPE
            : DEFAULT_SCOPE
        const authorizeUrl =
          process.env.GMAIL_AUTHORIZE_URL &&
          process.env.GMAIL_AUTHORIZE_URL.length > 0
            ? process.env.GMAIL_AUTHORIZE_URL
            : DEFAULT_AUTHORIZE_URL

        const state = randomBytes(16).toString('hex')
        const mac = createHmac('sha256', stateSecret)
          .update(state)
          .digest('hex')
        const cookieValue = `${state}.${mac}`

        const target =
          `${authorizeUrl}?client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(scope)}` +
          `&access_type=offline` +
          `&prompt=consent` +
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
