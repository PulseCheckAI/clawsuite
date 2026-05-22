// Postiz Cloud OAuth2 — callback handler.
// GET /api/postiz/oauth/callback
//
// Postiz redirects the browser here after the user authorizes (or denies)
// the app on platform.postiz.com. We:
//   1. Validate the HMAC-signed state cookie (set by oauth.start).
//   2. Exchange the `code` for an access token at POSTIZ_CLOUD_TOKEN_URL.
//   3. Persist the token via writeToken() so subsequent Postiz API calls
//      pick it up from postiz-oauth-store.
//   4. Redirect the browser to /postiz with a success or error flag.
//
// HARD RULE: this handler must NEVER include access_token, code, or
// client_secret in any response body or log line. Errors echo upstream
// bodies only after running through maskApiKeys() and truncating to 200
// chars in the query string.
//
// Env vars (referenced by NAME only — values are never logged):
//   POSTIZ_CLOUD_CLIENT_ID       — required
//   POSTIZ_CLOUD_CLIENT_SECRET   — required
//   POSTIZ_CLOUD_TOKEN_URL       — optional, defaults to https://api.postiz.com/oauth/token
//   POSTIZ_CLOUD_STATE_SECRET    — optional, dedicated HMAC key for the state cookie.
//                                  Falls back to CLAWSUITE_PASSWORD (already required in
//                                  production by src/server/auth-middleware.ts). Must
//                                  match the value used by oauth.start.ts.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { maskApiKeys } from '@/server/_redact'
import { writeToken } from '@/server/postiz-oauth-store'

const DEFAULT_TOKEN_URL = 'https://api.postiz.com/oauth/token'
const STATE_COOKIE_NAME = 'postiz_oauth_state'
const STATE_COOKIE_PATH = '/api/postiz/oauth'

function clearStateCookie(): string {
  return `${STATE_COOKIE_NAME}=; Max-Age=0; Path=${STATE_COOKIE_PATH}`
}

function readStateCookie(cookieHeader: string | null): {
  state: string
  mac: string
} | null {
  if (!cookieHeader) return null
  const entries = cookieHeader.split(';').map((c) => c.trim())
  for (const entry of entries) {
    if (!entry.startsWith(`${STATE_COOKIE_NAME}=`)) continue
    const value = entry.slice(STATE_COOKIE_NAME.length + 1)
    // Split on the LAST '.' — the state itself is hex (no dots) but be
    // defensive in case a future change ever embeds dotted segments.
    const lastDot = value.lastIndexOf('.')
    if (lastDot <= 0 || lastDot >= value.length - 1) return null
    return {
      state: value.slice(0, lastDot),
      mac: value.slice(lastDot + 1),
    }
  }
  return null
}

function redirectTo(path: string, extraSetCookie?: string): Response {
  const headers: Record<string, string> = { Location: path }
  if (extraSetCookie) headers['Set-Cookie'] = extraSetCookie
  return new Response(null, { status: 302, headers })
}

interface PostizTokenResponseRaw {
  access_token?: unknown
  id?: unknown
  cus?: unknown
}

export const Route = createFileRoute('/api/postiz/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // HMAC secret. Must match oauth.start.ts — same lookup order.
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

        const clientId = process.env.POSTIZ_CLOUD_CLIENT_ID
        if (!clientId || clientId.length === 0) {
          return json(
            { ok: false, error: 'POSTIZ_CLOUD_CLIENT_ID missing' },
            { status: 500 },
          )
        }

        const clientSecret = process.env.POSTIZ_CLOUD_CLIENT_SECRET
        if (!clientSecret || clientSecret.length === 0) {
          return json(
            { ok: false, error: 'POSTIZ_CLOUD_CLIENT_SECRET missing' },
            { status: 500 },
          )
        }

        const tokenUrl =
          process.env.POSTIZ_CLOUD_TOKEN_URL &&
          process.env.POSTIZ_CLOUD_TOKEN_URL.length > 0
            ? process.env.POSTIZ_CLOUD_TOKEN_URL
            : DEFAULT_TOKEN_URL

        const url = new URL(request.url)
        const queryCode = url.searchParams.get('code')
        const queryState = url.searchParams.get('state')
        const queryError = url.searchParams.get('error')

        // SECURITY: state verification MUST run on every callback path,
        // including ?error=access_denied. Otherwise an attacker can hit the
        // callback with ?error=access_denied and no cookie to clear a victim's
        // legitimate in-flight state cookie. Only AFTER state is verified do
        // we honor the access_denied branch.
        const cookieParts = readStateCookie(request.headers.get('cookie'))
        if (!cookieParts || !queryState) {
          return redirectTo('/postiz?error=state_mismatch', clearStateCookie())
        }

        // Constant-time HMAC compare. timingSafeEqual throws if the two
        // buffers differ in length — wrap the whole comparison.
        let macOk = false
        try {
          const expected = createHmac('sha256', stateSecret)
            .update(cookieParts.state)
            .digest('hex')
          const a = Buffer.from(cookieParts.mac, 'hex')
          const b = Buffer.from(expected, 'hex')
          if (a.length === b.length && a.length > 0) {
            macOk = timingSafeEqual(a, b)
          }
        } catch {
          macOk = false
        }

        if (!macOk || cookieParts.state !== queryState) {
          return redirectTo('/postiz?error=state_mismatch', clearStateCookie())
        }

        // State is now verified — safe to honor user-denied path.
        if (queryError === 'access_denied') {
          return redirectTo('/postiz?error=access_denied', clearStateCookie())
        }

        if (!queryCode || queryCode.length === 0) {
          return redirectTo('/postiz?error=missing_code', clearStateCookie())
        }

        // Exchange code for token. Body intentionally omits redirect_uri —
        // Postiz uses the URI registered with the app at provisioning time.
        let response: Response
        try {
          response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              code: queryCode,
              client_id: clientId,
              client_secret: clientSecret,
            }),
            signal: AbortSignal.timeout(30_000),
          })
        } catch (err) {
          // SECURITY: never echo upstream error messages into the browser-
          // visible redirect URL — Postiz/network errors may contain stack
          // traces, hostnames, or partial creds in formats maskApiKeys()
          // does not yet recognize. Log masked detail server-side; redirect
          // with a fixed code only.
          console.error(
            '[postiz-oauth-callback] token exchange network error:',
            maskApiKeys(err instanceof Error ? err.message : String(err)).slice(
              0,
              500,
            ),
          )
          return redirectTo(
            '/postiz?error=exchange_unreachable',
            clearStateCookie(),
          )
        }

        const rawBody = await response.text().catch(() => '')

        if (!response.ok) {
          // SECURITY: same reasoning as the catch block above — upstream body
          // may include unmasked sensitive data. Log server-side; redirect
          // with a fixed code only.
          console.error(
            '[postiz-oauth-callback] token exchange returned non-2xx',
            {
              status: response.status,
              body: maskApiKeys(rawBody).slice(0, 500),
            },
          )
          return redirectTo('/postiz?error=exchange_failed', clearStateCookie())
        }

        let parsed: PostizTokenResponseRaw
        try {
          parsed = JSON.parse(rawBody) as PostizTokenResponseRaw
        } catch {
          return redirectTo(
            '/postiz?error=invalid_token_response',
            clearStateCookie(),
          )
        }

        const accessToken =
          typeof parsed.access_token === 'string' &&
          parsed.access_token.length > 0
            ? parsed.access_token
            : null
        const organizationId =
          typeof parsed.id === 'string' && parsed.id.length > 0
            ? parsed.id
            : null

        if (!accessToken || !organizationId) {
          // NEVER include parsed values in this redirect — the access token
          // may be present in the parsed body and could leak if echoed.
          return redirectTo(
            '/postiz?error=invalid_token_response',
            clearStateCookie(),
          )
        }

        const cus =
          typeof parsed.cus === 'string' && parsed.cus.length > 0
            ? parsed.cus
            : null

        try {
          writeToken({
            access_token: accessToken,
            organization_id: organizationId,
            cus,
            obtained_at: new Date().toISOString(),
          })
        } catch (err) {
          const msg = maskApiKeys(
            err instanceof Error ? err.message : String(err),
          ).slice(0, 200)
          return redirectTo(
            `/postiz?error=${encodeURIComponent(`persist_failed: ${msg}`)}`,
            clearStateCookie(),
          )
        }

        return redirectTo('/postiz?connected=1', clearStateCookie())
      },
    },
  },
})
