// Tests for postiz-oauth-store.ts — the on-disk persistence layer for the
// Postiz Cloud OAuth2 access token. Pure file I/O, no network. We override
// the storage path via POSTIZ_OAUTH_TOKEN_PATH so tests don't pollute the
// project's actual data/ directory.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteToken,
  isConnected,
  readToken,
  writeToken,
} from './postiz-oauth-store'

let tmpRoot: string
let tokenPath: string
let envSnapshot: string | undefined

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'postiz-oauth-store-'))
  tokenPath = join(tmpRoot, 'postiz-oauth.json')
  envSnapshot = process.env.POSTIZ_OAUTH_TOKEN_PATH
  process.env.POSTIZ_OAUTH_TOKEN_PATH = tokenPath
})

afterEach(() => {
  if (envSnapshot === undefined) delete process.env.POSTIZ_OAUTH_TOKEN_PATH
  else process.env.POSTIZ_OAUTH_TOKEN_PATH = envSnapshot
  rmSync(tmpRoot, { recursive: true, force: true })
})

const VALID_TOKEN = {
  access_token: 'pos_test_aBcDeFg1234567890',
  organization_id: 'org_test_xyz',
  cus: 'cus_test_123',
  obtained_at: '2026-05-19T16:00:00.000Z',
}

describe('postiz-oauth-store', () => {
  it('readToken returns null when the file does not exist', () => {
    expect(readToken()).toBeNull()
    expect(isConnected()).toBe(false)
  })

  it('writeToken then readToken round-trips identical data', () => {
    writeToken(VALID_TOKEN)
    expect(readToken()).toEqual(VALID_TOKEN)
    expect(isConnected()).toBe(true)
  })

  it('readToken returns null when the file is malformed JSON', () => {
    writeFileSync(tokenPath, '{not json')
    expect(readToken()).toBeNull()
  })

  it('readToken returns null when access_token is missing', () => {
    writeFileSync(
      tokenPath,
      JSON.stringify({ ...VALID_TOKEN, access_token: undefined }),
    )
    expect(readToken()).toBeNull()
  })

  it('readToken returns null when organization_id is empty', () => {
    writeFileSync(
      tokenPath,
      JSON.stringify({ ...VALID_TOKEN, organization_id: '' }),
    )
    expect(readToken()).toBeNull()
  })

  it('readToken returns null when obtained_at is missing', () => {
    const { obtained_at: _drop, ...rest } = VALID_TOKEN
    writeFileSync(tokenPath, JSON.stringify(rest))
    expect(readToken()).toBeNull()
  })

  it('readToken normalizes missing cus to null', () => {
    const { cus: _drop, ...rest } = VALID_TOKEN
    writeFileSync(tokenPath, JSON.stringify(rest))
    expect(readToken()).toEqual({ ...VALID_TOKEN, cus: null })
  })

  it('readToken normalizes empty-string cus to null', () => {
    writeFileSync(tokenPath, JSON.stringify({ ...VALID_TOKEN, cus: '' }))
    expect(readToken()).toEqual({ ...VALID_TOKEN, cus: null })
  })

  it('readToken returns null when the root is an array (not an object)', () => {
    writeFileSync(tokenPath, JSON.stringify([VALID_TOKEN]))
    expect(readToken()).toBeNull()
  })

  it('readToken returns null when fields are wrong types', () => {
    writeFileSync(
      tokenPath,
      JSON.stringify({ ...VALID_TOKEN, access_token: 12345 }),
    )
    expect(readToken()).toBeNull()
  })

  it('deleteToken removes the file and is idempotent', () => {
    writeToken(VALID_TOKEN)
    expect(isConnected()).toBe(true)
    deleteToken()
    expect(isConnected()).toBe(false)
    // Second delete on a missing file must not throw.
    expect(() => deleteToken()).not.toThrow()
  })

  it('writeToken creates the parent directory if missing', () => {
    const nested = join(tmpRoot, 'nested', 'deep', 'postiz-oauth.json')
    process.env.POSTIZ_OAUTH_TOKEN_PATH = nested
    writeToken(VALID_TOKEN)
    expect(readToken()).toEqual(VALID_TOKEN)
  })
})
