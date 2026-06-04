// ── HumeChatSurface ─────────────────────────────────────────────────────────
// The lazy-loaded body of /voice/hume-chat (Agent H1, Phase 1).
//
// Lifecycle:
//   1. Mount → GET /api/voice-engine/hume-token (server-side proxy that
//      attaches the dashboard's Bearer secret to the hume-evi-agent token
//      server on 127.0.0.1:8210). We get back access_token + config_id
//      (+ optional dynamic_variables prefetched server-side from H3's
//      relationship-memory bridge).
//   2. Wrap the page in <VoiceProvider auth={accessToken} configId>. The
//      provider opens the EVI WebSocket on connect.
//   3. <TalkButton> exposes a single tap-to-talk button (also bound to
//      spacebar push-to-talk) + connection-status indicator.
//   4. <Transcript> renders user/agent turns. AnimatePresence enter/exit.
//      Agent bubbles surface prosody tone labels when Hume sends them.
//
// We respect prefers-reduced-motion (no pulse, no spring) — gating handled
// inline since the page is small and we don't want to drag a global hook in.
// ────────────────────────────────────────────────────────────────────────────

import {
  VoiceProvider as RawVoiceProvider,
  useVoice,
} from '@humeai/voice-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import { LiquidGlassPanel } from '@/components/voice-hub/LiquidGlassPanel'

// VoiceProvider's compiled types pull in transitively-resolved Hume SDK
// `ConnectArgs`. Because `hume` is a transitive (.pnpm) dep — not hoisted —
// our tsserver can't fully resolve the intersection, and props look
// incompatible even when they're correct at runtime. Casting to a narrow
// surface keeps the file typecheck-clean without dragging another direct
// dep in (task said: no new heavy deps beyond @humeai/voice-react).
const VoiceProvider = RawVoiceProvider as ComponentType<{
  auth: { type: 'accessToken' | 'apiKey'; value: string }
  configId: string
  children?: ReactNode
}>

type TokenResponse = {
  ok: true
  access_token: string
  expires_in: number | null
  config_id: string | null
  dynamic_variables: Record<string, unknown> | null
}

type TokenError = { ok: false; error: string }

// ── Outer container: fetch token then mount VoiceProvider ──────────────────

export function HumeChatSurface(): ReactElement {
  const [token, setToken] = useState<TokenResponse | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/voice-engine/hume-token', {
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
        if (cancelled) return
        setTokenError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (tokenError) {
    return (
      <SurfaceShell>
        <ErrorState message={tokenError} />
      </SurfaceShell>
    )
  }
  if (!token) {
    return (
      <SurfaceShell>
        <LoadingState />
      </SurfaceShell>
    )
  }

  // configId may be null if HUME_CONFIG_ID is unset on the backend — render a
  // soft error rather than mounting VoiceProvider with an empty config.
  if (!token.config_id) {
    return (
      <SurfaceShell>
        <ErrorState message="HUME_CONFIG_ID not set on the token server. Run scripts/create_config.py and paste the id into .env." />
      </SurfaceShell>
    )
  }

  return (
    <SurfaceShell>
      <VoiceProvider
        auth={{ type: 'accessToken', value: token.access_token }}
        configId={token.config_id}
      >
        <ChatBody dynamicVariables={token.dynamic_variables} />
      </VoiceProvider>
    </SurfaceShell>
  )
}

// ── Page shell (header + glass background) ─────────────────────────────────

function SurfaceShell({
  children,
}: {
  children: React.ReactNode
}): ReactElement {
  return (
    <div
      data-voice-hub
      className="flex flex-col"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--vh-base)',
        color: 'var(--vh-text)',
        padding: '1.5rem',
        gap: '1.5rem',
      }}
    >
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center">
        {children}
      </div>
    </div>
  )
}

function Header(): ReactElement {
  return (
    <header className="flex items-baseline justify-between">
      <h1
        className="font-mono text-lg tracking-wide"
        style={{ color: 'var(--vh-text)' }}
      >
        Open-Domain Voice — Hume EVI
      </h1>
    </header>
  )
}

function LoadingState(): ReactElement {
  return (
    <LiquidGlassPanel className="px-6 py-4">
      <span
        className="font-mono text-sm"
        style={{ color: 'var(--vh-text-muted)' }}
      >
        Minting Hume access token…
      </span>
    </LiquidGlassPanel>
  )
}

function ErrorState({ message }: { message: string }): ReactElement {
  return (
    <LiquidGlassPanel glow="blocked" className="max-w-xl px-6 py-4">
      <p
        className="font-mono text-sm"
        style={{ color: 'var(--vh-text)' }}
        role="alert"
      >
        {message}
      </p>
    </LiquidGlassPanel>
  )
}

// ── ChatBody (lives INSIDE VoiceProvider) ──────────────────────────────────

type ProsodyMap = Record<string, number>

interface DisplayMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  prosody?: ProsodyMap
}

function ChatBody({
  dynamicVariables,
}: {
  dynamicVariables: Record<string, unknown> | null
}): ReactElement {
  // useVoice() is typed strictly upstream; we widen to the surface we touch
  // so the file compiles without pinning to a specific @humeai/voice-react
  // minor (their type names shift between minors).
  const voice = useVoice() as unknown as {
    status: {
      value: 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'
    }
    connect: (opts?: {
      sessionSettings?: Record<string, unknown>
    }) => Promise<void>
    disconnect: () => void
    messages: Array<Record<string, unknown>>
    isMuted?: boolean
    mute?: () => void
    unmute?: () => void
  }

  const prefersReducedMotion = useReducedMotion()
  const isConnected = voice.status.value === 'connected'
  const isConnecting = voice.status.value === 'connecting'

  const handleTalkPress = async () => {
    if (voice.status.value !== 'connected') {
      try {
        await voice.connect(
          dynamicVariables
            ? { sessionSettings: { variables: dynamicVariables } }
            : undefined,
        )
      } catch {
        // Provider surfaces error via status.value === 'error'; no toast.
      }
      return
    }
    if (voice.isMuted && voice.unmute) voice.unmute()
    else if (voice.mute) voice.mute()
  }

  // Spacebar push-to-talk: hold space → unmute; release → mute.
  // Only active once connected; ignored when focus is inside an editable
  // element so we don't hijack typing.
  useEffect(() => {
    if (!isConnected) return
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      )
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (isEditable(e.target)) return
      e.preventDefault()
      if (voice.unmute) voice.unmute()
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (isEditable(e.target)) return
      e.preventDefault()
      if (voice.mute) voice.mute()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [isConnected, voice])

  const display = useMemo<Array<DisplayMessage>>(
    () => normalizeMessages(voice.messages),
    [voice.messages],
  )

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
      <StatusBadge status={voice.status.value} />

      <Transcript messages={display} reducedMotion={!!prefersReducedMotion} />

      <TalkButton
        connected={isConnected}
        connecting={isConnecting}
        muted={!!voice.isMuted}
        reducedMotion={!!prefersReducedMotion}
        onPress={handleTalkPress}
      />

      <p
        className="font-mono text-xs"
        style={{ color: 'var(--vh-text-muted)' }}
      >
        Tap the orb to {isConnected ? 'mute / unmute' : 'connect'}. Hold space
        to push-to-talk once connected.
      </p>
    </div>
  )
}

// ── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }): ReactElement {
  const label =
    status === 'connected'
      ? 'Connected'
      : status === 'connecting'
        ? 'Connecting…'
        : status === 'error'
          ? 'Error'
          : status === 'disconnected'
            ? 'Disconnected'
            : 'Idle'
  const glow: 'active' | 'blocked' | 'none' =
    status === 'connected' ? 'active' : status === 'error' ? 'blocked' : 'none'
  return (
    <LiquidGlassPanel
      glow={glow}
      density="compact"
      className="px-3 py-1"
      aria-live="polite"
    >
      <span
        className="font-mono text-xs uppercase tracking-wider"
        style={{ color: 'var(--vh-text)' }}
      >
        {label}
      </span>
    </LiquidGlassPanel>
  )
}

// ── Tap-to-talk button ──────────────────────────────────────────────────────

function TalkButton({
  connected,
  connecting,
  muted,
  reducedMotion,
  onPress,
}: {
  connected: boolean
  connecting: boolean
  muted: boolean
  reducedMotion: boolean
  onPress: () => void
}): ReactElement {
  const ariaLabel = !connected
    ? connecting
      ? 'Connecting to Hume voice agent'
      : 'Tap to connect to Hume voice agent'
    : muted
      ? 'Microphone muted — tap to unmute'
      : 'Microphone live — tap to mute'

  const pulseActive = connected && !muted && !reducedMotion
  const ringColor = connected
    ? muted
      ? 'var(--vh-text-muted, rgba(255,255,255,0.4))'
      : 'var(--vh-accent, #62F0C4)'
    : 'var(--vh-text-muted, rgba(255,255,255,0.4))'

  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={connected && !muted}
      onClick={onPress}
      whileTap={reducedMotion ? undefined : { scale: 0.95 }}
      style={{
        width: 160,
        height: 160,
        borderRadius: '50%',
        background: 'var(--vh-panel, rgba(20, 30, 48, 0.6))',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: `2px solid ${ringColor}`,
        color: 'var(--vh-text)',
        cursor: 'pointer',
        fontFamily: 'var(--vh-font-mono, monospace)',
        fontSize: '0.85rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        outlineOffset: 4,
      }}
    >
      {pulseActive ? (
        <motion.span
          aria-hidden
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          style={{ display: 'inline-block' }}
        >
          Listening
        </motion.span>
      ) : connecting ? (
        'Connecting'
      ) : connected ? (
        muted ? (
          'Muted'
        ) : (
          'Live'
        )
      ) : (
        'Tap to talk'
      )}
    </motion.button>
  )
}

// ── Transcript ──────────────────────────────────────────────────────────────

function Transcript({
  messages,
  reducedMotion,
}: {
  messages: Array<DisplayMessage>
  reducedMotion: boolean
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  return (
    <LiquidGlassPanel
      as="section"
      aria-label="Conversation transcript"
      className="w-full"
      density="comfortable"
    >
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-atomic="false"
        style={{
          maxHeight: '40vh',
          minHeight: '180px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '0.5rem',
        }}
      >
        <AnimatePresence initial={false}>
          {messages.length === 0 && (
            <motion.div
              key="empty"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="font-mono text-sm"
              style={{ color: 'var(--vh-text-muted)', textAlign: 'center' }}
            >
              Transcript will appear here once the conversation starts.
            </motion.div>
          )}
          {messages.map((m) => (
            <motion.div
              key={m.id}
              layout={!reducedMotion}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background:
                  m.role === 'user'
                    ? 'var(--vh-accent-soft, rgba(98, 240, 196, 0.12))'
                    : 'var(--vh-panel, rgba(20, 30, 48, 0.5))',
                color: 'var(--vh-text)',
                padding: '0.6rem 0.85rem',
                borderRadius: '14px',
                border: '1px solid var(--vh-border, rgba(255,255,255,0.08))',
              }}
            >
              <div
                className="font-mono text-[0.7rem] uppercase tracking-wider"
                style={{
                  color: 'var(--vh-text-muted)',
                  marginBottom: '0.2rem',
                }}
              >
                {m.role === 'user' ? 'You' : 'Agent'}
                {m.role === 'agent' && m.prosody && (
                  <span style={{ marginLeft: '0.5rem' }}>
                    {topProsody(m.prosody)}
                  </span>
                )}
              </div>
              <div className="text-sm leading-snug">{m.text}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </LiquidGlassPanel>
  )
}

// ── Hume message normalization ──────────────────────────────────────────────
// The @humeai/voice-react `messages` array carries multiple message types
// (user_message, assistant_message, audio_output, tool_call, etc.). We only
// surface the two text-bearing ones to the transcript.

function normalizeMessages(
  raw: Array<Record<string, unknown>>,
): Array<DisplayMessage> {
  const out: Array<DisplayMessage> = []
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i]
    const type = String(m['type'] ?? '')
    if (type === 'user_message' || type === 'assistant_message') {
      const message =
        (m['message'] as Record<string, unknown> | undefined) ?? {}
      const content = String(message['content'] ?? '').trim()
      if (!content) continue
      const role = message['role'] === 'user' ? 'user' : 'agent'
      const prosody = extractProsody(m['models'])
      out.push({
        id: `${i}-${type}`,
        role,
        text: content,
        prosody,
      })
    }
  }
  return out
}

function extractProsody(models: unknown): ProsodyMap | undefined {
  if (!models || typeof models !== 'object') return undefined
  const m = models as Record<string, unknown>
  const prosody = m['prosody'] as Record<string, unknown> | undefined
  const scores = prosody?.['scores'] as Record<string, number> | undefined
  if (!scores || Object.keys(scores).length === 0) return undefined
  return scores
}

function topProsody(scores: ProsodyMap): string {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  return sorted
    .slice(0, 1)
    .map(([k]) => k.toLowerCase())
    .join(', ')
}
