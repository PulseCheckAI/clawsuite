// Tests for the Postiz post route handler.
//
// SECURITY-CRITICAL behaviors under test:
//   1. Auth gating — 401 when isAuthenticated() is false.
//   2. 503 envelope when getPostizClient() returns null.
//   3. Happy path — client.post() called with the SDK-expected dto shape
//      (type, date, shortLink: false, tags: [], posts: [...]).
//   4. LinkedIn guard — when a platform identifier resolves to LinkedIn, the
//      handler MUST NOT call client.post(). This is the load-bearing safety
//      check that keeps the Postiz pipeline from double-posting on top of
//      the dedicated LinkedIn surface.
//   5. SDK network error during client.post() → masked error envelope.
//   6. Integration lookup fails (integrations() throws) → handler must not
//      silently allow the post through with a stale id. (Note: an EMPTY
//      integrations[] array is NOT itself a rejection — the route may
//      accept identifier-shaped platform strings even without a mapping.
//      The load-bearing case is when the SDK throws.)
//
// Mocking strategy mirrors `accounts.test.ts` — vi.importActual preserves the
// pure helpers (isForbiddenPlatform, normalizers, error envelope), only
// `getPostizClient` is replaced per-test.
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
import { Route } from './post'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (Route.options.server as any).handlers.POST as (ctx: {
  request: Request
}) => Promise<Response>

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

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/postiz/post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
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

describe('post — auth gating', () => {
  it('returns 401 JSON when isAuthenticated() is false', async () => {
    vi.mocked(isAuthenticated).mockReturnValueOnce(false)
    const res = await handler({
      request: buildRequest({ content: 'hello', platforms: ['x'] }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauthorized/i)
  })
})

describe('post — not configured', () => {
  it('returns 503 envelope when getPostizClient is null', async () => {
    vi.mocked(getPostizClient).mockReturnValueOnce(null)
    const res = await handler({
      request: buildRequest({ content: 'hello', platforms: ['x'] }),
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/not configured/i)
  })
})

describe('post — happy path', () => {
  it('calls client.post() with the SDK-expected dto shape', async () => {
    const integrationId = 'int-test-bsky-001'
    const client = makeMockClient()
    // Integration lookup returns a non-LinkedIn account.
    client.integrations.mockResolvedValueOnce([
      {
        id: integrationId,
        identifier: 'bluesky',
        name: 'test.bsky.social',
      },
    ])
    client.post.mockResolvedValueOnce({ id: 'pos_test_response_001' })
    vi.mocked(getPostizClient).mockReturnValue(client as unknown as Postiz)

    const res = await handler({
      request: buildRequest({
        content: 'hello world',
        platforms: [integrationId],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      scheduled: boolean
      response: unknown
    }
    expect(body.ok).toBe(true)
    expect(body.scheduled).toBe(false)

    expect(client.post).toHaveBeenCalledTimes(1)
    const dto = client.post.mock.calls[0][0] as {
      type: string
      shortLink: boolean
      tags: unknown[]
      date: string
      posts: Array<{ integration: unknown; value: Array<{ content: string }> }>
    }
    // SDK CreatePostDto required fields — these are the contract the refactor
    // is supposed to honour. If any of these regress to undefined/missing,
    // we want the test to fail loudly.
    expect(dto.type).toBe('now')
    expect(dto.shortLink).toBe(false)
    expect(dto.tags).toEqual([])
    expect(typeof dto.date).toBe('string')
    expect(() => new Date(dto.date).toISOString()).not.toThrow()
    expect(dto.posts).toHaveLength(1)
    expect(dto.posts[0].value[0].content).toBe('hello world')
  })
})

describe('post — LinkedIn guard (load-bearing)', () => {
  it('rejects when an integration identifier resolves to linkedin — client.post() MUST NOT be invoked', async () => {
    const linkedinId = 'int-test-li-002'
    const client = makeMockClient()
    // Integration lookup returns the linkedin account so the UUID resolves
    // to a forbidden identifier.
    client.integrations.mockResolvedValueOnce([
      {
        id: linkedinId,
        identifier: 'linkedin-page',
        name: 'should-be-rejected',
      },
    ])
    vi.mocked(getPostizClient).mockReturnValue(client as unknown as Postiz)

    const res = await handler({
      request: buildRequest({
        content: 'hello',
        platforms: [linkedinId],
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      forbidden?: string
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/LinkedIn/i)
    expect(body.forbidden).toMatch(/linkedin/i)
    // The load-bearing assertion: client.post must NEVER fire on the
    // LinkedIn path.
    expect(client.post).not.toHaveBeenCalled()
  })
})

describe('post — SDK error path', () => {
  it('returns masked error envelope when client.post() throws a network error', async () => {
    const integrationId = 'int-test-x-003'
    const client = makeMockClient()
    client.integrations.mockResolvedValueOnce([
      {
        id: integrationId,
        identifier: 'x',
        name: '@test_handle',
      },
    ])
    client.post.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND test-postiz.local'),
    )
    vi.mocked(getPostizClient).mockReturnValue(client as unknown as Postiz)

    const res = await handler({
      request: buildRequest({
        content: 'hello',
        platforms: [integrationId],
      }),
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      hint?: string
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Postiz unreachable/)
    expect(client.post).toHaveBeenCalledTimes(1) // it WAS called, then threw
  })
})

describe('post — timeout path', () => {
  it('returns timeout error when client.post hangs beyond 30s', async () => {
    // Fake timers let us fast-forward through the 30s window deterministically.
    // The handler races `client.post()` (mocked to never resolve) against a
    // manual setTimeout — advancing time fires the timeout branch and the
    // catch routes through postizSdkError() to mask the message.
    vi.useFakeTimers()
    try {
      const integrationId = 'int-test-timeout-005'
      const client = makeMockClient()
      client.integrations.mockResolvedValueOnce([
        {
          id: integrationId,
          identifier: 'bluesky',
          name: 'test.bsky.social',
        },
      ])
      // Never resolves — only the timeout can settle the race.
      client.post.mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(getPostizClient).mockReturnValue(client as unknown as Postiz)

      const resPromise = handler({
        request: buildRequest({
          content: 'hello',
          platforms: [integrationId],
        }),
      })
      // Let the handler reach the Promise.race, then trip the timeout.
      await vi.advanceTimersByTimeAsync(31_000)
      const res = await resPromise
      expect(res.status).toBe(502)
      const body = (await res.json()) as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
      expect(body.error).toMatch(/timed out/i)
      expect(client.post).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('post — integration lookup failure', () => {
  it('returns an error envelope without calling client.post() when integrations() rejects', async () => {
    // The "lookup failure" branch the route models is when the integrations
    // SDK call itself errors — empty arrays are legal (just no matches) and
    // the route DOES NOT reject for "id not found" because Postiz may accept
    // identifier-shaped values too. So this test exercises the integrations
    // SDK throw, which IS load-bearing — the route must surface the failure
    // rather than silently allow the post through.
    const client = makeMockClient()
    client.integrations.mockRejectedValueOnce(
      new Error('upstream integrations 500'),
    )
    vi.mocked(getPostizClient).mockReturnValue(client as unknown as Postiz)

    const res = await handler({
      request: buildRequest({
        content: 'hello',
        platforms: ['int-test-unknown-004'],
      }),
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      hint?: string
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Could not verify accounts against Postiz/)
    // client.post MUST NOT be called when we can't verify accounts.
    expect(client.post).not.toHaveBeenCalled()
  })
})
