// LinkedIn composer — publish a post via the LinkedIn MCP.
// POST /api/linkedin/post
//
// Body shape:
//   {
//     text: string,                          // 1..3000 chars
//     visibility?: 'PUBLIC' | 'CONNECTIONS', // default PUBLIC
//     identityType: 'person' | 'organization',
//     linkedinId?: string,                   // optional, for person
//     organizationUrn?: string,              // required for organization
//     mediaTokens?: string[],                // tokens from /api/linkedin/upload
//     altTexts?: string[],                   // optional alt text per image
//   }
//
// The route picks the correct MCP tool based on mediaTokens length + asset
// type:
//   0 tokens                  → linkedin_create_post / company_create_post
//   1 IMAGE                   → linkedin_create_post_with_image
//   2..9 IMAGE                → linkedin_create_post_with_images
//   1 DOCUMENT (PDF)          → linkedin_create_post_with_document
//   1 VIDEO                   → 501 (not yet wired through the MCP)

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getMedia, type MediaEntry } from '@/server/linkedin-media-store'
import { callLinkedInMcp } from './_mcp'

interface PostBody {
  text?: unknown
  visibility?: unknown
  identityType?: unknown
  linkedinId?: unknown
  organizationUrn?: unknown
  mediaTokens?: unknown
  altTexts?: unknown
}

interface CreatePostResult {
  post_urn: string
  post_url?: string
  content_id?: string
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' && v.length > 0)
  )
}

export const Route = createFileRoute('/api/linkedin/post')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let body: PostBody
        try {
          body = (await request.json()) as PostBody
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!text) {
          return json({ ok: false, error: 'text is required' }, { status: 400 })
        }
        if (text.length > 3000) {
          return json(
            { ok: false, error: 'text exceeds LinkedIn 3000-char limit' },
            { status: 400 },
          )
        }

        const visibility =
          body.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC'
        const identityType =
          body.identityType === 'organization' ? 'organization' : 'person'
        const linkedinId =
          typeof body.linkedinId === 'string' && body.linkedinId.length > 0
            ? body.linkedinId
            : undefined
        const organizationUrn =
          typeof body.organizationUrn === 'string' &&
          body.organizationUrn.length > 0
            ? body.organizationUrn
            : undefined

        if (identityType === 'organization' && !organizationUrn) {
          return json(
            {
              ok: false,
              error:
                'organizationUrn is required when identityType=organization',
            },
            { status: 400 },
          )
        }

        // Resolve media tokens → entries. Reject unknown tokens loudly so the
        // user sees the issue instead of silently posting text-only.
        const mediaTokens = isStringArray(body.mediaTokens)
          ? body.mediaTokens
          : []
        const entries: MediaEntry[] = []
        for (const token of mediaTokens) {
          const entry = getMedia(token)
          if (!entry) {
            return json(
              {
                ok: false,
                error: `Unknown or expired media token: ${token}`,
              },
              { status: 400 },
            )
          }
          entries.push(entry)
        }

        const altTexts = isStringArray(body.altTexts) ? body.altTexts : []
        const inbound = new URL(request.url)

        // Determine asset-type homogeneity for the multi-image case.
        const assetTypes = new Set(entries.map((e) => e.assetType))
        if (entries.length > 1 && !assetTypes.has('IMAGE')) {
          return json(
            {
              ok: false,
              error: 'Multi-attach is only supported for IMAGE carousels',
            },
            { status: 400 },
          )
        }
        if (entries.length > 1 && assetTypes.size > 1) {
          return json(
            {
              ok: false,
              error:
                'Cannot mix media types in a single post. Pick all images, one document, or one video.',
            },
            { status: 400 },
          )
        }

        // Decide which MCP tool to call.
        let toolName: string
        let toolArgs: Record<string, unknown>

        if (entries.length === 0) {
          // Text-only
          if (identityType === 'organization') {
            toolName = 'linkedin_company_create_post'
            toolArgs = {
              organization_urn: organizationUrn,
              text,
              visibility: 'PUBLIC', // company posts are public-only
            }
          } else {
            toolName = 'linkedin_create_post'
            toolArgs = {
              text,
              visibility,
              ...(linkedinId ? { linkedin_id: linkedinId } : {}),
            }
          }
        } else if (entries.length === 1) {
          const entry = entries[0]!
          const fileUrl = `${inbound.origin}/api/linkedin/media?token=${entry.token}`
          if (entry.assetType === 'IMAGE') {
            toolName = 'linkedin_create_post_with_image'
            toolArgs = {
              text,
              visibility,
              image_url: fileUrl,
              ...(altTexts[0] ? { image_alt_text: altTexts[0] } : {}),
              ...(linkedinId ? { linkedin_id: linkedinId } : {}),
            }
          } else if (entry.assetType === 'DOCUMENT') {
            toolName = 'linkedin_create_post_with_document'
            toolArgs = {
              text,
              visibility,
              document_url: fileUrl,
              document_title: entry.fileName.replace(/\.[^.]+$/, ''),
              ...(linkedinId ? { linkedin_id: linkedinId } : {}),
            }
          } else {
            return json(
              {
                ok: false,
                error:
                  'Video posts are not yet supported via this composer. The LinkedIn MCP does not expose a video-attach helper; coordinate with the MCP team to add linkedin_create_post_with_video.',
              },
              { status: 501 },
            )
          }
        } else {
          // 2..9 images carousel
          if (entries.length > 9) {
            return json(
              {
                ok: false,
                error: 'LinkedIn carousels support at most 9 images',
              },
              { status: 400 },
            )
          }
          toolName = 'linkedin_create_post_with_images'
          toolArgs = {
            text,
            visibility,
            image_urls: entries.map(
              (e) => `${inbound.origin}/api/linkedin/media?token=${e.token}`,
            ),
            ...(altTexts.length > 0 ? { image_alt_texts: altTexts } : {}),
            ...(linkedinId ? { linkedin_id: linkedinId } : {}),
          }
        }

        // Posts may take 10-30s when the MCP also has to push the image up to
        // LinkedIn Assets, so bump the timeout.
        const result = await callLinkedInMcp<CreatePostResult>(
          toolName,
          toolArgs,
          90_000,
        )

        if (!result.ok) {
          return json(
            {
              ok: false,
              error: result.error,
              code: result.code,
              hint: result.hint,
              tool: toolName,
            },
            { status: result.status },
          )
        }

        return json({
          ok: true,
          tool: toolName,
          postUrn: result.data.post_urn,
          postUrl: result.data.post_url ?? null,
          contentId: result.data.content_id ?? null,
        })
      },
    },
  },
})
