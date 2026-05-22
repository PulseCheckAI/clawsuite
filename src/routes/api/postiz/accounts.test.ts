// Tests for the Postiz accounts route handler.
//
// Behaviors under test:
//   1. Auth gating returns 401 when isAuthenticated() is false.
//   2. Returns the 503 POSTIZ_NOT_CONFIGURED envelope when no client.
//   3. Happy path: maps integrations[] → accounts[] and strips LinkedIn rows.
//   4. Handles the `{ integrations: [...] }` wrapper variant.
//   5. Drops malformed rows (missing id / identifier) but keeps valid ones.
//   6. Network errors from the SDK come through as a masked error envelope.
//   7. Includes `baseUrl` field in the success response (UI contract).
//   8. NO `additionalSettings` or token-bearing fields leak through.
//
// Mocking strategy — mock the `./_client` module at the import boundary so
// `getPostizClient` is replaceable per-test, but keep the pure helpers
// (`isForbiddenPlatform`, `normalizePostizSdkResult`, `postizSdkError`,
// `getPostizBaseUrl`, `POSTIZ_NOT_CONFIGURED`) as their real implementations
// — they have no I/O and we want the production codepath under test.
//
// Synthetic IDs only — never put real Postiz integration UUIDs here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Postiz from '@postiz/node'

vi.mock('@/server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => true),
}))

vi.mock('./_client', async () => {
  const actual = await vi.importActual<typeof import('./_client')>('./_client')
  return {
    ...actual,
    getPostizClient: vi.fn(),
  }
})

import { isAuthenticated } from '@/server/auth-middleware'
import { getPostizClient } from './_client'
import { Route } from './accounts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (Route.options.server as any).handlers.GET as (ctx: {
  request: Request
}) => Promise<Response>

// Env keys we touch — snapshot/restore so tests are hermetic.
const ENV_KEYS = ['POSTIZ_API_URL', 'POSTIZ_API_KEY'] as const
let envSnapshot: Record<string, string | undefined>

interface MockClient {
  integrations: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  postList: ReturnType<typeof vi.fn>
}

function makeMockClient(): MockClient {
  return {
    integrations: vi.fn(),
    post: vi.fn(),
    postList: vi.fn(),
  }
}

function buildRequest(): Request {
  return new Request('http://localhost/api/postiz/accounts')
}

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  // Pin a deterministic base URL so the response.baseUrl assertion is stable.
  process.env.POSTIZ_API_URL = 'http://test-postiz.local'
  vi.mocked(isAuthenticated).mockReturnValue(true)
  vi.mocked(getPostizClient).mockReset()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k]
    else process.env[k] = envSnapshot[k]
  }
  vi.clearAllMocks()
})

describe('accounts — auth gating', () => {
  it('returns 401 JSON when isAuthenticated() is false', async () => {
    vi.mocked(isAuthenticated).mockReturnValueOnce(false)
    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauthorized/i)
  })
})

describe('accounts — not configured', () => {
  it('returns 503 envelope with empty accounts[] when getPostizClient is null', async () => {
    vi.mocked(getPostizClient).mockReturnValueOnce(null)
    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(503)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      accounts: unknown[]
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/not configured/i)
    expect(body.accounts).toEqual([])
  })
})

describe('accounts — happy path + LinkedIn stripping', () => {
  it('returns 2 accounts when SDK returns [twitter, instagram, linkedin]', async () => {
    const client = makeMockClient()
    client.integrations.mockResolvedValueOnce([
      {
        id: 'int-test-x-001',
        identifier: 'x',
        name: '@test_handle',
        type: 'social',
      },
      {
        id: 'int-test-ig-002',
        identifier: 'instagram',
        name: 'test_ig',
        type: 'social',
      },
      {
        id: 'int-test-li-003',
        identifier: 'linkedin-page',
        name: 'should-be-stripped',
        type: 'social',
      },
    ])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      accounts: Array<{ identifier: string; name: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.accounts).toHaveLength(2)
    const identifiers = body.accounts.map((a) => a.identifier).sort()
    expect(identifiers).toEqual(['instagram', 'x'])
    expect(identifiers).not.toContain('linkedin-page')
  })

  it('extracts accounts from `{ integrations: [...] }` wrapper variant', async () => {
    const client = makeMockClient()
    client.integrations.mockResolvedValueOnce({
      integrations: [
        {
          id: 'int-test-bsky-001',
          identifier: 'bluesky',
          name: 'test.bsky.social',
        },
      ],
    })
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    const body = (await res.json()) as {
      ok: boolean
      accounts: Array<{ identifier: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0].identifier).toBe('bluesky')
  })

  it('drops malformed rows (missing id / identifier) but keeps valid ones', async () => {
    const client = makeMockClient()
    client.integrations.mockResolvedValueOnce([
      { identifier: 'x', name: 'no-id-row' }, // missing id → drop
      { id: 'int-test-noid-002', name: 'no-identifier-row' }, // missing identifier → drop
      {
        id: 'int-test-good-003',
        identifier: 'mastodon',
        name: 'good-row@example.test',
      }, // valid → keep
      null, // not an object → drop
      'string-item', // not an object → drop
    ])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    const body = (await res.json()) as {
      ok: boolean
      accounts: Array<{ id: string; identifier: string; name: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0]).toMatchObject({
      id: 'int-test-good-003',
      identifier: 'mastodon',
      name: 'good-row@example.test',
    })
  })

  it('SDK throws network error → handler returns masked error envelope', async () => {
    const client = makeMockClient()
    client.integrations.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND test-postiz.local'),
    )
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      hint?: string
      accounts: unknown[]
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Postiz unreachable/)
    expect(body.accounts).toEqual([])
    // hint exists (either from postizSdkError or the accounts fallback)
    expect(typeof body.hint).toBe('string')
  })

  it('includes baseUrl in the success response', async () => {
    const client = makeMockClient()
    client.integrations.mockResolvedValueOnce([])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    const body = (await res.json()) as { ok: boolean; baseUrl: unknown }
    expect(body.ok).toBe(true)
    expect(typeof body.baseUrl).toBe('string')
    // The POSTIZ_API_URL we set in beforeEach should drive the value.
    expect(body.baseUrl).toBe('http://test-postiz.local')
  })

  it('does not leak additionalSettings or token-bearing fields into the response', async () => {
    const client = makeMockClient()
    // Postiz CAN return extra fields (additionalSettings, refreshToken, etc.)
    // — the normalizer must strip them.
    client.integrations.mockResolvedValueOnce([
      {
        id: 'int-test-leak-001',
        identifier: 'x',
        name: 'leak-test',
        type: 'social',
        additionalSettings: { client_secret: 'sk-should-never-appear' },
        refreshToken: 'refresh-tok-should-never-appear',
        accessToken: 'access-tok-should-never-appear',
        token: 'tok-should-never-appear',
      },
    ])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    const body = (await res.json()) as {
      ok: boolean
      accounts: Array<Record<string, unknown>>
    }
    expect(body.ok).toBe(true)
    expect(body.accounts).toHaveLength(1)
    const account = body.accounts[0]
    expect(account).not.toHaveProperty('additionalSettings')
    expect(account).not.toHaveProperty('refreshToken')
    expect(account).not.toHaveProperty('accessToken')
    expect(account).not.toHaveProperty('token')
    // Defense-in-depth: stringify the whole body and confirm no leak strings
    // anywhere (e.g. accidentally nested under another key).
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('sk-should-never-appear')
    expect(serialized).not.toContain('refresh-tok-should-never-appear')
    expect(serialized).not.toContain('access-tok-should-never-appear')
    expect(serialized).not.toContain('tok-should-never-appear')
  })
})
