// Tests for the Postiz Cloud OAuth2 callback handler.
//
// SECURITY-CRITICAL behaviours under test:
//   1. State-cookie HMAC validation runs BEFORE the access_denied branch.
//      Otherwise an attacker can hit /api/postiz/oauth/callback with
//      ?error=access_denied and no cookie to clear a victim's in-flight
//      legitimate state cookie.
//   2. Token-exchange failures redirect with FIXED error codes only —
//      never echo upstream response bodies into the browser URL, since
//      Postiz/network errors may contain unmasked sensitive data.
//   3. The state cookie is cleared on every terminal redirect.
//
// The handler is exported on Route.options.server.handlers.GET. We invoke
// it directly with a fabricated `{ request }` argument and assert on the
// returned Response (status, Location header, Set-Cookie header).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => true),
}))

const writeTokenMock = vi.fn()
vi.mock('@/server/postiz-oauth-store', () => ({
  writeToken: (...args: unknown[]) => writeTokenMock(...args),
}))

// Import AFTER mocks are declared so the handler picks up the mocked deps.
import { Route } from './oauth.callback'
import { isAuthenticated } from '@/server/auth-middleware'

const handler = (Route.options.server as any).handlers.GET as (ctx: {
  request: Request
}) => Promise<Response>

// ── Env snapshot/restore ─────────────────────────────────────────────────────
const ENV_KEYS = [
  'POSTIZ_CLOUD_CLIENT_ID',
  'POSTIZ_CLOUD_CLIENT_SECRET',
  'POSTIZ_CLOUD_STATE_SECRET',
  'POSTIZ_CLOUD_TOKEN_URL',
  'CLAWSUITE_PASSWORD',
]
let envSnapshot: Record<string, string | undefined>

const SECRET = 'test-state-secret-aBcDeFgHiJkLmNoPq'
const CLIENT_ID = 'postiz_test_client_id'
const CLIENT_SECRET = 'postiz_test_client_secret'

function makeStateCookie(state: string, secret: string = SECRET): string {
  const mac = createHmac('sha256', secret).update(state).digest('hex')
  return `postiz_oauth_state=${state}.${mac}`
}

function callbackUrl(params: Record<string, string>): string {
  const u = new URL('http://localhost/api/postiz/oauth/callback')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

function locationParams(response: Response): URLSearchParams {
  const loc = response.headers.get('location')
  if (!loc) throw new Error('no Location header on response')
  return new URL(loc, 'http://localhost').searchParams
}

function locationPath(response: Response): string {
  const loc = response.headers.get('location')
  if (!loc) throw new Error('no Location header on response')
  return new URL(loc, 'http://localhost').pathname
}

// ── Setup ────────────────────────────────────────────────────────────────────

const fetchMock = vi.fn()

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.POSTIZ_CLOUD_STATE_SECRET = SECRET
  process.env.POSTIZ_CLOUD_CLIENT_ID = CLIENT_ID
  process.env.POSTIZ_CLOUD_CLIENT_SECRET = CLIENT_SECRET

  fetchMock.mockReset()
  writeTokenMock.mockReset()
  vi.mocked(isAuthenticated).mockReturnValue(true)
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k]
    else process.env[k] = envSnapshot[k]
  }
  vi.restoreAllMocks()
})

// ── 1. Auth gating ───────────────────────────────────────────────────────────
describe('auth gating', () => {
  it('returns 401 JSON when isAuthenticated() is false', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const response = await handler({
      request: new Request(callbackUrl({ code: 'x', state: 's' })),
    })
    expect(response.status).toBe(401)
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauthorized/i)
  })
})

// ── 2. State validation runs BEFORE access_denied branch ─────────────────────
describe('state validation ordering — runs before access_denied', () => {
  it('redirects to state_mismatch when cookie missing AND ?error=access_denied (NOT to access_denied)', async () => {
    const response = await handler({
      request: new Request(
        callbackUrl({ state: 'abc123', error: 'access_denied' }),
      ),
    })
    expect(response.status).toBe(302)
    expect(locationPath(response)).toBe('/postiz')
    expect(locationParams(response).get('error')).toBe('state_mismatch')
    // Critical: the access_denied branch must NOT have been taken.
    expect(locationParams(response).get('error')).not.toBe('access_denied')
  })

  it('redirects to state_mismatch when HMAC does not match', async () => {
    // Cookie signed with a DIFFERENT secret than the env one.
    const cookie = makeStateCookie('abc123', 'a-different-secret-aaaaaaaaaa')
    const response = await handler({
      request: new Request(callbackUrl({ state: 'abc123', code: 'c' }), {
        headers: { cookie },
      }),
    })
    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('state_mismatch')
  })

  it('redirects to state_mismatch when cookie state differs from query state', async () => {
    const cookie = makeStateCookie('cookieState123')
    const response = await handler({
      request: new Request(callbackUrl({ state: 'queryState999', code: 'c' }), {
        headers: { cookie },
      }),
    })
    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('state_mismatch')
  })

  it('redirects to state_mismatch when query state is missing entirely', async () => {
    const cookie = makeStateCookie('abc123')
    const response = await handler({
      request: new Request(callbackUrl({ code: 'c' }), {
        headers: { cookie },
      }),
    })
    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('state_mismatch')
  })

  it('clears the state cookie on the state_mismatch path', async () => {
    const response = await handler({
      request: new Request(callbackUrl({ state: 'abc123' })),
    })
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain('postiz_oauth_state=')
    expect(setCookie).toContain('Max-Age=0')
  })
})

// ── 3. access_denied path (only AFTER state is verified) ─────────────────────
describe('access_denied path (post-state-verification)', () => {
  it('redirects to access_denied with a valid state cookie + matching state', async () => {
    const state = 'validStateDeadbeef'
    const cookie = makeStateCookie(state)
    const response = await handler({
      request: new Request(callbackUrl({ state, error: 'access_denied' }), {
        headers: { cookie },
      }),
    })
    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('access_denied')
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('Max-Age=0')
  })
})

// ── 4. missing_code path ─────────────────────────────────────────────────────
describe('missing_code path', () => {
  it('redirects to missing_code when state validates but ?code is missing', async () => {
    const state = 'validStateNoCodeAbc'
    const cookie = makeStateCookie(state)
    const response = await handler({
      request: new Request(callbackUrl({ state }), {
        headers: { cookie },
      }),
    })
    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('missing_code')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 5. Env validation ────────────────────────────────────────────────────────
describe('env validation', () => {
  it('returns 500 when POSTIZ_CLOUD_CLIENT_ID is missing', async () => {
    delete process.env.POSTIZ_CLOUD_CLIENT_ID
    const response = await handler({
      request: new Request(callbackUrl({ code: 'c', state: 's' })),
    })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('POSTIZ_CLOUD_CLIENT_ID')
  })

  it('returns 500 when POSTIZ_CLOUD_CLIENT_SECRET is missing', async () => {
    delete process.env.POSTIZ_CLOUD_CLIENT_SECRET
    const response = await handler({
      request: new Request(callbackUrl({ code: 'c', state: 's' })),
    })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.error).toContain('POSTIZ_CLOUD_CLIENT_SECRET')
  })

  it('returns 500 when neither POSTIZ_CLOUD_STATE_SECRET nor CLAWSUITE_PASSWORD is set', async () => {
    delete process.env.POSTIZ_CLOUD_STATE_SECRET
    delete process.env.CLAWSUITE_PASSWORD
    const response = await handler({
      request: new Request(callbackUrl({ code: 'c', state: 's' })),
    })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(
      /HMAC|POSTIZ_CLOUD_STATE_SECRET|CLAWSUITE_PASSWORD/,
    )
  })
})

// ── 6. Token exchange — success path ─────────────────────────────────────────
describe('token exchange — success', () => {
  it('writes token with the correct shape and redirects to /postiz?connected=1', async () => {
    const state = 'happyPathStateBeef'
    const cookie = makeStateCookie(state)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'org_test_123',
          cus: 'cus_test_999',
          access_token: 'pos_test_token_xyz',
          token_type: 'bearer',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const response = await handler({
      request: new Request(callbackUrl({ state, code: 'auth_code_zzz' }), {
        headers: { cookie },
      }),
    })

    expect(response.status).toBe(302)
    expect(locationPath(response)).toBe('/postiz')
    expect(locationParams(response).get('connected')).toBe('1')

    expect(writeTokenMock).toHaveBeenCalledTimes(1)
    const tokenArg = writeTokenMock.mock.calls[0][0] as Record<string, unknown>
    expect(tokenArg.access_token).toBe('pos_test_token_xyz')
    expect(tokenArg.organization_id).toBe('org_test_123')
    expect(tokenArg.cus).toBe('cus_test_999')
    expect(typeof tokenArg.obtained_at).toBe('string')
    // ISO-8601 sanity check
    expect(() =>
      new Date(tokenArg.obtained_at as string).toISOString(),
    ).not.toThrow()

    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

// ── 7. Token exchange — failure paths (no body echo) ─────────────────────────
describe('token exchange — failure paths use FIXED error codes (no body echo)', () => {
  it('redirects to exchange_failed (not raw body) when token endpoint returns non-2xx', async () => {
    const state = 'fail401StateCafe'
    const cookie = makeStateCookie(state)
    // Body contains a "secret-looking" string we must NOT see in the URL.
    const upstreamBody = JSON.stringify({
      error: 'invalid_client',
      hint: 'check sk-leaky-secret-xyz',
    })
    fetchMock.mockResolvedValueOnce(
      new Response(upstreamBody, {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await handler({
      request: new Request(callbackUrl({ state, code: 'c' }), {
        headers: { cookie },
      }),
    })

    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('exchange_failed')
    const loc = response.headers.get('location')!
    expect(loc).not.toContain('invalid_client')
    expect(loc).not.toContain('sk-leaky-secret')

    expect(errorSpy).toHaveBeenCalled()
    expect(writeTokenMock).not.toHaveBeenCalled()
  })

  it('redirects to exchange_unreachable when fetch throws (network error)', async () => {
    const state = 'netErrStateDada'
    const cookie = makeStateCookie(state)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND api.postiz.com'),
    )

    const response = await handler({
      request: new Request(callbackUrl({ state, code: 'c' }), {
        headers: { cookie },
      }),
    })

    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('exchange_unreachable')
    const loc = response.headers.get('location')!
    expect(loc).not.toContain('ENOTFOUND')
    expect(loc).not.toContain('api.postiz.com')

    expect(errorSpy).toHaveBeenCalled()
    expect(writeTokenMock).not.toHaveBeenCalled()
  })

  it('redirects to invalid_token_response when response body is not JSON', async () => {
    const state = 'badJsonStateFeed'
    const cookie = makeStateCookie(state)
    fetchMock.mockResolvedValueOnce(
      new Response('<html>503 service unavailable</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const response = await handler({
      request: new Request(callbackUrl({ state, code: 'c' }), {
        headers: { cookie },
      }),
    })

    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('invalid_token_response')
    expect(writeTokenMock).not.toHaveBeenCalled()
  })
})
