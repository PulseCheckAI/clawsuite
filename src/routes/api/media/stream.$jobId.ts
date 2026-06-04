// ── /api/media/stream/:jobId ────────────────────────────────────────────────
// GET proxy that streams the MP4 for a render job directly off local disk.
//
// render.mjs writes outputs to:
//   ${RENDERS_DIR}/${composition_id}-${job_id}.${ext}
// (render.mjs:68). The browser only knows job_id, so we scan the renders
// dir for a file matching `*-${jobId}.mp4`. Job ids are RFC4122 v4 UUIDs;
// we validate against a strict regex BEFORE touching the filesystem so a
// malicious id can't path-traverse.
//
// Range support: the <video> element issues `Range: bytes=START-END` for
// seek + progressive download. We parse the header and stream the byte
// slice with HTTP 206 + Content-Range. Without this, the browser refuses
// to seek and the progress bar locks at 0.
//
// Falls back to 404 when:
//   * jobId fails UUID validation
//   * no matching file in renders dir (job pending / failed / GC'd)
//
// No auth scope on the job today — every authed dashboard user can stream
// every render. Flagged for v2 (per-org filter needs render.mjs to store
// org id on the job ring buffer first).
// ────────────────────────────────────────────────────────────────────────────

import { createReadStream, existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { rendersDir } from '@/server/render-server'

// Strict RFC4122 v4 UUID — render.mjs uses crypto.randomUUID() which
// always emits this shape. Anything else is junk + a potential traversal
// attempt (e.g. ../../etc/passwd).
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function locateMp4(jobId: string): Promise<string | null> {
  const dir = rendersDir()
  if (!existsSync(dir)) return null
  let entries: Array<string>
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  // Scan for `<composition_id>-<jobId>.mp4`. Filename ends with
  // `-<jobId>.<ext>` (render.mjs:68); composition prefix unknown here.
  const suffix = `-${jobId.toLowerCase()}.mp4`
  for (const name of entries) {
    if (name.toLowerCase().endsWith(suffix)) {
      return join(dir, name)
    }
  }
  return null
}

interface ParsedRange {
  start: number
  end: number
}

/** Parse a single-range `bytes=START-END` (or open-ended `bytes=START-`)
 * header. Returns null for absent/multi-range/unparseable values — the
 * caller falls back to a full 200 stream in that case. */
function parseRange(
  header: string | null,
  fileSize: number,
): ParsedRange | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const startRaw = m[1]
  const endRaw = m[2]

  // Suffix range: `bytes=-N` → last N bytes.
  if (startRaw === '' && endRaw !== '') {
    const n = Number(endRaw)
    if (!Number.isFinite(n) || n <= 0) return null
    const start = Math.max(0, fileSize - n)
    return { start, end: fileSize - 1 }
  }

  if (startRaw === '') return null
  const start = Number(startRaw)
  if (!Number.isFinite(start) || start < 0 || start >= fileSize) return null
  const end =
    endRaw === '' ? fileSize - 1 : Math.min(fileSize - 1, Number(endRaw))
  if (!Number.isFinite(end) || end < start) return null
  return { start, end }
}

export const Route = createFileRoute('/api/media/stream/$jobId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const jobId = String(params.jobId || '').trim()
        if (!UUID_V4_RE.test(jobId)) {
          return json({ ok: false, error: 'invalid job id' }, { status: 400 })
        }

        const filePath = await locateMp4(jobId)
        if (!filePath) {
          return json({ ok: false, error: 'render not found' }, { status: 404 })
        }

        let stat: ReturnType<typeof statSync>
        try {
          stat = statSync(filePath)
        } catch {
          return json(
            { ok: false, error: 'render not readable' },
            { status: 404 },
          )
        }
        const fileSize = stat.size

        const rangeHeader = request.headers.get('range')
        const range = parseRange(rangeHeader, fileSize)

        // Disposition: inline so the <video> element can play it; we add
        // a Content-Disposition filename hint so the browser's download
        // dialog (Download link on the card uses <a download>) picks a
        // sensible name without us needing a second route.
        const baseHeaders: Record<string, string> = {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
          'Content-Disposition': `inline; filename="walkthrough-${jobId}.mp4"`,
        }

        if (range) {
          const { start, end } = range
          const chunkLen = end - start + 1
          const stream = createReadStream(filePath, { start, end })
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              ...baseHeaders,
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': String(chunkLen),
            },
          })
        }

        // No range / unparseable → full file at 200. Browsers will then
        // re-issue a ranged request on seek.
        const stream = createReadStream(filePath)
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 200,
          headers: {
            ...baseHeaders,
            'Content-Length': String(fileSize),
          },
        })
      },
    },
  },
})
