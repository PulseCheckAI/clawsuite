// Tests for the HubSpot OAuth2 callback handler. Mirrors the Postiz callback
// test (same security contract): HMAC state-verification runs BEFORE the
// access_denied branch; token-exchange failures redirect with FIXED error codes
// only (never echo upstream bodies); the state cookie is cleared on every
// terminal redirect. All values below are synthetic — no real secrets.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => true),
}))

const writeTokenMock = vi.fn()
vi.mock('@/server/hubspot-oauth-store', () => ({
  writeToken: (...args: unknown[]) => writeTokenMock(...args),
}))

import { Route } from './oauth.callback'
import { isAuthenticated } from '@/server/auth-middleware'

const handler = (Route.options.server as any).handlers.GET as (ctx: {
  request: Request
}) => Promise<Response>

const ENV_KEYS = [
  'HUBSPOT_CLIENT_ID',
  'HUBSPOT_CLIENT_SECRET',
  'HUBSPOT_REDIRECT_URI',
  'HUBSPOT_STATE_SECRET',
  'HUBSPOT_TOKEN_URL',
  'CLAWSUITE_PASSWORD',
]
let envSnapshot: Record<string, string | undefined>

const SECRET = 'test-state-secret-aBcDeFgHiJkLmNoPq'
const CLIENT_ID = 'hubspot_test_client_id'
const CLIENT_SECRET = 'hubspot_test_client_secret'
const REDIRECT_URI = 'https://localhost:3010/api/hubspot/oauth/callback'

function makeStateCookie(state: string, secret: string = SECRET): string {
  const mac = createHmac('sha256', secret).update(state).digest('hex')
  return `hubspot_oauth_state=${state}.${mac}`
}

function callbackUrl(params: Record<string, string>): string {
  const u = new URL('http://localhost/api/hubspot/oauth/callback')
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

const fetchMock = vi.fn()

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.HUBSPOT_STATE_SECRET = SECRET
  process.env.HUBSPOT_CLIENT_ID = CLIENT_ID
  process.env.HUBSPOT_CLIENT_SECRET = CLIENT_SECRET
  process.env.HUBSPOT_REDIRECT_URI = REDIRECT_URI

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
  it('redirects to state_mismatch when cookie missing AND ?error=access_denied', async () => {
    const response = await handler({
      request: new Request(
        callbackUrl({ state: 'abc123', error: 'access_denied' }),
      ),
    })
    expect(response.status).toBe(302)
    expect(locationPath(response)).toBe('/hubspot')
    expect(locationParams(response).get('error')).toBe('state_mismatch')
    expect(locationParams(response).get('error')).not.toBe('access_denied')
  })

  it('redirects to state_mismatch when HMAC does not match', async () => {
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
      request: new Request(callbackUrl({ code: 'c' }), { headers: { cookie } }),
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
    expect(setCookie).toContain('hubspot_oauth_state=')
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
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

// ── 4. missing_code path ─────────────────────────────────────────────────────
describe('missing_code path', () => {
  it('redirects to missing_code when state validates but ?code is missing', async () => {
    const state = 'validStateNoCodeAbc'
    const cookie = makeStateCookie(state)
    const response = await handler({
      request: new Request(callbackUrl({ state }), { headers: { cookie } }),
    })
    expect(response.status).toBe(302)
    expect(locationParams(response).get('error')).toBe('missing_code')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 5. Env validation ────────────────────────────────────────────────────────
describe('env validation', () => {
  it('returns 500 when no HMAC secret is configured', async () => {
    delete process.env.HUBSPOT_STATE_SECRET
    delete process.env.CLAWSUITE_PASSWORD
    const response = await handler({
      request: new Request(callbackUrl({ code: 'c', state: 's' })),
    })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(/HMAC|HUBSPOT_STATE_SECRET|CLAWSUITE_PASSWORD/)
  })

  it('returns 500 when client creds are missing', async () => {
    delete process.env.HUBSPOT_CLIENT_SECRET
    const response = await handler({
      request: new Request(callbackUrl({ code: 'c', state: 's' })),
    })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.error).toContain('HUBSPOT_CLIENT_SECRET')
  })
})

// ── 6. Token exchange — success path ─────────────────────────────────────────
describe('token exchange — success', () => {
  it('writes token (access+refresh+expires_at) and redirects to /hubspot?connected=1', async () => {
    const state = 'happyPathStateBeef'
    const cookie = makeStateCookie(state)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'test_access_token_xyz',
          refresh_token: 'test_refresh_token_abc',
          expires_in: 1800,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const response = await handler({
      request: new Request(callbackUrl({ state, code: 'auth_code_zzz' }), {
        headers: { cookie },
      }),
    })

    expect(response.status).toBe(302)
    expect(locationPath(response)).toBe('/hubspot')
    expect(locationParams(response).get('connected')).toBe('1')

    expect(writeTokenMock).toHaveBeenCalledTimes(1)
    const tokenArg = writeTokenMock.mock.calls[0][0] as Record<string, unknown>
    expect(tokenArg.access_token).toBe('test_access_token_xyz')
    expect(tokenArg.refresh_token).toBe('test_refresh_token_abc')
    expect(typeof tokenArg.expires_at).toBe('string')
    expect(typeof tokenArg.obtained_at).toBe('string')
    expect(() =>
      new Date(tokenArg.expires_at as string).toISOString(),
    ).not.toThrow()

    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

// ── 7. Token exchange — failure paths (no body echo) ─────────────────────────
describe('token exchange — failure paths use FIXED error codes (no body echo)', () => {
  it('redirects to exchange_failed (not raw body) on non-2xx', async () => {
    const state = 'fail401StateCafe'
    const cookie = makeStateCookie(state)
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

  it('redirects to exchange_unreachable when fetch throws', async () => {
    const state = 'netErrStateDada'
    const cookie = makeStateCookie(state)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND api.hubapi.com'),
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
    expect(errorSpy).toHaveBeenCalled()
    expect(writeTokenMock).not.toHaveBeenCalled()
  })

  it('redirects to invalid_token_response when body is not JSON', async () => {
    const state = 'badJsonStateFeed'
    const cookie = makeStateCookie(state)
    fetchMock.mockResolvedValueOnce(
      new Response('<html>503</html>', {
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

  it('redirects to invalid_token_response when access_token is absent', async () => {
    const state = 'noTokenStateBabe'
    const cookie = makeStateCookie(state)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ refresh_token: 'r', expires_in: 1800 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
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
