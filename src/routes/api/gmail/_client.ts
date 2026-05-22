// Gmail API client. Resolves a valid OAuth bearer token (auto-refreshed when
// expired) and exposes callGmail<T>(). Gmail has no static-key path — it is
// OAuth-only — so null means "not connected". Never logs token values; all
// upstream error bodies pass through maskApiKeys() and are truncated.
//
// `_`-prefixed so TanStack Router does not treat it as a route.

import { maskApiKeys } from '@/server/_redact'
import { readToken, writeToken } from '@/server/gmail-oauth-store'
import {
  isExpired,
  refreshOAuthToken,
  type OAuthToken,
} from '@/server/oauth-token-store'

const GMAIL_API_BASE = 'https://gmail.googleapis.com'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export type GmailResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number }

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

// Coalesce concurrent refreshes. Without this, two requests that both observe
// an expired token would each refresh + writeToken, racing writes (TOCTOU) on
// the token file and producing stale-write 401 bursts.
let refreshInFlight: Promise<string | null> | null = null

async function resolveExpiredToken(token: OAuthToken): Promise<string | null> {
  const creds = clientCreds()
  if (!token.refresh_token || !creds) return null
  const refreshed = await refreshOAuthToken(
    { tokenUrl: TOKEN_URL, ...creds },
    token.refresh_token,
  )
  if (!refreshed) return null
  const expiresInSec = refreshed.expires_in ?? 3600
  writeToken({
    access_token: refreshed.access_token,
    // Google omits refresh_token on refresh — keep the existing one.
    refresh_token: refreshed.refresh_token ?? token.refresh_token,
    expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    scope: refreshed.scope ?? token.scope,
    obtained_at: new Date().toISOString(),
  })
  return refreshed.access_token
}

async function getAccessToken(): Promise<string | null> {
  const token = readToken()
  if (!token) return null
  if (!isExpired(token)) return token.access_token
  // expired token — share a single in-flight refresh across concurrent callers
  if (!refreshInFlight) {
    refreshInFlight = resolveExpiredToken(token).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export async function callGmail<T>(
  path: string,
  init?: RequestInit,
): Promise<GmailResult<T>> {
  const accessToken = await getAccessToken()
  if (!accessToken) return { ok: false, error: 'Gmail not connected' }

  let res: Response
  try {
    res = await fetch(`${GMAIL_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    })
  } catch (err) {
    return {
      ok: false,
      error: maskApiKeys(
        err instanceof Error ? err.message : String(err),
      ).slice(0, 200),
    }
  }

  const body = await res.text().catch(() => '')
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: maskApiKeys(body).slice(0, 200) || `HTTP ${res.status}`,
    }
  }
  try {
    return { ok: true, data: JSON.parse(body) as T }
  } catch {
    return { ok: false, error: 'invalid JSON from Gmail' }
  }
}
