// HubSpot OAuth2 — start handler.  GET /api/hubspot/oauth/start
//
// Generates an HMAC-signed state token, sets it in an HttpOnly cookie scoped
// to /api/hubspot/oauth, and 302-redirects to the HubSpot authorize endpoint.
// Unlike Postiz, HubSpot REQUIRES redirect_uri and scope on the authorize URL.
//
// Env (referenced by NAME only — values never logged):
//   HUBSPOT_CLIENT_ID      — required
//   HUBSPOT_REDIRECT_URI   — required, must match the app's configured redirect
//   HUBSPOT_SCOPE          — optional, space-delimited; defaults below
//   HUBSPOT_AUTHORIZE_URL  — optional, defaults to https://app.hubspot.com/oauth/authorize
//   HUBSPOT_STATE_SECRET   — optional HMAC key; falls back to CLAWSUITE_PASSWORD

import { createHmac, randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const DEFAULT_AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize'
const DEFAULT_SCOPE = 'oauth crm.objects.contacts.read crm.objects.deals.read'
const STATE_COOKIE_NAME = 'hubspot_oauth_state'
const STATE_COOKIE_MAX_AGE_SECONDS = 600

function buildStateCookie(value: string): string {
  const attrs = [
    `${STATE_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/hubspot/oauth',
    `Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}`,
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

export const Route = createFileRoute('/api/hubspot/oauth/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const clientId = process.env.HUBSPOT_CLIENT_ID
        if (!clientId) {
          return json(
            { ok: false, error: 'HUBSPOT_CLIENT_ID missing' },
            { status: 500 },
          )
        }
        const redirectUri = process.env.HUBSPOT_REDIRECT_URI
        if (!redirectUri) {
          return json(
            { ok: false, error: 'HUBSPOT_REDIRECT_URI missing' },
            { status: 500 },
          )
        }
        const stateSecret =
          process.env.HUBSPOT_STATE_SECRET || process.env.CLAWSUITE_PASSWORD
        if (!stateSecret) {
          return json(
            {
              ok: false,
              error:
                'No HMAC secret for OAuth state cookie. Set HUBSPOT_STATE_SECRET (preferred) or CLAWSUITE_PASSWORD.',
            },
            { status: 500 },
          )
        }

        const scope =
          process.env.HUBSPOT_SCOPE && process.env.HUBSPOT_SCOPE.length > 0
            ? process.env.HUBSPOT_SCOPE
            : DEFAULT_SCOPE
        const authorizeUrl =
          process.env.HUBSPOT_AUTHORIZE_URL &&
          process.env.HUBSPOT_AUTHORIZE_URL.length > 0
            ? process.env.HUBSPOT_AUTHORIZE_URL
            : DEFAULT_AUTHORIZE_URL

        const state = randomBytes(16).toString('hex')
        const mac = createHmac('sha256', stateSecret)
          .update(state)
          .digest('hex')
        const cookieValue = `${state}.${mac}`

        const target =
          `${authorizeUrl}?client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent(scope)}` +
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
