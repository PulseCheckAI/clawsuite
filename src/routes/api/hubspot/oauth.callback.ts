// HubSpot OAuth2 — callback handler.  GET /api/hubspot/oauth/callback
//
// 1. Validate the HMAC-signed state cookie (set by oauth.start).
// 2. Exchange `code` for tokens at the HubSpot token endpoint (form-urlencoded,
//    redirect_uri REQUIRED).
// 3. Persist {access_token, refresh_token, expires_at} via writeToken().
// 4. Redirect to /hubspot?connected=1 or /hubspot?error=<fixed-code>.
//
// HARD RULE: never put access_token / refresh_token / code / client_secret in
// any response body, log line, or redirect URL. Upstream bodies are logged
// server-side through maskApiKeys(); redirects carry fixed error codes only.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { maskApiKeys } from '@/server/_redact'
import { writeToken } from '@/server/hubspot-oauth-store'

const DEFAULT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token'
const STATE_COOKIE_NAME = 'hubspot_oauth_state'
const STATE_COOKIE_PATH = '/api/hubspot/oauth'

function clearStateCookie(): string {
  return `${STATE_COOKIE_NAME}=; Max-Age=0; Path=${STATE_COOKIE_PATH}`
}

function readStateCookie(
  cookieHeader: string | null,
): { state: string; mac: string } | null {
  if (!cookieHeader) return null
  for (const entry of cookieHeader.split(';').map((c) => c.trim())) {
    if (!entry.startsWith(`${STATE_COOKIE_NAME}=`)) continue
    const value = entry.slice(STATE_COOKIE_NAME.length + 1)
    const lastDot = value.lastIndexOf('.')
    if (lastDot <= 0 || lastDot >= value.length - 1) return null
    return { state: value.slice(0, lastDot), mac: value.slice(lastDot + 1) }
  }
  return null
}

function redirectTo(path: string, extraSetCookie?: string): Response {
  const headers: Record<string, string> = { Location: path }
  if (extraSetCookie) headers['Set-Cookie'] = extraSetCookie
  return new Response(null, { status: 302, headers })
}

interface HubSpotTokenResponseRaw {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

export const Route = createFileRoute('/api/hubspot/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
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
        const clientId = process.env.HUBSPOT_CLIENT_ID
        const clientSecret = process.env.HUBSPOT_CLIENT_SECRET
        const redirectUri = process.env.HUBSPOT_REDIRECT_URI
        if (!clientId || !clientSecret || !redirectUri) {
          return json(
            {
              ok: false,
              error:
                'HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, and HUBSPOT_REDIRECT_URI are required',
            },
            { status: 500 },
          )
        }
        const tokenUrl =
          process.env.HUBSPOT_TOKEN_URL &&
          process.env.HUBSPOT_TOKEN_URL.length > 0
            ? process.env.HUBSPOT_TOKEN_URL
            : DEFAULT_TOKEN_URL

        const url = new URL(request.url)
        const queryCode = url.searchParams.get('code')
        const queryState = url.searchParams.get('state')
        const queryError = url.searchParams.get('error')

        // SECURITY: verify state on EVERY path (incl. ?error=) before honoring
        // the error branch, so a forged callback can't clear an in-flight cookie.
        const cookieParts = readStateCookie(request.headers.get('cookie'))
        if (!cookieParts || !queryState) {
          return redirectTo('/hubspot?error=state_mismatch', clearStateCookie())
        }
        let macOk = false
        try {
          const expected = createHmac('sha256', stateSecret)
            .update(cookieParts.state)
            .digest('hex')
          const a = Buffer.from(cookieParts.mac, 'hex')
          const b = Buffer.from(expected, 'hex')
          if (a.length === b.length && a.length > 0)
            macOk = timingSafeEqual(a, b)
        } catch {
          macOk = false
        }
        if (!macOk || cookieParts.state !== queryState) {
          return redirectTo('/hubspot?error=state_mismatch', clearStateCookie())
        }

        if (queryError === 'access_denied') {
          return redirectTo('/hubspot?error=access_denied', clearStateCookie())
        }
        if (!queryCode) {
          return redirectTo('/hubspot?error=missing_code', clearStateCookie())
        }

        let response: Response
        try {
          response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              code: queryCode,
            }).toString(),
            signal: AbortSignal.timeout(30_000),
          })
        } catch (err) {
          console.error(
            '[hubspot-oauth-callback] token exchange network error:',
            maskApiKeys(err instanceof Error ? err.message : String(err)).slice(
              0,
              500,
            ),
          )
          return redirectTo(
            '/hubspot?error=exchange_unreachable',
            clearStateCookie(),
          )
        }

        const rawBody = await response.text().catch(() => '')
        if (!response.ok) {
          console.error('[hubspot-oauth-callback] token exchange non-2xx', {
            status: response.status,
            body: maskApiKeys(rawBody).slice(0, 500),
          })
          return redirectTo(
            '/hubspot?error=exchange_failed',
            clearStateCookie(),
          )
        }

        let parsed: HubSpotTokenResponseRaw
        try {
          parsed = JSON.parse(rawBody) as HubSpotTokenResponseRaw
        } catch {
          return redirectTo(
            '/hubspot?error=invalid_token_response',
            clearStateCookie(),
          )
        }

        const accessToken =
          typeof parsed.access_token === 'string' &&
          parsed.access_token.length > 0
            ? parsed.access_token
            : null
        if (!accessToken) {
          return redirectTo(
            '/hubspot?error=invalid_token_response',
            clearStateCookie(),
          )
        }
        const refreshToken =
          typeof parsed.refresh_token === 'string' &&
          parsed.refresh_token.length > 0
            ? parsed.refresh_token
            : null
        const expiresInSec =
          typeof parsed.expires_in === 'number' ? parsed.expires_in : 1800

        try {
          writeToken({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: new Date(
              Date.now() + expiresInSec * 1000,
            ).toISOString(),
            scope: null,
            obtained_at: new Date().toISOString(),
          })
        } catch (err) {
          // Log the masked detail server-side ONLY — never leak a filesystem
          // path (e.g. EACCES on the token file) into the redirect URL.
          console.error(
            '[hubspot-oauth-callback] token persist failed:',
            maskApiKeys(err instanceof Error ? err.message : String(err)).slice(
              0,
              500,
            ),
          )
          return redirectTo('/hubspot?error=persist_failed', clearStateCookie())
        }

        return redirectTo('/hubspot?connected=1', clearStateCookie())
      },
    },
  },
})
