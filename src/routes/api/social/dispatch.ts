// Cross-platform social-routing dispatcher.
// POST /api/social/dispatch
//
// Validates an artifact URL, then fans out in parallel to LinkedIn (real,
// via the existing LinkedIn MCP) + Instagram + Facebook (honest stubs —
// the IG/FB MCPs do not exist yet; we return status:'not_wired' rather
// than fabricating a successful post). LinkedIn token retrieval lives
// inside the MCP server; this route only forwards the linkedin_id.
//
// Honesty contract:
//   - Instagram & Facebook handlers ALWAYS return status='not_wired'.
//     Never return 'posted' for those platforms — gate that behind the
//     MCPs actually being implemented at main/apps/mcps/{instagram,facebook}/.
//   - LinkedIn returns 'failed' (not 'posted') if the MCP call fails.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { callLinkedInMcp } from '@/routes/api/linkedin/_mcp'
import {
  ALLOWED_MIME_TYPES,
  type DispatchPayload,
  type DispatchResult,
  type PlatformResult,
  type SocialPlatform,
} from '@/types/social-dispatch'

// ─── helpers ───────────────────────────────────────────────────────────────

function isValidPlatform(value: unknown): value is SocialPlatform {
  return value === 'linkedin' || value === 'instagram' || value === 'facebook'
}

function buildCaption(
  caption: string | undefined,
  hashtags: string[] | undefined,
): string {
  const body = (caption ?? '').trim()
  const tags = (hashtags ?? [])
    .map((tag) => tag.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(' ')
  if (!body) return tags
  if (!tags) return body
  return `${body}\n\n${tags}`
}

/**
 * HEAD the artifact URL to confirm reachability + extract mime. If the
 * caller supplied a mime, we still issue the HEAD to confirm the URL is
 * live; on failure we surface the network error.
 */
async function inspectArtifact(
  url: string,
  declaredMime: string | undefined,
): Promise<{ ok: true; mimeType: string } | { ok: false; error: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'artifactUrl is not a valid URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'artifactUrl must be http(s)' }
  }
  let head: Response
  try {
    head = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    return {
      ok: false,
      error: `artifactUrl unreachable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!head.ok) {
    return { ok: false, error: `artifactUrl HEAD returned HTTP ${head.status}` }
  }
  const headerMime =
    head.headers.get('content-type')?.split(';')[0]?.trim() ?? null
  const mime = declaredMime ?? headerMime ?? ''
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    return {
      ok: false,
      error: `mime '${mime || 'unknown'}' not in allowlist (${ALLOWED_MIME_TYPES.join(', ')})`,
    }
  }
  return { ok: true, mimeType: mime }
}

// ─── platform handlers ─────────────────────────────────────────────────────

async function dispatchLinkedIn(
  payload: DispatchPayload,
  mime: string,
  startedAt: number,
): Promise<PlatformResult> {
  const platform: SocialPlatform = 'linkedin'
  const text = buildCaption(payload.caption, payload.hashtags)
  const visibility = payload.visibility ?? 'PUBLIC'

  let toolName: string
  let args: Record<string, unknown>
  if (mime.startsWith('image/')) {
    toolName = 'linkedin_create_post_with_image'
    args = {
      text,
      visibility,
      image_url: payload.artifactUrl,
      linkedin_id: payload.identityId,
    }
  } else if (mime === 'application/pdf') {
    toolName = 'linkedin_create_post_with_document'
    args = {
      text,
      visibility,
      document_url: payload.artifactUrl,
      linkedin_id: payload.identityId,
    }
  } else if (mime === 'video/mp4') {
    // Honest 501 — the LinkedIn MCP has `linkedin_upload_asset` for VIDEO
    // but no `linkedin_create_post_with_video` create helper yet. Don't
    // try to fake a post — return failed with a clear actionable message.
    return {
      platform,
      status: 'failed',
      message:
        'Video posting not yet implemented in linkedin-mcp. Add a create_post_with_video tool at main/apps/mcps/linkedin/src/tools/ before retrying.',
      durationMs: Date.now() - startedAt,
    }
  } else {
    return {
      platform,
      status: 'failed',
      message: `Unsupported mime for LinkedIn: ${mime}`,
      durationMs: Date.now() - startedAt,
    }
  }

  const result = await callLinkedInMcp<{ post_id?: string; urn?: string }>(
    toolName,
    args,
    60_000,
  )
  if (!result.ok) {
    return {
      platform,
      status: 'failed',
      message: result.error,
      durationMs: Date.now() - startedAt,
    }
  }
  return {
    platform,
    status: 'posted',
    message: 'LinkedIn post created',
    postId: result.data.urn ?? result.data.post_id,
    durationMs: Date.now() - startedAt,
  }
}

function dispatchInstagram(startedAt: number): PlatformResult {
  return {
    platform: 'instagram',
    status: 'not_wired',
    message:
      'Instagram MCP not implemented. TODO: add main/apps/mcps/instagram/ targeting Instagram Graph API.',
    durationMs: Date.now() - startedAt,
  }
}

function dispatchFacebook(startedAt: number): PlatformResult {
  return {
    platform: 'facebook',
    status: 'not_wired',
    message:
      'Facebook MCP not implemented. TODO: add main/apps/mcps/facebook/ targeting Facebook Graph API.',
    durationMs: Date.now() - startedAt,
  }
}

// ─── route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/social/dispatch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json(
            {
              ok: false,
              allPosted: false,
              mimeType: null,
              results: [],
              error: 'Unauthorized',
            } satisfies DispatchResult,
            { status: 401 },
          )
        }

        let payload: DispatchPayload
        try {
          payload = (await request.json()) as DispatchPayload
        } catch (err) {
          return json(
            {
              ok: false,
              allPosted: false,
              mimeType: null,
              results: [],
              error: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
            } satisfies DispatchResult,
            { status: 400 },
          )
        }

        // shape validation
        if (!payload || typeof payload !== 'object') {
          return json(
            {
              ok: false,
              allPosted: false,
              mimeType: null,
              results: [],
              error: 'Body must be a JSON object',
            } satisfies DispatchResult,
            { status: 400 },
          )
        }
        if (typeof payload.artifactUrl !== 'string' || !payload.artifactUrl) {
          return json(
            {
              ok: false,
              allPosted: false,
              mimeType: null,
              results: [],
              error: 'artifactUrl required',
            } satisfies DispatchResult,
            { status: 400 },
          )
        }
        if (typeof payload.identityId !== 'string' || !payload.identityId) {
          return json(
            {
              ok: false,
              allPosted: false,
              mimeType: null,
              results: [],
              error: 'identityId required',
            } satisfies DispatchResult,
            { status: 400 },
          )
        }
        const targets = Array.isArray(payload.targets)
          ? payload.targets.filter(isValidPlatform)
          : []
        if (targets.length === 0) {
          return json(
            {
              ok: false,
              allPosted: false,
              mimeType: null,
              results: [],
              error:
                'targets must include at least one of linkedin|instagram|facebook',
            } satisfies DispatchResult,
            { status: 400 },
          )
        }

        // artifact preflight
        const inspected = await inspectArtifact(
          payload.artifactUrl,
          payload.mimeType,
        )
        if (!inspected.ok) {
          return json(
            {
              ok: false,
              allPosted: false,
              mimeType: null,
              results: [],
              error: inspected.error,
            } satisfies DispatchResult,
            { status: 400 },
          )
        }
        const mime = inspected.mimeType

        // parallel fan-out
        const startedAt = Date.now()
        const handlers: Promise<PlatformResult>[] = targets.map((target) => {
          if (target === 'linkedin')
            return dispatchLinkedIn(payload, mime, startedAt)
          if (target === 'instagram')
            return Promise.resolve(dispatchInstagram(startedAt))
          return Promise.resolve(dispatchFacebook(startedAt))
        })

        const settled = await Promise.allSettled(handlers)
        const results: PlatformResult[] = settled.map((entry, idx) => {
          if (entry.status === 'fulfilled') return entry.value
          const platform = targets[idx]!
          return {
            platform,
            status: 'failed',
            message: `Handler threw: ${entry.reason instanceof Error ? entry.reason.message : String(entry.reason)}`,
            durationMs: Date.now() - startedAt,
          }
        })

        const allPosted = results.every((r) => r.status === 'posted')
        return json(
          {
            ok: true,
            allPosted,
            mimeType: mime,
            results,
          } satisfies DispatchResult,
          { status: 200 },
        )
      },
    },
  },
})
