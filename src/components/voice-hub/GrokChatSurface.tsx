// ── GrokChatSurface ────────────────────────────────────────────────────────
// Browser body of /voice/grok-chat — the xAI Grok Voice business-analytics
// surface (Phase 6).
//
// Lifecycle (xAI implementation-guide checklist, all 11 items):
//   1. Fetch /api/voice-engine/grok-token → ephemeral client_secret +
//      session_defaults.
//   2. In PARALLEL on user-gesture click:
//        a. open AudioContext (warmup the audio graph inside the gesture
//           so iOS Safari doesn't deny playback later)
//        b. open WebSocket to wss://api.x.ai/v1/realtime?model=<model>
//           with subprotocol `xai-client-secret.<ephemeral>`
//        c. getUserMedia({ audio }) and pipe through pcm-downsample-processor
//   3. Buffer mic frames until we see {type:"session.updated"}; then flush.
//   4. session.update sent immediately on WS open with locked
//      session_defaults from the token server (instructions + tools +
//      turn_detection + input_audio_transcription).
//   5. Chunked base64 encoding (32 KB chunks) to avoid stack overflow on
//      apply(null, bigArray).
//   6. response.output_audio.delta → decode base64 linear16 → enqueue at
//      24 kHz on an AudioBufferSourceNode chain.
//   7. input_audio_buffer.speech_started → stop in-flight playback +
//      send {type:"response.cancel"} so xAI also stops generating.
//   8. response.function_call_arguments.done → respond with explicit
//      "tool unavailable on browser surface" message so the agent
//      gracefully escalates instead of hanging. Tool dispatch is a
//      RELAY-side concern (tools.py is the source of truth and only the
//      phone relay process can talk to MCPs over stdio).
//   9. Transcript pane: AnimatePresence enter/exit per turn.
//  10. RMS amplitude visualizer on the talk button (mic Float32 → rms).
//  11. Cleanup on unmount: WS close + AudioContext close + mic tracks stop.
// ───────────────────────────────────────────────────────────────────────────

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { LiquidGlassPanel } from '@/components/voice-hub/LiquidGlassPanel'

type TokenResponse = {
  ok: true
  client_secret: string
  expires_in: number | null
  model: string
  voice: string
  instructions: string
  session_defaults: Record<string, unknown>
}

type TokenError = { ok: false; error: string }

type TranscriptTurn = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  ts: number
}

type ConnState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

const XAI_WS_URL_BASE = 'wss://api.x.ai/v1/realtime'

// ── Helpers ────────────────────────────────────────────────────────────────

function chunkedBase64(bytes: Uint8Array): string {
  // 32 KB chunks — well under the apply() argument-count limit on every
  // browser engine. Avoids stack overflow on long audio frames.
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    bin += String.fromCharCode.apply(null, Array.from(slice))
  }
  return btoa(bin)
}

function decodeBase64ToInt16(b64: string): Int16Array {
  const bin = atob(b64)
  const out = new Int16Array(bin.length / 2)
  for (let i = 0; i < out.length; i++) {
    const lo = bin.charCodeAt(i * 2)
    const hi = bin.charCodeAt(i * 2 + 1)
    let v = (hi << 8) | lo
    if (v & 0x8000) v -= 0x10000
    out[i] = v
  }
  return out
}

function rmsOf(samples: Float32Array): number {
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  return Math.sqrt(sumSq / Math.max(1, samples.length))
}

// ── Component ──────────────────────────────────────────────────────────────

export function GrokChatSurface(): ReactElement {
  const [token, setToken] = useState<TokenResponse | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [conn, setConn] = useState<ConnState>('idle')
  const [transcript, setTranscript] = useState<Array<TranscriptTurn>>([])
  const [micLevel, setMicLevel] = useState(0)
  const reduce = useReducedMotion()

  // Refs — keep across renders without re-triggering effects.
  const wsRef = useRef<WebSocket | null>(null)
  const sessionReadyRef = useRef(false)
  const pendingFramesRef = useRef<Array<string>>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const playbackQueueRef = useRef<Array<AudioBufferSourceNode>>([])
  const playbackTimeRef = useRef(0)
  const callIdsSeenRef = useRef<Set<string>>(new Set())

  // ── 1. Fetch token on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/voice-engine/grok-token', {
          credentials: 'same-origin',
        })
        const body = (await res.json().catch(() => null)) as
          | TokenResponse
          | TokenError
          | null
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- closure flag flipped by async cleanup; static narrowing can't see it
        if (cancelled) return
        if (!body || body.ok !== true) {
          setTokenError(
            body && 'error' in body
              ? body.error
              : `token fetch failed (${res.status})`,
          )
          return
        }
        setToken(body)
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- closure flag flipped by async cleanup; static narrowing can't see it
        if (!cancelled) {
          setTokenError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Cleanup on unmount (item 11) ────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        wsRef.current?.close()
      } catch {
        /* noop */
      }
      try {
        workletNodeRef.current?.disconnect()
      } catch {
        /* noop */
      }
      try {
        sourceNodeRef.current?.disconnect()
      } catch {
        /* noop */
      }
      try {
        micStreamRef.current?.getTracks().forEach((t) => t.stop())
      } catch {
        /* noop */
      }
      try {
        void audioCtxRef.current?.close()
      } catch {
        /* noop */
      }
    }
  }, [])

  // ── Playback helpers (defined first so callbacks can reference them) ────
  const enqueuePlayback = useCallback((b64: string) => {
    const ac = audioCtxRef.current
    if (!ac) return
    const int16 = decodeBase64ToInt16(b64)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000
    const buf = ac.createBuffer(1, float32.length, 24000)
    buf.copyToChannel(float32, 0)
    const src = ac.createBufferSource()
    src.buffer = buf
    src.connect(ac.destination)
    const now = ac.currentTime
    const startAt = Math.max(now, playbackTimeRef.current)
    src.start(startAt)
    playbackTimeRef.current = startAt + buf.duration
    playbackQueueRef.current.push(src)
    src.onended = () => {
      playbackQueueRef.current = playbackQueueRef.current.filter(
        (s) => s !== src,
      )
    }
  }, [])

  const stopPlayback = useCallback(() => {
    for (const src of playbackQueueRef.current) {
      try {
        src.stop()
      } catch {
        /* already done */
      }
    }
    playbackQueueRef.current = []
    playbackTimeRef.current = 0
  }, [])

  const appendTranscript = useCallback(
    (role: TranscriptTurn['role'], text: string) => {
      setTranscript((t) => [
        ...t,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          text,
          ts: Date.now(),
        },
      ])
    },
    [],
  )

  // ── Server-event dispatcher (items 3, 6, 7, 8) ──────────────────────────
  const handleServerEvent = useCallback(
    async (msg: { type?: string; [k: string]: unknown }) => {
      const t = msg.type ?? ''
      if (t === 'session.updated') {
        sessionReadyRef.current = true
        setConn('connected')
        const ws = wsRef.current
        const pending = pendingFramesRef.current
        pendingFramesRef.current = []
        if (ws && ws.readyState === WebSocket.OPEN) {
          for (const f of pending) ws.send(f)
        }
        return
      }
      if (t === 'response.output_audio.delta') {
        const b64 = msg.delta as string | undefined
        if (!b64) return
        enqueuePlayback(b64)
        return
      }
      if (t === 'input_audio_buffer.speech_started') {
        // 7. Stop in-flight playback + tell xAI to stop generating.
        stopPlayback()
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'response.cancel' }))
        }
        return
      }
      if (t === 'conversation.item.input_audio_transcription.completed') {
        const text = (msg.transcript as string | undefined) ?? ''
        if (text) appendTranscript('user', text)
        return
      }
      if (t === 'response.output_audio_transcript.done') {
        const text = (msg.transcript as string | undefined) ?? ''
        if (text) appendTranscript('assistant', text)
        return
      }
      if (t === 'response.function_call_arguments.done') {
        // 8. Browser surface stub — see header comment.
        const callId = (msg.call_id as string | undefined) ?? ''
        if (callId && !callIdsSeenRef.current.has(callId)) {
          callIdsSeenRef.current.add(callId)
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({
                    success: false,
                    error: 'browser_surface_no_tools',
                    fallback:
                      'Tools run on the phone relay — try this question over a phone call, or use the dashboard MCPs directly.',
                  }),
                },
              }),
            )
            ws.send(JSON.stringify({ type: 'response.create' }))
          }
        }
        return
      }
      if (t === 'error') {
        console.error('xAI error event', msg)
        setTokenError(`xAI error: ${JSON.stringify(msg).slice(0, 200)}`)
      }
    },
    [enqueuePlayback, stopPlayback, appendTranscript],
  )

  // ── Connection orchestration (item 2: parallel init in user gesture) ────
  const startSession = useCallback(async () => {
    if (!token || conn === 'connecting' || conn === 'connected') return
    setConn('connecting')

    try {
      // 2a. AudioContext warmup INSIDE the gesture.
      const ac = new AudioContext({ sampleRate: 48000 })
      audioCtxRef.current = ac
      await ac.resume()
      await ac.audioWorklet.addModule('/pcm-processor-worklet.js')

      // 2b. WebSocket — parallel with mic getUserMedia
      const wsUrl = `${XAI_WS_URL_BASE}?model=${encodeURIComponent(token.model)}`
      const ws = new WebSocket(wsUrl, [
        `xai-client-secret.${token.client_secret}`,
      ])
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      sessionReadyRef.current = false
      pendingFramesRef.current = []

      ws.addEventListener('open', () => {
        // 4. session.update with locked defaults.
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              ...token.session_defaults,
              modalities: ['text', 'audio'],
              input_audio_format: 'linear16',
              output_audio_format: 'linear16',
            },
          }),
        )
      })

      ws.addEventListener('message', async (ev) => {
        let msg: { type?: string; [k: string]: unknown }
        try {
          msg = JSON.parse(
            typeof ev.data === 'string'
              ? ev.data
              : new TextDecoder().decode(ev.data),
          )
        } catch {
          return
        }
        await handleServerEvent(msg)
      })

      ws.addEventListener('close', () => {
        setConn('closed')
      })
      ws.addEventListener('error', () => {
        setConn('error')
      })

      // 2c. Mic + worklet
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      const source = ac.createMediaStreamSource(stream)
      sourceNodeRef.current = source
      const node = new AudioWorkletNode(ac, 'pcm-downsample-processor')
      workletNodeRef.current = node
      node.port.onmessage = (e) => {
        const data = e.data as { kind: string; samples: Int16Array }
        if (data.kind !== 'pcm') return
        const bytes = new Uint8Array(data.samples.buffer)
        const b64 = chunkedBase64(bytes)
        const frame = JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: b64,
        })
        if (!sessionReadyRef.current) {
          // 3. Buffer until session.updated.
          pendingFramesRef.current.push(frame)
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.send(frame)
        }
        // RMS visualizer (item 10) — sample peak only every Nth chunk.
        if (Math.random() < 0.2) {
          const f32 = new Float32Array(data.samples.length)
          for (let i = 0; i < data.samples.length; i++)
            f32[i] = data.samples[i] / 0x7fff
          setMicLevel(rmsOf(f32))
        }
      }
      source.connect(node)
      // Don't connect node to destination — we don't want mic echo.
    } catch (e) {
      console.error('grok session start failed', e)
      setConn('error')
      setTokenError(e instanceof Error ? e.message : String(e))
    }
  }, [token, conn, handleServerEvent])

  // ── Render ──────────────────────────────────────────────────────────────
  const statusLabel = useMemo(() => {
    if (tokenError) return `error: ${tokenError}`
    if (!token) return 'loading token…'
    return conn
  }, [token, tokenError, conn])

  return (
    <div
      data-voice-hub
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--vh-base)',
        color: 'var(--vh-text)',
        padding: '2rem',
      }}
    >
      <LiquidGlassPanel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <h1 style={{ fontFamily: 'var(--vh-font-display, inherit)' }}>
              Business Analytics Voice — xAI Grok
            </h1>
            <span
              style={{ fontFamily: 'monospace', color: 'var(--vh-text-muted)' }}
            >
              {statusLabel}
            </span>
          </div>

          <button
            type="button"
            disabled={!token || conn === 'connecting' || conn === 'connected'}
            onClick={() => void startSession()}
            style={{
              padding: '1rem 2rem',
              borderRadius: '999px',
              background:
                conn === 'connected'
                  ? `rgba(74, 222, 128, ${0.3 + micLevel * 0.7})`
                  : 'var(--vh-accent, #3b82f6)',
              color: 'white',
              border: 'none',
              cursor: token && conn !== 'connected' ? 'pointer' : 'default',
              fontSize: '1rem',
              fontWeight: 600,
              transition: reduce ? 'none' : 'background 100ms linear',
            }}
          >
            {conn === 'connected' ? 'Listening…' : 'Tap to talk'}
          </button>

          <div
            style={{
              maxHeight: '60vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '0.5rem',
            }}
          >
            <AnimatePresence>
              {transcript.map((turn) => (
                <motion.div
                  key={turn.id}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={reduce ? undefined : { opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -8 }}
                  style={{
                    alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    padding: '0.75rem 1rem',
                    borderRadius: '1rem',
                    background:
                      turn.role === 'user'
                        ? 'var(--vh-bubble-user, rgba(59,130,246,0.2))'
                        : 'var(--vh-bubble-assistant, rgba(255,255,255,0.06))',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.7rem',
                      opacity: 0.6,
                      marginBottom: '0.25rem',
                    }}
                  >
                    {turn.role}
                  </div>
                  <div>{turn.text}</div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </LiquidGlassPanel>
    </div>
  )
}
