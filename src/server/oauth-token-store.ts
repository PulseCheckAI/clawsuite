// Generic file-backed OAuth2 token store for EXPIRING-token providers
// (HubSpot, Gmail). Postiz has its own store because Postiz Cloud tokens do
// not expire — see postiz-oauth-store.ts. Do not merge the two.
//
// Each provider gets its own JSON file under `<project root>/data/`, mode 0600,
// gitignored. The store validates shape on read and never throws — callers
// treat null as "not connected".
//
// Token shape (validated on read):
//   {
//     "access_token":  "…",                  // bearer token
//     "refresh_token": "…" | null,           // used to mint a new access_token
//     "expires_at":    "2026-05-20T16:30:00Z", // ISO; when access_token dies
//     "scope":         "scope.a scope.b" | null,
//     "obtained_at":   "2026-05-20T16:00:00Z"  // ISO of last successful exchange
//   }
//
// HARD RULE: never log or surface access_token / refresh_token values. Status
// endpoints return metadata only (scope, expires_at, obtained_at).

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface OAuthToken {
  access_token: string
  refresh_token: string | null
  expires_at: string
  scope: string | null
  obtained_at: string
}

export interface OAuthTokenStore {
  read: () => OAuthToken | null
  write: (token: OAuthToken) => void
  delete: () => void
  isConnected: () => boolean
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Build a token store backed by a JSON file. `filename` lands under
 * `<cwd>/data/`; `pathEnvVar` lets operators override the absolute path (handy
 * when the dev server runs with a different cwd than PM2's pinned one).
 */
export function createOAuthTokenStore(opts: {
  filename: string
  pathEnvVar: string
}): OAuthTokenStore {
  function getStorePath(): string {
    const override = process.env[opts.pathEnvVar]
    if (override && override.length > 0) return resolve(override)
    return resolve(process.cwd(), 'data', opts.filename)
  }

  function read(): OAuthToken | null {
    let raw: string
    try {
      raw = readFileSync(getStorePath(), 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    if (!isPlainObject(parsed)) return null
    const access_token = str(parsed.access_token)
    const expires_at = str(parsed.expires_at)
    const obtained_at = str(parsed.obtained_at)
    if (!access_token || !expires_at || !obtained_at) return null
    return {
      access_token,
      refresh_token: str(parsed.refresh_token),
      expires_at,
      scope: str(parsed.scope),
      obtained_at,
    }
  }

  function write(token: OAuthToken): void {
    const path = getStorePath()
    mkdirSync(dirname(path), { recursive: true })
    // mode 0600 is honored on Linux; ignored on Windows (NTFS ACLs already
    // restrict to the running user). Best-effort sync write — not atomic.
    writeFileSync(path, JSON.stringify(token, null, 2) + '\n', {
      mode: 0o600,
      encoding: 'utf8',
    })
  }

  function del(): void {
    try {
      unlinkSync(getStorePath())
    } catch {
      // already gone — nothing to do
    }
  }

  return {
    read,
    write,
    delete: del,
    isConnected: () => read() !== null,
  }
}

/**
 * True if the token is within `skewSeconds` of expiry (default 60s of clock
 * skew / latency headroom). Callers refresh when this returns true.
 */
export function isExpired(token: OAuthToken, skewSeconds = 60): boolean {
  const expMs = new Date(token.expires_at).getTime()
  if (!Number.isFinite(expMs)) return true
  return Date.now() >= expMs - skewSeconds * 1000
}

export interface RefreshConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
}

export interface RefreshResult {
  access_token: string
  refresh_token: string | null
  expires_in: number | null
  scope: string | null
}

/**
 * Exchange a refresh_token for a fresh access_token. Works for any provider
 * that accepts the standard form-urlencoded refresh_token grant (HubSpot and
 * Google both do). Returns null on any failure — callers treat that as
 * "connection lost, user must reconnect". NEVER logs token values.
 */
export async function refreshOAuthToken(
  cfg: RefreshConfig,
  refreshToken: string,
): Promise<RefreshResult | null> {
  let res: Response
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  const access_token = str(parsed.access_token)
  if (!access_token) return null
  return {
    access_token,
    refresh_token: str(parsed.refresh_token),
    expires_in:
      typeof parsed.expires_in === 'number' ? parsed.expires_in : null,
    scope: str(parsed.scope),
  }
}
