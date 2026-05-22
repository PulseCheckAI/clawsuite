// Tests for the Postiz Cloud OAuth2 `start` route handler.
//
// The handler issues a 302 redirect to the Postiz authorize endpoint and sets
// an HMAC-signed state cookie scoped to /api/postiz/oauth. These tests exercise
// every error path (missing env, unauthenticated) and verify the happy path
// (state cookie shape, HMAC secret precedence, NODE_ENV-gated Secure flag,
// authorize-URL override).
//
// Mocking strategy:
//   - `@/server/auth-middleware` is mocked so we don't need a real session
//     store; we only care about the boolean return of `isAuthenticated`.
//   - env vars are snapshot/restored per test (vitest doesn't reset
//     process.env automatically).
//
// Synthetic secrets only — never put a real client_id or secret here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => true),
}))

import { isAuthenticated } from '@/server/auth-middleware'
import { Route } from './oauth.start'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (Route.options.server as any).handlers.GET as (ctx: {
  request: Request
}) => Promise<Response>

const ENV_KEYS = [
  'POSTIZ_CLOUD_CLIENT_ID',
  'POSTIZ_CLOUD_REDIRECT_URI',
  'POSTIZ_CLOUD_AUTHORIZE_URL',
  'POSTIZ_CLOUD_STATE_SECRET',
  'CLAWSUITE_PASSWORD',
  'NODE_ENV',
] as const

let envSnapshot: Record<string, string | undefined>

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  vi.mocked(isAuthenticated).mockReturnValue(true)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k]
    else process.env[k] = envSnapshot[k]
  }
  vi.clearAllMocks()
})

// Synthetic placeholders — never put a real client_id/secret here.
const TEST_CLIENT_ID = 'pca_test_xxxx'
const TEST_REDIRECT_URI =
  'https://clawsuite.example.test/api/postiz/oauth/callback'
const TEST_STATE_SECRET = 'test-state-secret-32-chars-min-aBcDeFg'
const TEST_PASSWORD = 'test-clawsuite-password-aBcDeFg-1234'

function buildRequest(): Request {
  return new Request('http://localhost/api/postiz/oauth/start')
}

function setHappyEnv() {
  process.env.POSTIZ_CLOUD_CLIENT_ID = TEST_CLIENT_ID
  process.env.POSTIZ_CLOUD_REDIRECT_URI = TEST_REDIRECT_URI
  process.env.POSTIZ_CLOUD_STATE_SECRET = TEST_STATE_SECRET
}

function parseSetCookie(headerValue: string): {
  name: string
  value: string
  attrs: Set<string>
  attrMap: Map<string, string>
} {
  const parts = headerValue.split(';').map((p) => p.trim())
  const [first, ...rest] = parts
  const eq = first.indexOf('=')
  const name = first.slice(0, eq)
  const value = first.slice(eq + 1)
  const attrs = new Set<string>()
  const attrMap = new Map<string, string>()
  for (const a of rest) {
    const ei = a.indexOf('=')
    if (ei === -1) {
      attrs.add(a)
    } else {
      attrMap.set(a.slice(0, ei), a.slice(ei + 1))
    }
  }
  return { name, value, attrs, attrMap }
}

describe('postiz oauth.start — error paths', () => {
  it('returns 401 when the request is not authenticated', async () => {
    setHappyEnv()
    vi.mocked(isAuthenticated).mockReturnValueOnce(false)

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 500 when POSTIZ_CLOUD_CLIENT_ID is missing', async () => {
    process.env.POSTIZ_CLOUD_REDIRECT_URI = TEST_REDIRECT_URI
    process.env.POSTIZ_CLOUD_STATE_SECRET = TEST_STATE_SECRET

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/POSTIZ_CLOUD_CLIENT_ID/)
  })

  it('returns 500 when POSTIZ_CLOUD_CLIENT_ID is empty string', async () => {
    process.env.POSTIZ_CLOUD_CLIENT_ID = ''
    process.env.POSTIZ_CLOUD_REDIRECT_URI = TEST_REDIRECT_URI
    process.env.POSTIZ_CLOUD_STATE_SECRET = TEST_STATE_SECRET

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(/POSTIZ_CLOUD_CLIENT_ID/)
  })

  it('returns 500 when POSTIZ_CLOUD_REDIRECT_URI is missing', async () => {
    process.env.POSTIZ_CLOUD_CLIENT_ID = TEST_CLIENT_ID
    process.env.POSTIZ_CLOUD_STATE_SECRET = TEST_STATE_SECRET

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(/POSTIZ_CLOUD_REDIRECT_URI/)
  })

  it('returns 500 when both POSTIZ_CLOUD_STATE_SECRET and CLAWSUITE_PASSWORD are missing', async () => {
    process.env.POSTIZ_CLOUD_CLIENT_ID = TEST_CLIENT_ID
    process.env.POSTIZ_CLOUD_REDIRECT_URI = TEST_REDIRECT_URI

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(/HMAC secret/i)
    expect(body.error).toMatch(/POSTIZ_CLOUD_STATE_SECRET/)
    expect(body.error).toMatch(/CLAWSUITE_PASSWORD/)
  })
})

describe('postiz oauth.start — HMAC secret precedence', () => {
  it('uses POSTIZ_CLOUD_STATE_SECRET in preference to CLAWSUITE_PASSWORD when both are set', async () => {
    process.env.POSTIZ_CLOUD_CLIENT_ID = TEST_CLIENT_ID
    process.env.POSTIZ_CLOUD_REDIRECT_URI = TEST_REDIRECT_URI
    process.env.POSTIZ_CLOUD_STATE_SECRET = TEST_STATE_SECRET
    process.env.CLAWSUITE_PASSWORD = TEST_PASSWORD

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(302)

    const cookieHeader = res.headers.get('Set-Cookie')
    expect(cookieHeader).not.toBeNull()
    const { value } = parseSetCookie(cookieHeader!)
    const [state, mac] = value.split('.')

    const expectedWithPreferred = createHmac('sha256', TEST_STATE_SECRET)
      .update(state)
      .digest('hex')
    const expectedWithFallback = createHmac('sha256', TEST_PASSWORD)
      .update(state)
      .digest('hex')

    expect(mac).toBe(expectedWithPreferred)
    expect(mac).not.toBe(expectedWithFallback)
  })

  it('falls back to CLAWSUITE_PASSWORD for the HMAC when POSTIZ_CLOUD_STATE_SECRET is absent', async () => {
    process.env.POSTIZ_CLOUD_CLIENT_ID = TEST_CLIENT_ID
    process.env.POSTIZ_CLOUD_REDIRECT_URI = TEST_REDIRECT_URI
    process.env.CLAWSUITE_PASSWORD = TEST_PASSWORD

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(302)

    const cookieHeader = res.headers.get('Set-Cookie')!
    const { value } = parseSetCookie(cookieHeader)
    const [state, mac] = value.split('.')

    const expected = createHmac('sha256', TEST_PASSWORD)
      .update(state)
      .digest('hex')
    expect(mac).toBe(expected)
  })
})

describe('postiz oauth.start — happy path redirect', () => {
  it('issues a 302 redirect with the correct authorize URL query params', async () => {
    setHappyEnv()

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).not.toBeNull()

    const url = new URL(location!)
    expect(url.origin + url.pathname).toBe(
      'https://platform.postiz.com/oauth/authorize',
    )
    expect(url.searchParams.get('client_id')).toBe(TEST_CLIENT_ID)
    expect(url.searchParams.get('response_type')).toBe('code')

    const stateInUrl = url.searchParams.get('state')
    expect(stateInUrl).toMatch(/^[0-9a-f]{32}$/)

    // Cookie state must match URL state.
    const cookieHeader = res.headers.get('Set-Cookie')!
    const { value } = parseSetCookie(cookieHeader)
    const [stateInCookie] = value.split('.')
    expect(stateInCookie).toBe(stateInUrl)
  })

  it('uses POSTIZ_CLOUD_AUTHORIZE_URL when set; defaults otherwise', async () => {
    setHappyEnv()
    process.env.POSTIZ_CLOUD_AUTHORIZE_URL =
      'https://override.test.example/oauth/authorize'

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toMatch(
      /^https:\/\/override\.test\.example\/oauth\/authorize\?/,
    )

    // Empty string falls back to default.
    process.env.POSTIZ_CLOUD_AUTHORIZE_URL = ''
    const res2 = await handler({ request: buildRequest() })
    expect(res2.headers.get('Location')).toMatch(
      /^https:\/\/platform\.postiz\.com\/oauth\/authorize\?/,
    )
  })

  it('sets the state cookie with the expected attributes (non-prod)', async () => {
    setHappyEnv()
    process.env.NODE_ENV = 'development'

    const res = await handler({ request: buildRequest() })
    const cookieHeader = res.headers.get('Set-Cookie')!
    const { name, value, attrs, attrMap } = parseSetCookie(cookieHeader)

    expect(name).toBe('postiz_oauth_state')
    expect(attrs.has('HttpOnly')).toBe(true)
    expect(attrMap.get('SameSite')).toBe('Lax')
    expect(attrMap.get('Path')).toBe('/api/postiz/oauth')
    expect(attrMap.get('Max-Age')).toBe('600')
    // Secure must NOT be set when NODE_ENV !== 'production'.
    expect(attrs.has('Secure')).toBe(false)

    // Value shape: <32-char hex>.<sha256 hex (64 chars)>
    expect(value).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{64}$/)
    const [state, mac] = value.split('.')
    // HMAC must verify under the configured secret.
    const expected = createHmac('sha256', TEST_STATE_SECRET)
      .update(state)
      .digest('hex')
    expect(mac).toBe(expected)
  })

  it('sets the Secure attribute on the state cookie when NODE_ENV=production', async () => {
    setHappyEnv()
    process.env.NODE_ENV = 'production'

    const res = await handler({ request: buildRequest() })
    const cookieHeader = res.headers.get('Set-Cookie')!
    const { attrs } = parseSetCookie(cookieHeader)
    expect(attrs.has('Secure')).toBe(true)
    expect(attrs.has('HttpOnly')).toBe(true)
  })

  it('produces a fresh state on each call (no replay)', async () => {
    setHappyEnv()

    const res1 = await handler({ request: buildRequest() })
    const res2 = await handler({ request: buildRequest() })

    const state1 = new URL(res1.headers.get('Location')!).searchParams.get(
      'state',
    )
    const state2 = new URL(res2.headers.get('Location')!).searchParams.get(
      'state',
    )
    expect(state1).not.toBe(state2)
    expect(state1).toMatch(/^[0-9a-f]{32}$/)
    expect(state2).toMatch(/^[0-9a-f]{32}$/)
  })
})
