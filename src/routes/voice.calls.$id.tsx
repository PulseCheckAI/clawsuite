// ── /voice/calls/$id — single-call deep view ────────────────────────────────
// Lazy-loaded for the same reason /voice is: voice-hub tokens + framer
// motion shouldn't block initial bundle for non-voice surfaces. SSR off
// matches every other dashboard route.
//
// Wiring:
//   - useVoiceCallLive(id) — cold-start via /api/voice-engine/calls/:id +
//     realtime merge filtered to id=eq.<id>. The same channel pattern as
//     the hub feed; the page stays live while the call is connected, and
//     the merge handler upserts UPDATEs from the engine (transcript
//     append, status flip, audio_url drop, whisper_verify_result write).
//   - voiceApi.promoteScenario(id, {name, description}) — POST when the
//     operator names the overlay. Modal is local, dismisses on success.
//
// Glass + framer motion mirror the hub (HubOverview / LiquidGlassPanel /
// PlaceCallSheet). Brand stays scoped via `data-voice-hub` on the root.
// ────────────────────────────────────────────────────────────────────────────

import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Suspense, useMemo, useState } from 'react'
import type {
  TranscriptMessage,
  VoiceCallRow,
  WhisperVerifyResult,
} from '@/lib/voice-api'
import { ErrorBoundary } from '@/components/error-boundary'
import { LiquidGlassPanel } from '@/components/voice-hub/LiquidGlassPanel'
import { useVoiceCallLive } from '@/hooks/use-voice-calls-live'
import { usePageTitle } from '@/hooks/use-page-title'
import { VoiceApiError, voiceApi } from '@/lib/voice-api'
import '@/styles/voice-hub-tokens.css'

export const Route = createFileRoute('/voice/calls/$id')({
  ssr: false,
  component: function VoiceCallRoute() {
    usePageTitle('Voice Call')
    return (
      <ErrorBoundary
        title="Voice call view error"
        description="Failed to load this call. Try reloading."
      >
        <Suspense
          fallback={
            <div
              data-voice-hub
              className="flex h-full items-center justify-center"
              style={{
                minHeight: '100vh',
                backgroundColor: 'var(--vh-base)',
                color: 'var(--vh-text-muted)',
              }}
            >
              <div className="font-mono text-sm tracking-wide">
                Loading call…
              </div>
            </div>
          }
        >
          <DeepView />
        </Suspense>
      </ErrorBoundary>
    )
  },
})

// ── Helpers ────────────────────────────────────────────────────────────────

function statusTone(
  status: VoiceCallRow['status'],
): 'compliant' | 'active' | 'warming' | 'blocked' | 'muted' {
  switch (status) {
    case 'connected':
      return 'active'
    case 'placed':
    case 'pending':
      return 'warming'
    case 'completed':
      return 'compliant'
    case 'failed':
    case 'gated_refused':
      return 'blocked'
    default:
      return 'muted'
  }
}

function toneColor(tone: ReturnType<typeof statusTone>): string {
  switch (tone) {
    case 'active':
      return 'var(--vh-active)'
    case 'compliant':
      return 'var(--vh-compliant)'
    case 'warming':
      return 'var(--vh-warming)'
    case 'blocked':
      return 'var(--vh-blocked)'
    default:
      return 'var(--vh-text-muted)'
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatTimestamp(iso: string | undefined | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

// ───────────────────────────────────────────────────────────────────────────

function DeepView() {
  const { id } = useParams({ from: '/voice/calls/$id' })
  const { call, loading, error } = useVoiceCallLive(id)

  return (
    <div
      data-voice-hub
      className="relative min-h-screen px-6 py-6 lg:px-10 lg:py-8"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(46,150,255,0.08), transparent 60%), var(--vh-base)',
      }}
    >
      <Header callId={id} call={call} />

      {loading && <LoadingState />}
      {!loading && error && <ErrorState error={error} />}
      {!loading && !error && !call && <NotFoundState />}
      {!loading && !error && call && <Body call={call} />}
    </div>
  )
}

// ── Header (sticky-ish nav + status) ───────────────────────────────────────

function Header({
  callId,
  call,
}: {
  callId: string
  call: VoiceCallRow | null
}) {
  const tone = call ? statusTone(call.status) : 'muted'
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
          PulseOS · Voice Hub · Call
        </div>
        <h1
          className="font-display mt-1 text-2xl font-bold tracking-tight lg:text-3xl"
          style={{ color: 'var(--vh-text)' }}
        >
          {call?.phone ?? 'Call'}
          {call?.direction ? (
            <span
              className="ml-3 align-middle font-mono text-[11px] font-semibold tracking-[0.16em] uppercase"
              style={{ color: 'var(--vh-text-muted)' }}
            >
              {call.direction}
            </span>
          ) : null}
        </h1>
        <div
          className="mt-1 font-mono text-[11px]"
          style={{ color: 'var(--vh-text-faint)' }}
        >
          id · {callId}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {call ? (
          <span
            className="inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[11px] font-semibold tracking-wider uppercase"
            style={{
              borderColor: toneColor(tone),
              color: toneColor(tone),
              backgroundColor: 'transparent',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: toneColor(tone),
                boxShadow:
                  tone === 'active' || tone === 'compliant'
                    ? `0 0 6px ${toneColor(tone)}`
                    : undefined,
              }}
            />
            {call.status}
          </span>
        ) : null}
        <Link
          to="/voice"
          className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors"
          style={{
            borderColor: 'var(--vh-glass-border-bright)',
            backgroundColor: 'var(--vh-glass-bg)',
            color: 'var(--vh-text)',
          }}
        >
          ← Back to Hub
        </Link>
      </div>
    </header>
  )
}

// ── States ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <LiquidGlassPanel as="section" className="flex items-center justify-center">
      <div
        className="font-mono text-sm"
        style={{ color: 'var(--vh-text-muted)' }}
      >
        Loading call…
      </div>
    </LiquidGlassPanel>
  )
}

function ErrorState({ error }: { error: string }) {
  return (
    <LiquidGlassPanel as="section" glow="blocked">
      <div
        className="font-mono text-[10px] font-semibold tracking-[0.16em] uppercase"
        style={{ color: 'var(--vh-blocked)' }}
      >
        Error
      </div>
      <p
        className="mt-2 text-sm"
        style={{ color: 'var(--vh-text)', whiteSpace: 'pre-wrap' }}
      >
        {error}
      </p>
    </LiquidGlassPanel>
  )
}

function NotFoundState() {
  return (
    <LiquidGlassPanel as="section">
      <div
        className="font-mono text-[10px] font-semibold tracking-[0.16em] uppercase"
        style={{ color: 'var(--vh-text-muted)' }}
      >
        Not found
      </div>
      <p className="mt-2 text-sm" style={{ color: 'var(--vh-text)' }}>
        This call doesn't exist, or it belongs to another tenant.
      </p>
    </LiquidGlassPanel>
  )
}

// ── Body ───────────────────────────────────────────────────────────────────

function Body({ call }: { call: VoiceCallRow }) {
  const transcript = useMemo<Array<TranscriptMessage>>(
    () => (Array.isArray(call.transcript) ? call.transcript : []),
    [call.transcript],
  )
  const canPromote =
    !!call.per_call_overlay &&
    Object.keys(call.per_call_overlay).length > 0 &&
    !call.scenario_id

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* Left: meta + audio + actions */}
      <div className="flex flex-col gap-5 lg:col-span-1">
        <MetaPanel call={call} />
        {call.audio_url ? <AudioPanel url={call.audio_url} /> : null}
        {call.whisper_verify_result ? (
          <WhisperPanel result={call.whisper_verify_result} />
        ) : null}
        {canPromote ? <PromotePanel callId={call.id} /> : null}
      </div>

      {/* Right: transcript */}
      <div className="lg:col-span-2">
        <TranscriptPanel
          transcript={transcript}
          status={call.status}
          refusalReason={call.refusal_reason}
        />
      </div>
    </div>
  )
}

function MetaPanel({ call }: { call: VoiceCallRow }) {
  return (
    <LiquidGlassPanel as="article" aria-label="Call metadata">
      <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
        Details
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <MetaRow label="Direction" value={call.direction ?? '—'} />
        <MetaRow
          label="Duration"
          value={formatDuration(call.duration_seconds)}
        />
        <MetaRow
          label="Scenario"
          value={call.scenario_id ? call.scenario_id : 'Ad-hoc'}
        />
        <MetaRow label="Transport" value={call.transport ?? '—'} />
        <MetaRow label="Started" value={formatTimestamp(call.created_at)} />
      </div>
    </LiquidGlassPanel>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
        {label}
      </div>
      <div
        className="mt-0.5 truncate font-mono text-[12px]"
        style={{ color: 'var(--vh-text)' }}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function AudioPanel({ url }: { url: string }) {
  return (
    <LiquidGlassPanel as="article" aria-label="Call recording">
      <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
        Recording
      </div>
      <audio
        controls
        src={url}
        preload="none"
        style={{ marginTop: 10, width: '100%' }}
      />
    </LiquidGlassPanel>
  )
}

function WhisperPanel({ result }: { result: WhisperVerifyResult }) {
  const tone = result.passed ? 'compliant' : 'blocked'
  return (
    <LiquidGlassPanel
      as="article"
      glow={tone}
      aria-label="Whisper verification result"
    >
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
          Whisper verify
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
          style={{
            borderColor: toneColor(tone),
            color: toneColor(tone),
            backgroundColor: 'transparent',
          }}
        >
          {result.passed ? 'PASSED' : 'FAILED'}
        </span>
      </div>
      <div
        className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"
        style={{ color: 'var(--vh-text)' }}
      >
        <div>
          <div className="font-mono text-[9px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
            Similarity
          </div>
          <div className="mt-0.5 font-mono text-[12px]">
            {result.similarity != null
              ? (result.similarity * 100).toFixed(1) + '%'
              : '—'}
          </div>
        </div>
        {result.detail ? (
          <div className="col-span-2">
            <div className="font-mono text-[9px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
              Detail
            </div>
            <div
              className="mt-0.5 text-[12px]"
              style={{ color: 'var(--vh-text-muted)' }}
            >
              {result.detail}
            </div>
          </div>
        ) : null}
      </div>
    </LiquidGlassPanel>
  )
}

function PromotePanel({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <LiquidGlassPanel as="article" aria-label="Promote overlay">
        <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
          Promote overlay
        </div>
        <p
          className="mt-2 text-sm"
          style={{ color: 'var(--vh-text-muted)', lineHeight: 1.5 }}
        >
          This call ran on a one-off overlay. Save it as a reusable scenario to
          apply the same prompt + skills to future calls.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors"
          style={{
            borderColor: 'var(--vh-active-border)',
            backgroundColor: 'var(--vh-active-soft)',
            color: 'var(--vh-active)',
          }}
        >
          Promote to Scenario
        </button>
      </LiquidGlassPanel>
      <PromoteModal
        open={open}
        callId={callId}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

function PromoteModal({
  open,
  callId,
  onClose,
}: {
  open: boolean
  callId: string
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) {
      setErr('Name is required.')
      return
    }
    setSubmitting(true)
    setErr(null)
    try {
      await voiceApi.promoteScenario(callId, {
        name: name.trim(),
        description: description.trim() || null,
      })
      onClose()
      setName('')
      setDescription('')
    } catch (e) {
      const msg =
        e instanceof VoiceApiError
          ? typeof e.detail === 'string'
            ? e.detail
            : e.message
          : e instanceof Error
            ? e.message
            : String(e)
      setErr(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          data-voice-hub
          style={{ position: 'fixed', inset: 0, zIndex: 250 }}
          role="dialog"
          aria-modal="true"
          aria-label="Promote overlay to scenario"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(7,10,17,0.55)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              cursor: 'pointer',
            }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            style={{
              position: 'relative',
              maxWidth: 440,
              margin: '12vh auto 0',
              background: 'var(--vh-base)',
              border: '1px solid var(--vh-glass-border-bright)',
              borderRadius: 16,
              padding: 24,
              boxShadow: 'var(--vh-shadow-float)',
            }}
          >
            <h2
              className="font-display"
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--vh-text)',
              }}
            >
              Promote overlay
            </h2>
            <p
              className="mt-1 text-sm"
              style={{ color: 'var(--vh-text-muted)' }}
            >
              Save this call's per_call_overlay as a reusable scenario.
            </p>
            <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
              <label
                className="font-mono"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--vh-text-muted)',
                }}
              >
                Name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Holiday hours script"
                  style={{
                    display: 'block',
                    marginTop: 6,
                    width: '100%',
                    minHeight: 44,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--vh-glass-border)',
                    background: 'var(--vh-base-elevated)',
                    color: 'var(--vh-text)',
                    fontSize: 14,
                  }}
                />
              </label>
              <label
                className="font-mono"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--vh-text-muted)',
                }}
              >
                Description (optional)
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="When + why to use this scenario"
                  rows={3}
                  style={{
                    display: 'block',
                    marginTop: 6,
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--vh-glass-border)',
                    background: 'var(--vh-base-elevated)',
                    color: 'var(--vh-text)',
                    fontSize: 14,
                    resize: 'vertical',
                  }}
                />
              </label>
              {err ? (
                <div
                  className="text-sm"
                  style={{ color: 'var(--vh-blocked)' }}
                  role="alert"
                >
                  {err}
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    minHeight: 44,
                    padding: '0 16px',
                    borderRadius: 10,
                    border: '1px solid var(--vh-glass-border-bright)',
                    background: 'transparent',
                    color: 'var(--vh-text)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  style={{
                    minHeight: 44,
                    padding: '0 18px',
                    borderRadius: 10,
                    border: '1px solid var(--vh-active-border)',
                    background: submitting
                      ? 'var(--vh-active-soft)'
                      : 'var(--vh-active)',
                    color: submitting ? 'var(--vh-active)' : '#06251b',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: submitting ? 'wait' : 'pointer',
                  }}
                >
                  {submitting ? 'Promoting…' : 'Promote'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function TranscriptPanel({
  transcript,
  status,
  refusalReason,
}: {
  transcript: Array<TranscriptMessage>
  status: VoiceCallRow['status']
  refusalReason: string | null
}) {
  return (
    <LiquidGlassPanel as="section" aria-label="Transcript" className="h-full">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
          Transcript
        </div>
        {status === 'connected' ? (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase"
            style={{ color: 'var(--vh-active)' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: 'var(--vh-active)',
                boxShadow: '0 0 6px var(--vh-active)',
              }}
            />
            Live
          </span>
        ) : null}
      </div>

      {status === 'gated_refused' ? (
        <div
          style={{
            borderRadius: 10,
            border: '1px solid var(--vh-blocked-border)',
            background: 'var(--vh-blocked-soft)',
            color: 'var(--vh-blocked)',
            padding: '10px 12px',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          Refused at the gate · {refusalReason ?? 'no reason provided'}
        </div>
      ) : null}

      {transcript.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--vh-text-muted)' }}>
          {status === 'connected' || status === 'pending' || status === 'placed'
            ? 'Waiting for first turn…'
            : 'No transcript was captured.'}
        </p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {transcript.map((msg, i) => (
            <li
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '76px 1fr',
                gap: 12,
                padding: '10px 0',
                borderTop:
                  i === 0 ? 'none' : '1px solid var(--vh-glass-border)',
              }}
            >
              <div>
                <span
                  className="font-mono text-[9px] font-semibold tracking-[0.14em] uppercase"
                  style={{
                    color:
                      msg.role === 'agent'
                        ? 'var(--vh-active)'
                        : msg.role === 'caller'
                          ? 'var(--vh-compliant)'
                          : 'var(--vh-text-muted)',
                  }}
                >
                  {msg.role}
                </span>
                {msg.ts ? (
                  <div
                    className="font-mono text-[10px]"
                    style={{ color: 'var(--vh-text-faint)', marginTop: 2 }}
                  >
                    {formatTimestamp(msg.ts)}
                  </div>
                ) : null}
              </div>
              <div
                className="text-sm"
                style={{
                  color: 'var(--vh-text)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                }}
              >
                {msg.text}
              </div>
            </li>
          ))}
        </ol>
      )}
    </LiquidGlassPanel>
  )
}
