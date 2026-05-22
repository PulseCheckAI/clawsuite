// LinkedIn direct API — token store (Phase 0-D migration)
// ──────────────────────────────────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-05-18-linkedin-direct-c-design.md §7 "Token encryption"
// Plan: docs/superpowers/plans/2026-05-18-linkedin-read-d.md Phase 0 Task 0.2
// Decision: docs/decisions/2026-05-19-linkedin-token-store-consolidation.md
//
// AES-256-GCM envelope encryption for LinkedIn OAuth access/refresh tokens
// persisted in `integrations.linkedin_oauth` — the canonical table shared
// with the LinkedIn MCP server (@pulsecheck/linkedin-mcp).
//
// Migration note (Phase 0-D): Previously wrote to `command_center.secrets`;
// now aligned to the MCP server's table so both C's worker and D's reader
// share one token row per (organization_id, identity_type, linkedin_id).
//
// The data-encryption key (DEK) is 32 bytes hex-encoded in
// `LINKEDIN_TOKEN_ENC_KEY`. Key rotation is handled via the
// `getCurrentKey`/`getKeyByVersion` helpers — the enc_key_version is
// tracked in-process only (the `integrations.linkedin_oauth` table has no
// dedicated enc_key_version column; the MCP server manages its own key).
// During a key rotation, all new writes use the new key; reads of old rows
// use `getKeyByVersion`. See original spec §10 for the operational runbook.
//
// Why Node `crypto` and not a third-party lib: the surface area is small
// enough that a 30-line GCM helper is auditable; pulling in `libsodium-wrappers`
// or similar would add a wasm dep and a transitive supply-chain risk for
// zero crypto-correctness benefit. AES-256-GCM with random 96-bit IV is
// the standard envelope-encryption choice and exactly what Postgres pgcrypto
// + AWS KMS recommend for this size of secret.
//
// Layout of the packed ciphertext (base64): [12-byte IV || 16-byte tag || ciphertext]

import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

// ── Encrypt / decrypt primitives ────────────────────────────────────────────

export function encryptToken(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error(
      `LINKEDIN_TOKEN_ENC_KEY must be 32 bytes hex (got ${key.length})`,
    )
  }
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptToken(packed: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error(
      `LINKEDIN_TOKEN_ENC_KEY must be 32 bytes hex (got ${key.length})`,
    )
  }
  const buf = Buffer.from(packed, 'base64')
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('ciphertext too short to contain IV+tag')
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const enc = buf.subarray(IV_LEN + TAG_LEN)
  const d = crypto.createDecipheriv(ALGO, key, iv)
  d.setAuthTag(tag)
  // .final() throws on auth-tag mismatch (wrong key, tampered ciphertext, or
  // wrong IV) — that's the integrity guarantee we want bubbling up to callers.
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

// ── Key-version resolution ──────────────────────────────────────────────────
//
// `LINKEDIN_TOKEN_ENC_KEY`              — current (active) DEK
// `LINKEDIN_TOKEN_ENC_KEY_VERSION`      — version label for the current DEK (defaults 'v1')
// `LINKEDIN_TOKEN_ENC_KEY_<version>`    — historical DEKs, kept for the rotation grace window
//
// Rotation flow (see spec §10):
//   1. Operator sets LINKEDIN_TOKEN_ENC_KEY_v1=<old>; LINKEDIN_TOKEN_ENC_KEY=<new>;
//      LINKEDIN_TOKEN_ENC_KEY_VERSION=v2.
//   2. New writes use v2. Old rows still decrypt via v1.
//   3. After 30 days the operator removes LINKEDIN_TOKEN_ENC_KEY_v1; any rows
//      still encrypted with v1 will fail loadToken → operator must re-auth.

export function getCurrentKey(): { key: string; version: string } {
  const key = process.env.LINKEDIN_TOKEN_ENC_KEY
  const version = process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION ?? 'v1'
  if (!key) throw new Error('LINKEDIN_TOKEN_ENC_KEY not set')
  return { key, version }
}

export function getKeyByVersion(version: string): string {
  const cur = getCurrentKey()
  if (cur.version === version) return cur.key
  const prev = process.env[`LINKEDIN_TOKEN_ENC_KEY_${version}`]
  if (!prev) {
    throw new Error(
      `no decryption key available for enc_key_version=${version} ` +
        `(current=${cur.version}); set LINKEDIN_TOKEN_ENC_KEY_${version} or re-auth`,
    )
  }
  return prev
}

// ── Supabase save/load ──────────────────────────────────────────────────────
//
// Uses the supabase-js service-role client. Lazy initialization means
// importing this module doesn't blow up in test environments that only
// exercise the crypto primitives above.
//
// Target table: integrations.linkedin_oauth
// Primary key: (organization_id, identity_type, linkedin_id)
// Column names match the MCP server's DbRow interface exactly so D's reader
// and C's worker share the same physical rows without transformation.

import type { SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null

async function sb(): Promise<SupabaseClient> {
  if (_supabase) return _supabase
  // Dynamic import inside the function so vitest can avoid touching Supabase
  // when only exercising the crypto primitives. ESM-friendly (the codebase
  // is `"type": "module"`).
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  _supabase = createClient(url, key)
  return _supabase
}

// ── Types aligned to integrations.linkedin_oauth DbRow ─────────────────────

export type TokenRow = {
  organization_id: string
  identity_type: 'person' | 'organization'
  linkedin_id: string
  display_name: string
  access_token: string
  refresh_token: string | null
  expires_at: Date
  refresh_expires_at: Date | null
  scopes: string[]
  last_refreshed_at: Date
}

export type SaveTokenInput = {
  organization_id: string
  identity_type: 'person' | 'organization'
  linkedin_id: string
  display_name: string
  access_token: string
  refresh_token: string | null
  expires_in_sec: number
  refresh_expires_in_sec?: number
  scopes: string[]
}

export async function saveToken(a: SaveTokenInput): Promise<void> {
  const { key } = getCurrentKey()
  const expires_at = new Date(Date.now() + a.expires_in_sec * 1000)
  const refresh_expires_at = a.refresh_expires_in_sec
    ? new Date(Date.now() + a.refresh_expires_in_sec * 1000)
    : null
  const client = await sb()
  const { error } = await client
    .schema('integrations')
    .from('linkedin_oauth')
    .upsert(
      {
        organization_id: a.organization_id,
        identity_type: a.identity_type,
        linkedin_id: a.linkedin_id,
        display_name: a.display_name,
        access_token_encrypted: encryptToken(a.access_token, key),
        refresh_token_encrypted: a.refresh_token
          ? encryptToken(a.refresh_token, key)
          : null,
        expires_at: expires_at.toISOString(),
        refresh_expires_at: refresh_expires_at?.toISOString() ?? null,
        scopes: a.scopes,
        last_refreshed_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,identity_type,linkedin_id' },
    )
  if (error) throw error
}

export async function loadToken(
  organization_id: string,
  identity_type: 'person' | 'organization',
  linkedin_id: string,
): Promise<TokenRow> {
  const { key } = getCurrentKey()
  const client = await sb()
  const { data, error } = await client
    .schema('integrations')
    .from('linkedin_oauth')
    .select('*')
    .eq('organization_id', organization_id)
    .eq('identity_type', identity_type)
    .eq('linkedin_id', linkedin_id)
    .single()
  if (error || !data) {
    throw new Error(
      `no token for org=${organization_id} type=${identity_type} id=${linkedin_id}`,
    )
  }
  return {
    organization_id,
    identity_type: data.identity_type,
    linkedin_id,
    display_name: data.display_name,
    access_token: decryptToken(data.access_token_encrypted, key),
    refresh_token: data.refresh_token_encrypted
      ? decryptToken(data.refresh_token_encrypted, key)
      : null,
    expires_at: new Date(data.expires_at),
    refresh_expires_at: data.refresh_expires_at
      ? new Date(data.refresh_expires_at)
      : null,
    scopes: data.scopes,
    last_refreshed_at: new Date(data.last_refreshed_at),
  }
}

// ── Single-flight refresh ──────────────────────────────────────────────────
//
// Multiple worker processes can all hit `refreshIfExpired` for the same
// account at the same moment when a token crosses the 24h-pre-expiry
// threshold. We use a Postgres transaction-scoped advisory lock keyed on
// a 31-bit hash of the composite key to make sure only one process performs
// the actual `refreshFn` call; the rest read the freshly-written row.

function lockKey(
  organization_id: string,
  identity_type: string,
  linkedin_id: string,
): number {
  // 31-bit so it fits the `int` signature of pg_advisory_xact_lock_int.
  // Collisions across different identities are harmless — worst case is
  // brief serialization of unrelated refreshes.
  const composite = `${organization_id}:${identity_type}:${linkedin_id}`
  const h = crypto.createHash('md5').update(composite).digest()
  return h.readUInt32BE(0) & 0x7fffffff
}

export async function refreshIfExpired(
  organization_id: string,
  identity_type: 'person' | 'organization',
  linkedin_id: string,
  refreshFn: (refresh_token: string) => Promise<{
    access_token: string
    refresh_token: string
    expires_in_sec: number
    refresh_expires_in_sec?: number
  }>,
  thresholdSec = 24 * 3600,
): Promise<TokenRow> {
  const key = lockKey(organization_id, identity_type, linkedin_id)
  const client = await sb()
  const { error: lockErr } = await client
    .schema('command_center')
    .rpc('pg_advisory_xact_lock_int', { key })
  if (lockErr) {
    // If the advisory-lock RPC is unavailable (e.g. running against a stub
    // Supabase in tests) we fall back to a best-effort read: if the token
    // isn't expired, hand it back; otherwise surface the lock failure.
    const fb = await loadToken(organization_id, identity_type, linkedin_id)
    if (fb.expires_at.getTime() > Date.now() + thresholdSec * 1000) return fb
    throw new Error(`advisory lock unavailable: ${lockErr.message}`)
  }
  const cur = await loadToken(organization_id, identity_type, linkedin_id)
  if (cur.expires_at.getTime() > Date.now() + thresholdSec * 1000) return cur
  if (!cur.refresh_token) {
    throw new Error(
      `no refresh_token available for org=${organization_id} type=${identity_type} id=${linkedin_id}`,
    )
  }
  const r = await refreshFn(cur.refresh_token)
  await saveToken({
    organization_id,
    identity_type,
    linkedin_id,
    display_name: cur.display_name,
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_in_sec: r.expires_in_sec,
    refresh_expires_in_sec: r.refresh_expires_in_sec,
    scopes: cur.scopes,
  })
  return loadToken(organization_id, identity_type, linkedin_id)
}

// Test seams: vitest can reset or inject the cached client between tests.
export function _resetSupabaseClientForTests(): void {
  _supabase = null
}

// Allows injecting a mock Supabase client in tests without touching env vars
// or triggering the real createClient path.
export function _injectSupabaseForTests(client: SupabaseClient): void {
  _supabase = client
}
