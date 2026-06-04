// -- /api/voice-engine/voices/clone -- multipart upload handler ----------
//
// Phase 4 of the Voice Hub: accepts a multipart/form-data POST from the
// browser ("Add new voice" sheet in /voice/voices) and routes the audio
// to the right backend:
//
//   * provider="xtts"  -> forwarded to voice-engine's /voices/clone, which
//                          uploads the WAV to portable-tts-server (port 8100)
//                          and inserts a public.voice_library row. Returns
//                          the new row to the browser.
//
//   * provider="hume"  -> NOT YET WIRED. Hume's custom-voice API requires a
//                          `generation_id` from a prior TTS run, not a raw
//                          audio upload (see hume-python-sdk
//                          src/hume/tts/voices/client.py:105). Returning a
//                          structured 501 so the dashboard can show a clear
//                          message and Phase 4.1 can add the
//                          "synth-then-save" Hume flow.
//
// We do all validation here (size, mime, name regex) BEFORE base64-encoding
// + forwarding, so a malformed upload fails fast without hitting the engine.
//
// The browser NEVER hits voice-engine directly -- HMAC + X-Org-Id are
// attached server-side via forwardToVoiceEngine().

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  forwardToVoiceEngine,
  getServerOrgId,
  isVoiceEngineReady,
} from '@/server/voice-engine'

// -- Constants -------------------------------------------------------------

const MAX_AUDIO_BYTES = 10 * 1024 * 1024 // 10 MiB
const NAME_RE = /^[A-Za-z0-9 _-]{2,64}$/
const ALLOWED_PROVIDERS = new Set(['hume', 'xtts'])
const ALLOWED_MIMES = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
])
const WAV_MIMES = new Set(['audio/wav', 'audio/wave', 'audio/x-wav'])

// -- Route -----------------------------------------------------------------

export const Route = createFileRoute('/api/voice-engine/voices/clone')({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        // Parse multipart. TanStack Start's request is a standard Fetch
        // Request, so .formData() handles multipart natively -- no multer.
        let form: FormData
        try {
          form = await request.formData()
        } catch (e) {
          return json(
            {
              ok: false,
              error: `invalid multipart body: ${e instanceof Error ? e.message : String(e)}`,
            },
            { status: 400 },
          )
        }

        const audio = form.get('audio')
        const nameRaw = form.get('name')
        const providerRaw = form.get('provider')
        const descriptionRaw = form.get('description')

        // -- Validate name --------------------------------------------------
        if (typeof nameRaw !== 'string' || !NAME_RE.test(nameRaw.trim())) {
          return json(
            {
              ok: false,
              error:
                'name must be 2-64 chars, A-Za-z0-9 space underscore dash only',
            },
            { status: 400 },
          )
        }
        const display_name = nameRaw.trim()

        // -- Validate provider ----------------------------------------------
        if (
          typeof providerRaw !== 'string' ||
          !ALLOWED_PROVIDERS.has(providerRaw)
        ) {
          return json(
            {
              ok: false,
              error: "provider must be 'hume' or 'xtts'",
            },
            { status: 400 },
          )
        }
        const provider = providerRaw as 'hume' | 'xtts'

        // -- Validate audio file --------------------------------------------
        if (!(audio instanceof File)) {
          return json(
            { ok: false, error: 'audio file is required' },
            { status: 400 },
          )
        }
        if (audio.size === 0) {
          return json(
            { ok: false, error: 'audio file is empty' },
            { status: 400 },
          )
        }
        if (audio.size > MAX_AUDIO_BYTES) {
          return json(
            {
              ok: false,
              error: `audio file exceeds 10 MB (got ${audio.size} bytes)`,
            },
            { status: 413 },
          )
        }
        const mime = (audio.type || '').toLowerCase()
        if (!ALLOWED_MIMES.has(mime)) {
          return json(
            {
              ok: false,
              error: `audio MIME must be wav or mp3 (got '${mime || 'unknown'}')`,
            },
            { status: 415 },
          )
        }
        if (provider === 'xtts' && !WAV_MIMES.has(mime)) {
          return json(
            {
              ok: false,
              error:
                'XTTS voice cloning requires a .wav file -- mp3 is not accepted by the cascade. Re-export as WAV and try again.',
            },
            { status: 415 },
          )
        }

        // -- Hume short-circuit ---------------------------------------------
        // Server-side defense -- the UI disables this radio in
        // voice.voices.tsx; this only fires if someone bypasses the UI
        // (e.g. crafts a raw POST). Friendly 501 is the right answer here.
        //
        // Hume's voice-creation endpoint (POST v0/tts/voices) takes a
        // generation_id from a prior TTS, NOT raw audio. See:
        //   hume-python-sdk/src/hume/tts/voices/raw_client.py:127 (create)
        //   hume-python-sdk/src/hume/tts/voices/raw_client.py:152 (URL)
        // The "upload your own audio" flow lives only inside Hume's web app
        // (Voice Library uploader), not in the public SDK/API. Until we add
        // the synth-and-save flow, surface a precise 501 so any bypass
        // attempt gets a clear error rather than a generic 5xx.
        if (provider === 'hume') {
          return json(
            {
              ok: false,
              error:
                "Hume voice cloning from raw audio is not exposed in Hume's public API. " +
                'Use the XTTS provider for direct audio cloning, or pick a Hume preset voice ' +
                'from the library in /voice/settings. Phase 4.1 will add the Hume ' +
                'synth-and-save flow (TTS generation -> custom voice).',
              code: 'HUME_CLONE_NOT_SUPPORTED',
            },
            { status: 501 },
          )
        }

        // -- XTTS path: base64-encode + forward to voice-engine -------------
        // voice-engine's /voices/clone expects JSON:
        //   { organization_id, display_name, source_audio_b64,
        //     consent_recorded_at }
        // and itself: (1) decodes the b64, (2) POSTs the bytes to
        // portable-tts as tts_models/voices/<uuid>.wav, (3) inserts a
        // public.voice_library row. The dashboard never touches the WAV path
        // directly.
        const orgId = getServerOrgId()
        if (!orgId) {
          return json(
            {
              ok: false,
              error:
                'VOICE_HUB_ORG_ID not set on dashboard server -- cannot derive organization for voice_library row.',
            },
            { status: 503 },
          )
        }

        const buf = Buffer.from(await audio.arrayBuffer())
        const source_audio_b64 = buf.toString('base64')

        // Optional description is captured for the dashboard's later display
        // but voice_library has no description column today, so we pass it
        // through and let voice-engine ignore unknown fields. (Pydantic
        // tolerates extras by default in the CloneVoiceBody model.)
        const description =
          typeof descriptionRaw === 'string' && descriptionRaw.trim().length > 0
            ? descriptionRaw.trim().slice(0, 600)
            : undefined

        const body: Record<string, unknown> = {
          organization_id: orgId,
          display_name,
          source_audio_b64,
          consent_recorded_at: new Date().toISOString(),
        }
        if (description !== undefined) body.description = description

        const res = await forwardToVoiceEngine({
          path: '/api/voices/clone',
          method: 'POST',
          body,
          // Big WAVs + portable-tts cold start can take a while; be generous.
          timeoutMs: 120_000,
        })
        return json(res.body as any, { status: res.status })
      },
    },
  },
})
