// HubSpot API client. Resolves a valid bearer token (OAuth access_token,
// auto-refreshed when expired; or a static HUBSPOT_API_KEY private-app token
// as fallback) and exposes callHubSpot<T>(). Never logs token values; all
// upstream error bodies pass through maskApiKeys() and are truncated.
//
// `_`-prefixed so TanStack Router does not treat it as a route.

import { maskApiKeys } from '@/server/_redact'
import { readToken, writeToken } from '@/server/hubspot-oauth-store'
import {
  isExpired,
  refreshOAuthToken,
  type OAuthToken,
} from '@/server/oauth-token-store'

const HUBSPOT_API_BASE = 'https://api.hubapi.com'
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token'

export type HubSpotResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number }

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.HUBSPOT_CLIENT_ID
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function staticFallback(): string | null {
  const staticKey = process.env.HUBSPOT_API_KEY
  return staticKey && staticKey.length > 0 ? staticKey : null
}

// Coalesce concurrent refreshes. Without this, two requests that both observe
// an expired token would each refresh + writeToken, racing writes (TOCTOU) on
// the token file and producing stale-write 401 bursts.
let refreshInFlight: Promise<string | null> | null = null

async function resolveExpiredToken(token: OAuthToken): Promise<string | null> {
  const creds = clientCreds()
  if (token.refresh_token && creds) {
    const refreshed = await refreshOAuthToken(
      { tokenUrl: TOKEN_URL, ...creds },
      token.refresh_token,
    )
    if (refreshed) {
      const expiresInSec = refreshed.expires_in ?? 1800
      writeToken({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? token.refresh_token,
        expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
        scope: refreshed.scope ?? token.scope,
        obtained_at: new Date().toISOString(),
      })
      return refreshed.access_token
    }
  }
  // refresh impossible/failed — fall through to static key
  return staticFallback()
}

/**
 * Return a valid bearer token, refreshing the OAuth token if it's expired.
 * Falls back to a static HUBSPOT_API_KEY when no OAuth token is stored.
 * Returns null when neither is available ("not connected").
 */
async function getAccessToken(): Promise<string | null> {
  const token = readToken()
  if (token && !isExpired(token)) return token.access_token
  if (!token) return staticFallback()
  // expired token — share a single in-flight refresh across concurrent callers
  if (!refreshInFlight) {
    refreshInFlight = resolveExpiredToken(token).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export async function callHubSpot<T>(
  path: string,
  init?: RequestInit,
): Promise<HubSpotResult<T>> {
  const accessToken = await getAccessToken()
  if (!accessToken) return { ok: false, error: 'HubSpot not connected' }

  let res: Response
  try {
    res = await fetch(`${HUBSPOT_API_BASE}${path}`, {
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
    return { ok: false, error: 'invalid JSON from HubSpot' }
  }
}
