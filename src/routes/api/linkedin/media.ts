// LinkedIn composer — serve a previously-uploaded media file back to the
// LinkedIn MCP (and to the browser for preview).
// GET /api/linkedin/media?token=<32hex>
//
// The MCP at 127.0.0.1:8120 fetches this URL to construct
// linkedin_create_post_with_image / _with_images / _with_document. Browser
// preview tiles also hit this route to render thumbnails.

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { createFileRoute } from '@tanstack/react-router'
import { requireLocalOrAuth } from '@/server/auth-middleware'
import { getMedia } from '@/server/linkedin-media-store'

export const Route = createFileRoute('/api/linkedin/media')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // The MCP server fetches from 127.0.0.1 with no cookie. Allow local
        // requests when password protection isn't gating; otherwise require
        // the session cookie like every other surface.
        if (!requireLocalOrAuth(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const url = new URL(request.url)
        const token = url.searchParams.get('token') ?? ''
        if (!token) {
          return new Response('token required', { status: 400 })
        }

        const entry = getMedia(token)
        if (!entry) {
          return new Response('Not found', { status: 404 })
        }

        // Stream the file from disk rather than loading the full buffer.
        const nodeStream = createReadStream(entry.filePath)
        const webStream = Readable.toWeb(
          nodeStream,
        ) as unknown as NodeReadableStream<Uint8Array>

        return new Response(webStream as unknown as BodyInit, {
          headers: {
            'content-type': entry.mimeType,
            'content-length': String(entry.byteLength),
            'content-disposition': `inline; filename="${entry.fileName}"`,
            'cache-control': 'private, max-age=300',
          },
        })
      },
    },
  },
})
