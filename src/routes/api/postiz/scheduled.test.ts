// Tests for the Postiz scheduled-posts route handler.
//
// Behaviors under test:
//   1. Auth gating — 401 when isAuthenticated() is false.
//   2. 503 envelope (with posts: []) when getPostizClient() returns null.
//   3. Happy path — returns SDK posts mapped through normalizePost, sorted
//      soonest-first.
//   4. Behavior-change guard — client.postList() is called with
//      { startDate, endDate, customer } and endDate - startDate ≈ 90 days.
//      This locks in the window the refactor introduced so any future
//      change has to update the test deliberately.
//   5. SDK throw → masked error envelope.
//   6. SDK returns posts with LinkedIn integrations embedded → those are
//      stripped before reaching the UI.
//
// Mocking strategy mirrors `accounts.test.ts` — vi.importActual preserves the
// pure helpers (isForbiddenPlatform, normalizers, error envelope), only
// `getPostizClient` is replaced per-test.
//
// Synthetic IDs only — never put real Postiz post IDs here.
// NOTE: avoid the `pos_` / `pcs_` prefixes — they match the Postiz Cloud OAuth
// access-token / client-secret credential patterns in _redact.ts, so any
// success-path response would get the IDs masked to [REDACTED] by R5's
// defense-in-depth pass over normalizePostizSdkResult's success envelope.
// `pst_test_*` is short for "post test" and doesn't trip any pattern.

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
import { Route } from './scheduled'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (Route.options.server as any).handlers.GET as (ctx: {
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

function buildRequest(): Request {
  return new Request('http://localhost/api/postiz/scheduled')
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

describe('scheduled — auth gating', () => {
  it('returns 401 JSON when isAuthenticated() is false', async () => {
    vi.mocked(isAuthenticated).mockReturnValueOnce(false)
    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauthorized/i)
  })
})

describe('scheduled — not configured', () => {
  it('returns 503 envelope with posts: [] when getPostizClient is null', async () => {
    vi.mocked(getPostizClient).mockReturnValueOnce(null)
    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(503)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      posts: unknown[]
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/not configured/i)
    expect(body.posts).toEqual([])
  })
})

describe('scheduled — happy path', () => {
  it('returns posts mapped through normalizePost, sorted soonest-first', async () => {
    const client = makeMockClient()
    client.postList.mockResolvedValueOnce([
      {
        id: 'pst_test_002',
        publishDate: '2026-06-15T12:00:00.000Z',
        state: 'QUEUE',
        integration: {
          id: 'int-test-x-001',
          identifier: 'x',
          name: '@test_handle',
        },
        content: 'second post',
      },
      {
        id: 'pst_test_001',
        publishDate: '2026-06-10T12:00:00.000Z',
        state: 'QUEUE',
        integration: {
          id: 'int-test-bsky-002',
          identifier: 'bluesky',
          name: 'test.bsky.social',
        },
        content: 'first post',
      },
    ])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      posts: Array<{ id: string; content: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.posts).toHaveLength(2)
    // Sort soonest-first — pst_test_001 (10 Jun) before pst_test_002 (15 Jun).
    expect(body.posts[0].id).toBe('pst_test_001')
    expect(body.posts[1].id).toBe('pst_test_002')
  })
})

describe('scheduled — behavior-change guard (postList filters)', () => {
  it('calls client.postList() with {startDate, endDate, customer} and ≈90-day window', async () => {
    const client = makeMockClient()
    client.postList.mockResolvedValueOnce([])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const before = Date.now()
    await handler({ request: buildRequest() })
    const after = Date.now()

    expect(client.postList).toHaveBeenCalledTimes(1)
    const filters = client.postList.mock.calls[0][0] as {
      startDate: string
      endDate: string
      customer: string
    }
    // Shape contract — SDK GetPostsDto requires these exact keys.
    expect(typeof filters.startDate).toBe('string')
    expect(typeof filters.endDate).toBe('string')
    expect(typeof filters.customer).toBe('string')
    // Both must parse as ISO-8601 timestamps.
    const startMs = Date.parse(filters.startDate)
    const endMs = Date.parse(filters.endDate)
    expect(Number.isFinite(startMs)).toBe(true)
    expect(Number.isFinite(endMs)).toBe(true)
    // startDate is "now-ish" (within the test's wall-clock window).
    expect(startMs).toBeGreaterThanOrEqual(before - 5)
    expect(startMs).toBeLessThanOrEqual(after + 5)
    // endDate is exactly 90 days after startDate. This is the LOCKED-IN
    // window the refactor introduced — any future change must update this
    // assertion deliberately.
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
    expect(endMs - startMs).toBe(NINETY_DAYS_MS)
  })
})

describe('scheduled — state filter (QUEUE only)', () => {
  it('strips posts whose state is not QUEUE', async () => {
    // SDK's GetPostsDto has no `state` field, so client.postList() returns
    // posts in any state matching the date window. The handler must filter
    // to QUEUE explicitly so the UI's Scheduled tab doesn't show
    // PUBLISHED/DRAFT/ERROR items.
    const client = makeMockClient()
    client.postList.mockResolvedValueOnce([
      {
        id: 'pst_test_queue_001',
        publishDate: '2026-06-10T12:00:00.000Z',
        state: 'QUEUE',
        integration: {
          id: 'int-test-x-001',
          identifier: 'x',
          name: '@test_handle',
        },
        content: 'keep me — queued',
      },
      {
        id: 'pst_test_published_002',
        publishDate: '2026-06-11T12:00:00.000Z',
        state: 'PUBLISHED',
        integration: {
          id: 'int-test-x-002',
          identifier: 'x',
          name: '@test_handle',
        },
        content: 'strip me — already published',
      },
      {
        id: 'pst_test_draft_003',
        publishDate: '2026-06-12T12:00:00.000Z',
        state: 'DRAFT',
        integration: {
          id: 'int-test-x-003',
          identifier: 'x',
          name: '@test_handle',
        },
        content: 'strip me — draft',
      },
    ])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    const body = (await res.json()) as {
      ok: boolean
      posts: Array<{ id: string; state: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.posts).toHaveLength(1)
    expect(body.posts[0].id).toBe('pst_test_queue_001')
    expect(body.posts[0].state).toBe('QUEUE')
  })
})

describe('scheduled — SDK error path', () => {
  it('returns masked error envelope when postList() throws', async () => {
    const client = makeMockClient()
    client.postList.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND test-postiz.local'),
    )
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      ok: boolean
      error: string
      hint?: string
      posts: unknown[]
    }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Postiz unreachable/)
    expect(body.posts).toEqual([])
  })
})

describe('scheduled — LinkedIn stripping (defense-in-depth)', () => {
  it('strips posts whose integration.identifier resolves to LinkedIn', async () => {
    const client = makeMockClient()
    client.postList.mockResolvedValueOnce([
      {
        id: 'pst_test_x_001',
        publishDate: '2026-06-10T12:00:00.000Z',
        state: 'QUEUE',
        integration: {
          id: 'int-test-x-001',
          identifier: 'x',
          name: '@test_handle',
        },
        content: 'keep me',
      },
      {
        id: 'pst_test_li_002',
        publishDate: '2026-06-11T12:00:00.000Z',
        state: 'QUEUE',
        integration: {
          id: 'int-test-li-002',
          identifier: 'linkedin-page',
          name: 'should-be-stripped',
        },
        content: 'strip me',
      },
      {
        id: 'pst_test_li_003',
        publishDate: '2026-06-12T12:00:00.000Z',
        state: 'PUBLISHED',
        integration: {
          id: 'int-test-li-003',
          identifier: 'linkedin-company',
          name: 'also-strip-me',
        },
        content: 'also strip me',
      },
    ])
    vi.mocked(getPostizClient).mockReturnValueOnce(client as unknown as Postiz)

    const res = await handler({ request: buildRequest() })
    const body = (await res.json()) as {
      ok: boolean
      posts: Array<{ id: string; platform: { identifier: string } }>
    }
    expect(body.ok).toBe(true)
    expect(body.posts).toHaveLength(1)
    expect(body.posts[0].id).toBe('pst_test_x_001')
    expect(body.posts[0].platform.identifier).toBe('x')
    // Defense-in-depth: stringify and confirm no leak of the stripped IDs.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('linkedin')
    expect(serialized).not.toContain('pst_test_li_002')
    expect(serialized).not.toContain('pst_test_li_003')
  })
})
