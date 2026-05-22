// LinkedIn composer — upload media to the in-process media store.
// POST /api/linkedin/upload
//
// Body shape:
//   { fileName: string, mimeType: string, base64: string }
//
// Returns:
//   { ok: true, token, fileUrl, fileName, mimeType, assetType, byteLength }
//
// The fileUrl points back at /api/linkedin/media?token=... so the MCP server
// (separate process at 127.0.0.1:8120) can fetch the bytes when constructing a
// post with image/document/video.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  classifyAssetType,
  removeMedia,
  storeMedia,
} from '@/server/linkedin-media-store'

const MAX_BYTES = 20 * 1024 * 1024 // 20 MB hard cap (brief)

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
])

interface UploadBody {
  fileName?: unknown
  mimeType?: unknown
  base64?: unknown
}

export const Route = createFileRoute('/api/linkedin/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let body: UploadBody
        try {
          body = (await request.json()) as UploadBody
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const fileName =
          typeof body.fileName === 'string' ? body.fileName.trim() : ''
        const mimeType =
          typeof body.mimeType === 'string' ? body.mimeType.trim() : ''
        const base64 = typeof body.base64 === 'string' ? body.base64 : ''

        if (!fileName) {
          return json(
            { ok: false, error: 'fileName is required' },
            { status: 400 },
          )
        }
        if (!ALLOWED_MIMES.has(mimeType)) {
          return json(
            {
              ok: false,
              error: `Unsupported mime type: ${mimeType || '(empty)'}. Allowed: jpg, png, gif, webp, pdf, mp4.`,
            },
            { status: 415 },
          )
        }
        if (!classifyAssetType(mimeType)) {
          return json(
            {
              ok: false,
              error: 'mime type does not map to IMAGE/VIDEO/DOCUMENT',
            },
            { status: 415 },
          )
        }
        if (!base64) {
          return json(
            { ok: false, error: 'base64 payload is required' },
            { status: 400 },
          )
        }

        // Strip data-url prefix if present (e.g. "data:image/png;base64,...").
        const cleaned = base64.includes(',')
          ? base64.slice(base64.indexOf(',') + 1)
          : base64

        let bytes: Buffer
        try {
          bytes = Buffer.from(cleaned, 'base64')
        } catch (err) {
          return json(
            {
              ok: false,
              error: `Failed to decode base64: ${err instanceof Error ? err.message : String(err)}`,
            },
            { status: 400 },
          )
        }

        if (bytes.byteLength === 0) {
          return json(
            { ok: false, error: 'Empty file after decode' },
            { status: 400 },
          )
        }
        if (bytes.byteLength > MAX_BYTES) {
          return json(
            {
              ok: false,
              error: `File too large: ${bytes.byteLength} bytes (max ${MAX_BYTES}).`,
            },
            { status: 413 },
          )
        }

        let entry: ReturnType<typeof storeMedia>
        try {
          entry = storeMedia({ bytes, fileName, mimeType })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }

        const inbound = new URL(request.url)
        const fileUrl = `${inbound.origin}/api/linkedin/media?token=${entry.token}`

        return json({
          ok: true,
          token: entry.token,
          fileUrl,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          assetType: entry.assetType,
          byteLength: entry.byteLength,
        })
      },
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const token = url.searchParams.get('token') ?? ''
        if (!token) {
          return json(
            { ok: false, error: 'token query param required' },
            { status: 400 },
          )
        }
        const removed = removeMedia(token)
        return json({ ok: true, removed })
      },
    },
  },
})
