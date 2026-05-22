// Postiz Cloud OAuth2 — access-token store.
//
// Postiz Cloud OAuth tokens (`pos_...`) don't expire per
// https://docs.postiz.com/public-api/oauth — one successful exchange is
// enough until the user clicks Disconnect. We persist the result of the
// /oauth/token exchange to a gitignored JSON file so the dashboard can keep
// using it across PM2 restarts without re-auth.
//
// File location: `<project root>/data/postiz-oauth.json`, mode 0600.
// `data/` must be in .gitignore (it is — see os/dashboard-clawsuite/.gitignore).
//
// Token shape (validated on read — never trust the file blindly):
//   {
//     "access_token":     "pos_aBcDeFg…",     // Postiz Cloud API token
//     "organization_id":  "org_abc123",       // Postiz org the token belongs to
//     "cus":              "cus_…" | null,     // Stripe customer ID (optional)
//     "obtained_at":      "2026-05-19T16:00:00Z"  // ISO timestamp
//   }
//
// Callers:
//   src/routes/api/postiz/_client.ts                — reads access_token to set Authorization
//   src/routes/api/postiz/oauth.callback.ts         — writes after a successful exchange
//   src/routes/api/postiz/oauth.status.ts           — reads metadata for the UI status card
//   src/routes/api/postiz/oauth.ts (DELETE)         — deletes on user "Disconnect"
//
// HARD RULE: never log or surface the access_token value. The UI status
// endpoint returns metadata only (organization_id, cus, obtained_at).

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface PostizOAuthToken {
  access_token: string
  organization_id: string
  cus: string | null
  obtained_at: string
}

// Resolved relative to process.cwd() — PM2 runs the dashboard with cwd
// pinned to os/dashboard-clawsuite, so this lands at
// os/dashboard-clawsuite/data/postiz-oauth.json. If you're running the
// dev server with a different cwd, set POSTIZ_OAUTH_TOKEN_PATH to override.
function getStorePath(): string {
  const override = process.env.POSTIZ_OAUTH_TOKEN_PATH
  if (override && override.length > 0) return resolve(override)
  return resolve(process.cwd(), 'data', 'postiz-oauth.json')
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Read the persisted token. Returns null if the file doesn't exist, can't
 * be parsed, or fails shape validation. Never throws — every call site
 * treats null as "not connected".
 */
export function readToken(): PostizOAuthToken | null {
  const path = getStorePath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
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
  const access_token =
    typeof parsed.access_token === 'string' && parsed.access_token.length > 0
      ? parsed.access_token
      : null
  const organization_id =
    typeof parsed.organization_id === 'string' &&
    parsed.organization_id.length > 0
      ? parsed.organization_id
      : null
  const obtained_at =
    typeof parsed.obtained_at === 'string' && parsed.obtained_at.length > 0
      ? parsed.obtained_at
      : null
  if (!access_token || !organization_id || !obtained_at) return null
  const cus =
    typeof parsed.cus === 'string' && parsed.cus.length > 0 ? parsed.cus : null
  return { access_token, organization_id, cus, obtained_at }
}

/**
 * Persist a token. Creates the parent directory if needed. File mode 0600
 * so other local users can't read the token off disk.
 *
 * Best-effort sync write — NOT atomic. If the process dies mid-write the
 * file may be truncated; recover by deleting it and re-running the OAuth
 * flow (the next /oauth/callback exchange writes a fresh complete copy).
 */
export function writeToken(token: PostizOAuthToken): void {
  const path = getStorePath()
  mkdirSync(dirname(path), { recursive: true })
  // Use writeFileSync with mode — Node's posix mode bits are ignored on
  // Windows, which is fine: NTFS ACLs already restrict access to the
  // running user. On Linux this gives us 0600.
  writeFileSync(path, JSON.stringify(token, null, 2) + '\n', {
    mode: 0o600,
    encoding: 'utf8',
  })
}

/**
 * Delete the persisted token (user clicked Disconnect, or callback errored
 * out and we want to reset to a clean state). No-op if the file is already
 * missing.
 */
export function deleteToken(): void {
  const path = getStorePath()
  try {
    unlinkSync(path)
  } catch {
    // File didn't exist or couldn't be removed — nothing to do.
  }
}

export function isConnected(): boolean {
  return readToken() !== null
}
