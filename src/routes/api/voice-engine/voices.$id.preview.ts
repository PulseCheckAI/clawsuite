// -- /api/voice-engine/voices/{id}/preview -- TTS smoke-test ----------------
//
// GET /api/voice-engine/voices/:id/preview?text=Hello%20world
//
// Looks up the requested voice in voice-engine (which enforces tenant scope
// via the HMAC + X-Org-Id headers), and synthesises a short clip so the
// operator can hear what the clone sounds like inside the "Add new voice"
// flow.
//
// Routing rules:
//   * Cloned voices (rows in public.voice_library): the row's source_path is
//     handed to portable-tts-server's XTTS endpoint as reference_audio so
//     XTTS clones the speaker.
//   * Built-in XTTS voices (id starts with "xtts:"): mode=builtin, voice=name.
//   * Built-in Kokoro voices (id starts with "kokoro:"): mode=builtin via
//     /api/tts/kokoro.
//   * Hume voices: NOT YET WIRED (Hume preview requires a token + WS dance).
//
// Returns the audio bytes inline (Content-Type: audio/wav by default; mp3
// if the cascade chose to encode that). Never streams JSON on the happy path
// so the browser can pipe straight into <audio src=blob:...>.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  forwardToVoiceEngine,
  getServerOrgId,
  isVoiceEngineReady,
} from '@/server/voice-engine'

const MAX_TEXT_CHARS = 200
const PORTABLE_TTS_DEFAULT = 'http://127.0.0.1:8100'

interface VoiceLibraryRow {
  id?: string
  display_name?: string
  source_path?: string // voice-engine still writes this name (drift vs migration)
  source_audio_url?: string // canonical column per migration 20260525180000
  organization_id?: string
}

interface VoiceEngineListVoicesResponse {
  kokoro?: Array<{ id?: string; name?: string; [k: string]: unknown }>
  xtts?: Array<{ id?: string; name?: string; [k: string]: unknown }>
  cloned?: Array<VoiceLibraryRow>
}

export const Route = createFileRoute('/api/voice-engine/voices/$id/preview')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ready = isVoiceEngineReady()
        if (!ready.ok) {
          return json(
            {
              ok: false,
              error: `voice-engine not configured: ${ready.reason}`,
            },
            { status: 503 },
          )
        }

        const rawId = String(params.id || '').trim()
        if (!rawId) {
          return json({ ok: false, error: 'missing voice id' }, { status: 400 })
        }

        const url = new URL(request.url)
        const text = (url.searchParams.get('text') || '').trim()
        if (!text) {
          return json(
            { ok: false, error: 'query param `text` is required' },
            { status: 400 },
          )
        }
        if (text.length > MAX_TEXT_CHARS) {
          return json(
            {
              ok: false,
              error: `text exceeds ${MAX_TEXT_CHARS} chars (got ${text.length})`,
            },
            { status: 400 },
          )
        }

        const orgId = getServerOrgId()
        if (!orgId) {
          return json(
            {
              ok: false,
              error: 'VOICE_HUB_ORG_ID not set -- cannot resolve tenant',
            },
            { status: 503 },
          )
        }

        // Resolve the voice through voice-engine's /voices list. voice-engine
        // already filters cloned voices by the X-Org-Id header so this is
        // tenant-safe: a request for another org's id simply won't match.
        const listRes = await forwardToVoiceEngine({
          path: `/api/voices?org=${encodeURIComponent(orgId)}`,
          method: 'GET',
          timeoutMs: 8_000,
        })
        if (listRes.status >= 400) {
          return json(listRes.body as any, { status: listRes.status })
        }
        const list = (listRes.body || {}) as VoiceEngineListVoicesResponse

        // Three id shapes:
        //   1. "kokoro:<voice_name>"  -- built-in
        //   2. "xtts:<voice_name>"    -- built-in
        //   3. <uuid>                 -- public.voice_library.id (cloned)
        let engine: 'xtts' | 'kokoro'
        let payload: Record<string, unknown>

        if (rawId.startsWith('kokoro:')) {
          const voiceName = rawId.slice('kokoro:'.length)
          if (!voiceName) {
            return json(
              { ok: false, error: 'malformed kokoro voice id' },
              { status: 400 },
            )
          }
          const match = (list.kokoro || []).find(
            (v) => v.id === voiceName || v.name === voiceName,
          )
          if (!match) {
            return json(
              { ok: false, error: 'kokoro voice not found' },
              { status: 404 },
            )
          }
          engine = 'kokoro'
          payload = { text, voice: voiceName, output_format: 'wav' }
        } else if (rawId.startsWith('xtts:')) {
          const voiceName = rawId.slice('xtts:'.length)
          if (!voiceName) {
            return json(
              { ok: false, error: 'malformed xtts voice id' },
              { status: 400 },
            )
          }
          const match = (list.xtts || []).find(
            (v) => v.id === voiceName || v.name === voiceName,
          )
          if (!match) {
            return json(
              { ok: false, error: 'xtts built-in voice not found' },
              { status: 404 },
            )
          }
          engine = 'xtts'
          payload = {
            text,
            voice: voiceName,
            mode: 'builtin',
            output_format: 'wav',
          }
        } else {
          // Cloned voice: row by UUID inside the (already-org-scoped) list.
          const row = (list.cloned || []).find((r) => r.id === rawId)
          if (!row) {
            return json(
              {
                ok: false,
                error: 'voice not found in this organization',
              },
              { status: 404 },
            )
          }
          // Use the canonical source_audio_url column if present, else fall
          // back to source_path (voice-engine's name, see api/voices.py
          // _upload_to_portable_tts() which writes `tts_models/voices/<id>.wav`).
          const refPath = row.source_audio_url || row.source_path
          if (!refPath) {
            return json(
              {
                ok: false,
                error:
                  'voice has no source audio path -- cannot synthesize preview',
              },
              { status: 422 },
            )
          }
          engine = 'xtts'
          // portable-tts XTTS contract -- per the deployed worker (see
          // memory: "voice=<wav-path> + mode=cloned (NOT reference_audio)").
          // The README also documents reference_audio as base64 for the
          // generic flow, but the local cascade is patched to read the
          // `voice` path directly for per-org refs that already live under
          // tts_models/voices/. We pass both keys so it works either way.
          payload = {
            text,
            voice: refPath,
            mode: 'cloned',
            reference_audio: refPath,
            output_format: 'wav',
          }
        }

        // Hit portable-tts-server.
        const portableBase = (
          process.env.PORTABLE_TTS_URL || PORTABLE_TTS_DEFAULT
        ).replace(/\/$/, '')
        const ttsUrl = `${portableBase}/api/tts/${engine}`

        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 60_000)
        let ttsRes: Response
        try {
          ttsRes = await fetch(ttsUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(payload),
            signal: ctrl.signal,
          })
        } catch (e) {
          clearTimeout(t)
          return json(
            {
              ok: false,
              error: `portable-tts call failed: ${e instanceof Error ? e.message : String(e)}`,
            },
            { status: 502 },
          )
        }
        clearTimeout(t)

        if (!ttsRes.ok) {
          // Surface the cascade's error text so the dashboard can show it.
          const detail = await ttsRes.text().catch(() => '')
          return json(
            {
              ok: false,
              error: `portable-tts ${ttsRes.status}: ${detail.slice(0, 500) || 'no body'}`,
            },
            { status: 502 },
          )
        }

        // portable-tts returns JSON with `audio_base64`. Decode + return as
        // raw audio so the browser can render <audio src=blob:...> directly.
        const body = (await ttsRes.json().catch(() => null)) as {
          audio_base64?: string
          format?: string
          sample_rate?: number
        } | null
        if (!body || typeof body.audio_base64 !== 'string') {
          return json(
            {
              ok: false,
              error: 'portable-tts response missing audio_base64',
            },
            { status: 502 },
          )
        }
        const audioBytes = Buffer.from(body.audio_base64, 'base64')
        const fmt = (body.format || 'wav').toLowerCase()
        const contentType =
          fmt === 'mp3'
            ? 'audio/mpeg'
            : fmt === 'ogg'
              ? 'audio/ogg'
              : fmt === 'flac'
                ? 'audio/flac'
                : fmt === 'm4a'
                  ? 'audio/mp4'
                  : 'audio/wav'

        return new Response(audioBytes, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(audioBytes.byteLength),
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
