// Phase 0 (D) — LinkedIn token store (migrated to integrations.linkedin_oauth)
// ────────────────────────────────────────────────────────────────────────
// Crypto-only tests. No Supabase calls — the save/load/refresh layer in
// linkedin-token-store.ts uses dynamic-import for `@supabase/supabase-js`,
// so importing this module does NOT touch the network or require env vars
// beyond what each test sets explicitly.
//
// Coverage:
//   1. Round-trip: encrypt then decrypt with the same key returns the original
//      plaintext, and the ciphertext doesn't contain the plaintext as a substring.
//   2. Key-version mismatch: a row encrypted under v1 cannot be decrypted with
//      the current v2 key alone; the resolver returns the v1 key when the
//      operator has kept the historical env var, and throws a clear error when
//      they haven't.
//   3. Edge cases: short/empty plaintext, unicode, wrong-length keys, truncated
//      ciphertext, tampered tag — all the things a real key-rotation incident
//      would expose us to if we got this wrong.
//   4. saveToken / loadToken — mocked Supabase client verifies table name is
//      `integrations.linkedin_oauth` and column names match the MCP server's
//      actual DbRow schema (access_token_encrypted, refresh_token_encrypted, etc.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import {
  decryptToken,
  encryptToken,
  getCurrentKey,
  getKeyByVersion,
  saveToken,
  loadToken,
  _resetSupabaseClientForTests,
} from './linkedin-token-store'

const KEY_A = '0'.repeat(64) // 32 bytes hex, all-zero
const KEY_B = '1'.repeat(64) // 32 bytes hex, all-0x11
const KEY_RANDOM = crypto.randomBytes(32).toString('hex')

// Snapshot env vars so we can restore them after each test — vitest doesn't
// reset process.env automatically and we mutate it heavily here.
const ENV_KEYS = [
  'LINKEDIN_TOKEN_ENC_KEY',
  'LINKEDIN_TOKEN_ENC_KEY_VERSION',
  'LINKEDIN_TOKEN_ENC_KEY_v1',
  'LINKEDIN_TOKEN_ENC_KEY_v2',
  'LINKEDIN_TOKEN_ENC_KEY_v3',
]
let envSnapshot: Record<string, string | undefined>

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k]
    else process.env[k] = envSnapshot[k]
  }
})

describe('encryptToken / decryptToken — round-trip', () => {
  it('round-trips a typical LinkedIn access token', () => {
    const plaintext =
      'AQX-fake-linkedin-access-token-' + crypto.randomBytes(32).toString('hex')
    const enc = encryptToken(plaintext, KEY_A)
    expect(enc).not.toContain(plaintext)
    expect(decryptToken(enc, KEY_A)).toBe(plaintext)
  })

  it('round-trips short strings', () => {
    expect(decryptToken(encryptToken('a', KEY_A), KEY_A)).toBe('a')
  })

  it('round-trips empty strings', () => {
    expect(decryptToken(encryptToken('', KEY_A), KEY_A)).toBe('')
  })

  it('round-trips unicode (multi-byte UTF-8)', () => {
    const plaintext =
      'café-úñíçødé-✓-' + crypto.randomBytes(8).toString('hex')
    expect(decryptToken(encryptToken(plaintext, KEY_A), KEY_A)).toBe(plaintext)
  })

  it('produces a different ciphertext each call (random IV)', () => {
    const plaintext = 'same-plaintext'
    const a = encryptToken(plaintext, KEY_A)
    const b = encryptToken(plaintext, KEY_A)
    expect(a).not.toBe(b)
    expect(decryptToken(a, KEY_A)).toBe(plaintext)
    expect(decryptToken(b, KEY_A)).toBe(plaintext)
  })
})

describe('decryptToken — wrong-key + tampering rejection', () => {
  it('throws when decrypted with the wrong key', () => {
    const enc = encryptToken('secret', KEY_A)
    expect(() => decryptToken(enc, KEY_B)).toThrow()
  })

  it('throws when ciphertext is truncated', () => {
    const enc = encryptToken('secret', KEY_A)
    const truncated = Buffer.from(enc, 'base64')
      .subarray(0, 10)
      .toString('base64')
    expect(() => decryptToken(truncated, KEY_A)).toThrow()
  })

  it('throws when GCM auth tag is tampered with', () => {
    const enc = encryptToken('secret', KEY_A)
    const buf = Buffer.from(enc, 'base64')
    // Flip a bit in the tag (bytes 12..28).
    buf[15] = buf[15] ^ 0xff
    expect(() => decryptToken(buf.toString('base64'), KEY_A)).toThrow()
  })

  it('throws on wrong-length key (not 32 bytes)', () => {
    expect(() => encryptToken('x', '00')).toThrow(/32 bytes/)
    expect(() => decryptToken(encryptToken('x', KEY_A), '00')).toThrow(/32 bytes/)
  })
})

describe('getCurrentKey — env-var contract', () => {
  it('throws when LINKEDIN_TOKEN_ENC_KEY is unset', () => {
    expect(() => getCurrentKey()).toThrow(/LINKEDIN_TOKEN_ENC_KEY not set/)
  })

  it('defaults version to v1 when LINKEDIN_TOKEN_ENC_KEY_VERSION is unset', () => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    expect(getCurrentKey()).toEqual({ key: KEY_A, version: 'v1' })
  })

  it('uses LINKEDIN_TOKEN_ENC_KEY_VERSION when set', () => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v3'
    expect(getCurrentKey()).toEqual({ key: KEY_A, version: 'v3' })
  })
})

describe('getKeyByVersion — rotation handling', () => {
  it('returns the current key when version matches', () => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v2'
    expect(getKeyByVersion('v2')).toBe(KEY_A)
  })

  it('returns a historical key when LINKEDIN_TOKEN_ENC_KEY_<version> is set', () => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v2'
    process.env.LINKEDIN_TOKEN_ENC_KEY_v1 = KEY_B
    expect(getKeyByVersion('v1')).toBe(KEY_B)
  })

  it('throws a clear error when the requested version has no env var', () => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v2'
    // No LINKEDIN_TOKEN_ENC_KEY_v1 set — simulates the 30-day grace window
    // having elapsed and the operator dropping the old key.
    expect(() => getKeyByVersion('v1')).toThrow(/no decryption key available/)
    expect(() => getKeyByVersion('v1')).toThrow(/enc_key_version=v1/)
  })
})

describe('key-version rotation — end-to-end', () => {
  it('decrypts v1-era ciphertext after rotating the current key to v2', () => {
    // Pretend it's time T0 and the current key is v1.
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v1'
    const cipherFromV1Era = encryptToken(
      'old-access-token',
      getCurrentKey().key,
    )

    // Operator rotates: new current key is v2 (KEY_B), old key kept as v1.
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_B
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v2'
    process.env.LINKEDIN_TOKEN_ENC_KEY_v1 = KEY_A

    // The loadToken path would call getKeyByVersion('v1') based on the
    // enc_key_version column from the secrets row.
    const v1Key = getKeyByVersion('v1')
    expect(decryptToken(cipherFromV1Era, v1Key)).toBe('old-access-token')

    // A new write under v2 should also round-trip.
    const cipherFromV2 = encryptToken('new-token', getCurrentKey().key)
    expect(decryptToken(cipherFromV2, getKeyByVersion('v2'))).toBe('new-token')

    // Cross-version decrypt MUST fail (we don't want silent fall-through).
    expect(() => decryptToken(cipherFromV1Era, getCurrentKey().key)).toThrow()
    expect(() => decryptToken(cipherFromV2, v1Key)).toThrow()
  })

  it('refuses to decrypt v1 ciphertext after the grace window expires', () => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_RANDOM
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v2'
    // Operator removed LINKEDIN_TOKEN_ENC_KEY_v1 — 30 days have passed.
    expect(() => getKeyByVersion('v1')).toThrow(/v1/)
  })
})

// ── saveToken / loadToken — mocked Supabase integration ──────────────────────
//
// These tests inject a mock Supabase client via the module's exported
// _injectSupabaseForTests seam, avoiding any real network calls.
// They verify:
//   a) saveToken writes to `integrations.linkedin_oauth` (not command_center.secrets)
//   b) Column names match the MCP server's actual DbRow:
//      access_token_encrypted, refresh_token_encrypted, organization_id,
//      identity_type, linkedin_id, display_name, scopes, expires_at
//   c) loadToken decrypts correctly using the stored ciphertext
//   d) loadToken throws when no row is found

import { _injectSupabaseForTests } from './linkedin-token-store'

// Build a fake Supabase client whose chain calls are recorded.
function makeMockClient(
  selectResult: { data: unknown; error: null | { message: string } } = {
    data: null,
    error: null,
  },
  upsertResult: { data: null; error: null | { message: string } } = {
    data: null,
    error: null,
  },
) {
  const upsertMock = vi.fn().mockResolvedValue(upsertResult)
  const singleMock = vi.fn().mockResolvedValue(selectResult)
  const eqMocks: ReturnType<typeof vi.fn>[] = []
  // Chain: .schema('integrations').from('linkedin_oauth').select('*').eq(...).eq(...).eq(...).single()
  const buildEqChain = (terminal: ReturnType<typeof vi.fn>) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: terminal,
      upsert: upsertMock,
    }
    eqMocks.push(chain.eq)
    return chain
  }
  const fromChain = buildEqChain(singleMock)
  const fromMock = vi.fn().mockReturnValue(fromChain)
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock })
  return { client: { schema: schemaMock }, fromMock, fromChain, upsertMock, singleMock }
}

describe('saveToken — writes to integrations.linkedin_oauth', () => {
  beforeEach(() => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v1'
    _resetSupabaseClientForTests()
  })

  afterEach(() => {
    _resetSupabaseClientForTests()
  })

  it('targets integrations.linkedin_oauth (not command_center.secrets)', async () => {
    const { client, fromMock, upsertMock } = makeMockClient()
    _injectSupabaseForTests(client as any)

    await saveToken({
      organization_id: '00000000-0000-0000-0000-000000000001',
      identity_type: 'person',
      linkedin_id: 'urn:li:person:abc123',
      display_name: 'Thiago Costa',
      access_token: 'AQXXXX',
      refresh_token: 'AQYYYY',
      expires_in_sec: 3600,
      scopes: ['r_liteprofile', 'w_member_social'],
    })

    // Must use .schema('integrations').from('linkedin_oauth'), NOT command_center.secrets
    expect(client.schema).toHaveBeenCalledWith('integrations')
    expect(fromMock).toHaveBeenCalledWith('linkedin_oauth')
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('encrypts access_token and refresh_token into _encrypted columns', async () => {
    const { client, upsertMock } = makeMockClient()
    _injectSupabaseForTests(client as any)

    await saveToken({
      organization_id: '00000000-0000-0000-0000-000000000001',
      identity_type: 'person',
      linkedin_id: 'urn:li:person:abc123',
      display_name: 'Thiago Costa',
      access_token: 'AQXXXX',
      refresh_token: 'AQYYYY',
      expires_in_sec: 3600,
      scopes: ['r_liteprofile'],
    })

    const row = upsertMock.mock.calls[0][0] as Record<string, unknown>
    // Column names must match the MCP server's DbRow interface
    expect(row).toHaveProperty('access_token_encrypted')
    expect(row).toHaveProperty('refresh_token_encrypted')
    expect(row).not.toHaveProperty('access_token_enc')
    expect(row).not.toHaveProperty('refresh_token_enc')
    expect(row).not.toHaveProperty('access_token_ct')
    expect(row).not.toHaveProperty('refresh_token_ct')
    // Encrypted values must not equal the plaintext
    expect(row.access_token_encrypted).not.toBe('AQXXXX')
    expect(row.refresh_token_encrypted).not.toBe('AQYYYY')
    // Decrypting should give back the plaintext
    expect(decryptToken(row.access_token_encrypted as string, KEY_A)).toBe('AQXXXX')
    expect(decryptToken(row.refresh_token_encrypted as string, KEY_A)).toBe('AQYYYY')
  })

  it('sets organization_id, identity_type, linkedin_id, display_name correctly', async () => {
    const { client, upsertMock } = makeMockClient()
    _injectSupabaseForTests(client as any)

    await saveToken({
      organization_id: '00000000-0000-0000-0000-000000000002',
      identity_type: 'organization',
      linkedin_id: 'urn:li:organization:9999',
      display_name: 'PulseCheck AI',
      access_token: 'AQXXXX',
      refresh_token: 'AQYYYY',
      expires_in_sec: 3600,
      scopes: ['r_organization_social'],
    })

    const row = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(row.organization_id).toBe('00000000-0000-0000-0000-000000000002')
    expect(row.identity_type).toBe('organization')
    expect(row.linkedin_id).toBe('urn:li:organization:9999')
    expect(row.display_name).toBe('PulseCheck AI')
    // No old provider/account_id fields
    expect(row).not.toHaveProperty('provider')
    expect(row).not.toHaveProperty('account_id')
  })

  it('uses onConflict of organization_id,identity_type,linkedin_id', async () => {
    const { client, upsertMock } = makeMockClient()
    _injectSupabaseForTests(client as any)

    await saveToken({
      organization_id: '00000000-0000-0000-0000-000000000001',
      identity_type: 'person',
      linkedin_id: 'urn:li:person:abc123',
      display_name: 'Thiago Costa',
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in_sec: 3600,
      scopes: [],
    })

    const upsertOpts = upsertMock.mock.calls[0][1] as Record<string, unknown>
    expect(upsertOpts?.onConflict).toBe('organization_id,identity_type,linkedin_id')
  })
})

describe('loadToken — reads from integrations.linkedin_oauth', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001'
  const LINKEDIN_ID = 'urn:li:person:abc123'

  beforeEach(() => {
    process.env.LINKEDIN_TOKEN_ENC_KEY = KEY_A
    process.env.LINKEDIN_TOKEN_ENC_KEY_VERSION = 'v1'
    _resetSupabaseClientForTests()
  })

  afterEach(() => {
    _resetSupabaseClientForTests()
  })

  it('decrypts access_token_encrypted and refresh_token_encrypted on read', async () => {
    const accessEnc = encryptToken('AQXXXX', KEY_A)
    const refreshEnc = encryptToken('AQYYYY', KEY_A)

    const fakeRow = {
      organization_id: ORG_ID,
      identity_type: 'person',
      linkedin_id: LINKEDIN_ID,
      display_name: 'Thiago Costa',
      access_token_encrypted: accessEnc,
      refresh_token_encrypted: refreshEnc,
      scopes: ['r_liteprofile'],
      expires_at: '2026-07-18T00:00:00.000Z',
      refresh_expires_at: null,
      last_refreshed_at: '2026-05-18T00:00:00.000Z',
    }

    const { client } = makeMockClient({ data: fakeRow, error: null })
    _injectSupabaseForTests(client as any)

    const result = await loadToken(ORG_ID, 'person', LINKEDIN_ID)
    expect(result.access_token).toBe('AQXXXX')
    expect(result.refresh_token).toBe('AQYYYY')
    expect(result.organization_id).toBe(ORG_ID)
    expect(result.linkedin_id).toBe(LINKEDIN_ID)
    expect(result.identity_type).toBe('person')
    expect(result.display_name).toBe('Thiago Costa')
    expect(result.expires_at).toBeInstanceOf(Date)
  })

  it('throws when no row is found', async () => {
    const { client } = makeMockClient({ data: null, error: { message: 'no rows' } })
    _injectSupabaseForTests(client as any)

    await expect(loadToken(ORG_ID, 'person', LINKEDIN_ID)).rejects.toThrow()
  })

  it('handles null refresh_token_encrypted gracefully', async () => {
    const accessEnc = encryptToken('AQXXXX', KEY_A)
    const fakeRow = {
      organization_id: ORG_ID,
      identity_type: 'person',
      linkedin_id: LINKEDIN_ID,
      display_name: 'Thiago Costa',
      access_token_encrypted: accessEnc,
      refresh_token_encrypted: null,
      scopes: ['r_liteprofile'],
      expires_at: '2026-07-18T00:00:00.000Z',
      refresh_expires_at: null,
      last_refreshed_at: '2026-05-18T00:00:00.000Z',
    }

    const { client } = makeMockClient({ data: fakeRow, error: null })
    _injectSupabaseForTests(client as any)

    const result = await loadToken(ORG_ID, 'person', LINKEDIN_ID)
    expect(result.refresh_token).toBeNull()
  })
})
