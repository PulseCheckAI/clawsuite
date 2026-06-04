// /media/walkthroughs -- Rendered MP4s from the remotion-studio render server.
// ---------------------------------------------------------------------------
// Layout:
//   - Top toolbar: "Render new" + "Refresh" + render service status pill
//   - Main      : 3-column grid of render cards, each with inline <video>
//   - Sheet     : "Render new" — composition picker + typed per-composition
//                  form (MarginLeakRecap / WeeklyKpiRecap / OutreachHook),
//                  with an "Advanced: edit raw JSON" fallback toggle for
//                  operators who need to drive props by hand
//
// Live updates: WebSocket subscription to /api/media/subscribe (proxied to
// the render server's /jobs/subscribe). The 5s /jobs poll + the post-submit
// 1.5s /jobs/:id poll are GONE — the connection delivers snapshot on open
// and per-job push on every status transition.
//
// Fallback path: if the WS handshake fails (proxy/server down) the helper
// in mediaApi.subscribeToJobs falls back to a 5s REST poll AGAINST the same
// /api/media/walkthroughs endpoint, then retries WS reconnect every 30s and
// seamlessly switches back when it lands. The grid keeps working degraded.
//
// SSR off + voice-hub tokens side-effect import, same as /voice/voices.
//
// v3 follow-ups (Phase-5 v3, see report):
//   * Shared schema package between dashboard + remotion-studio so the
//     typed forms here can derive directly from the SSOT zod schemas
//     instead of hand-mirroring the shapes (current duplication lives in
//     src/components/media/composition-form-shared.tsx).
//   * Per-org job filtering (render.mjs has no org metadata yet)
//   * Poster thumbnails (today we let the <video> render its own first
//     frame, no poster URL)

import { createFileRoute } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  MarginLeakRecapForm,
  OutreachHookForm,
  WeeklyKpiRecapForm,
} from '@/components/media/composition-forms'
import { ErrorBoundary } from '@/components/error-boundary'
import { usePageTitle } from '@/hooks/use-page-title'
import type {
  CompositionId,
  RenderJob,
  RenderServiceStatus,
} from '@/lib/voice-api'
import { VoiceApiError, mediaApi } from '@/lib/voice-api'
import '@/styles/voice-hub-tokens.css'

// -- Route ------------------------------------------------------------------

export const Route = createFileRoute('/media/walkthroughs')({
  ssr: false,
  component: function WalkthroughsRoute() {
    usePageTitle('Walkthroughs')
    return (
      <ErrorBoundary
        title="Walkthroughs error"
        description="Failed to load the walkthroughs panel. Try reloading."
      >
        <WalkthroughsContainer />
      </ErrorBoundary>
    )
  },
})

// -- Composition catalog ----------------------------------------------------
//
// Just the labels + ordering. Per-composition defaults + typed form shapes
// now live in src/components/media/composition-form-shared.tsx (the SSOT
// for the dashboard mirror of os/remotion-studio/src/types/props.ts).

const COMPOSITION_LABELS: Record<CompositionId, string> = {
  MarginLeakRecap: 'Margin Leak Recap (vertical, 15s)',
  WeeklyKpiRecap: 'Weekly KPI Recap (horizontal, 30s)',
  OutreachHook: 'Outreach Hook (vertical, 10s)',
}

const COMPOSITION_IDS: ReadonlyArray<CompositionId> = [
  'MarginLeakRecap',
  'WeeklyKpiRecap',
  'OutreachHook',
]

// -- Container --------------------------------------------------------------

function WalkthroughsContainer() {
  const [jobsById, setJobsById] = useState<Map<string, RenderJob>>(
    () => new Map(),
  )
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // 'up'    → WS open OR REST snapshot recently delivered
  // 'down'  → WS closed AND no recent snapshot (initial cold-start failure)
  // 'degraded' → server emitted {type:'shutdown'} (renderer restarting)
  const [serviceStatus, setServiceStatus] =
    useState<RenderServiceStatus>('down')

  // Upsert a single job by id; first-seen jobs are inserted. Sort order is
  // applied at render-time off the Map values (started_at DESC).
  const upsertJob = useCallback((job: RenderJob) => {
    setJobsById((prev) => {
      const next = new Map(prev)
      next.set(job.id, { ...prev.get(job.id), ...job })
      return next
    })
  }, [])

  // Wire the WS subscription. The helper internally manages reconnect with
  // exponential backoff up to 30s, a 60s heartbeat-gap reconnect trigger,
  // and a 5s REST fallback when the WS is down. We just react to events.
  useEffect(() => {
    const unsubscribe = mediaApi.subscribeToJobs((event) => {
      if (event.type === 'snapshot') {
        // Server snapshot OR REST fallback snapshot — both rebuild the map.
        setJobsById(() => {
          const next = new Map<string, RenderJob>()
          for (const j of event.jobs) next.set(j.id, j)
          return next
        })
        setServiceStatus('up')
        setListError(null)
        setLoading(false)
        return
      }
      if (event.type === 'job') {
        upsertJob(event.job)
        setServiceStatus('up')
        setListError(null)
        setLoading(false)
        return
      }
      if (event.type === 'heartbeat') {
        setServiceStatus('up')
        return
      }
      if (event.type === 'shutdown') {
        // Renderer is restarting — show a degraded pill while the helper
        // reconnects on its own backoff. Don't clear the grid; the cached
        // jobs are still valid.
        setServiceStatus('degraded')
        return
      }
      // 'pong' / 'error' frames: nothing to do at the UI layer.
    })
    return () => unsubscribe()
  }, [upsertJob])

  const handleRenderQueued = useCallback((_jobId: string) => {
    setSheetOpen(false)
    // No explicit refresh needed — the WS pushes the queued event itself
    // (render.mjs broadcasts on rememberJob() in addition to transitions).
  }, [])

  // Explicit refresh button: synchronously re-fetch the list via REST. This
  // is a no-op for live data (WS already has it), but operators expect a
  // refresh button to *do* something, and it confirms the panel can reach
  // the upstream even when the WS is happy.
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await mediaApi.listWalkthroughs()
      setJobsById(() => {
        const next = new Map<string, RenderJob>()
        for (const j of res.jobs) next.set(j.id, j)
        return next
      })
      setServiceStatus(res.render_service_status)
      setListError(null)
    } catch (e) {
      setListError(toErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const jobs = useMemo(
    () =>
      Array.from(jobsById.values()).sort((a, b) => b.started_at - a.started_at),
    [jobsById],
  )

  return (
    <div
      data-voice-hub
      className="relative min-h-screen px-6 py-6 lg:px-10 lg:py-8"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(46,150,255,0.08), transparent 60%), var(--vh-base)',
        color: 'var(--vh-text)',
      }}
    >
      <Header
        onRenderNew={() => setSheetOpen(true)}
        onRefresh={() => {
          void refresh()
        }}
        loading={loading}
        serviceStatus={serviceStatus}
      />

      <main style={{ marginTop: 20 }}>
        {listError && (
          <div role="alert" style={errorRowStyle}>
            {listError}
          </div>
        )}

        {serviceStatus === 'down' && (
          <div role="alert" style={warningRowStyle}>
            Render service at 127.0.0.1:8140 is unreachable. The grid will
            populate as soon as the sidecar is back.
          </div>
        )}

        {serviceStatus === 'degraded' && (
          <div role="status" style={warningRowStyle}>
            Render service restarting — reconnecting…
          </div>
        )}

        {!loading && jobs.length === 0 && !listError && (
          <EmptyState onRenderNew={() => setSheetOpen(true)} />
        )}

        {jobs.length > 0 && <RenderGrid jobs={jobs} />}
      </main>

      <AnimatePresence>
        {sheetOpen && (
          <RenderNewSheet
            onClose={() => setSheetOpen(false)}
            onQueued={handleRenderQueued}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// -- Header -----------------------------------------------------------------

function Header({
  onRenderNew,
  onRefresh,
  loading,
  serviceStatus,
}: {
  onRenderNew: () => void
  onRefresh: () => void
  loading: boolean
  serviceStatus: RenderServiceStatus
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
          PulseOS · Media · Walkthroughs
        </div>
        <h1
          className="font-display mt-1 text-2xl font-bold tracking-tight lg:text-3xl"
          style={{ color: 'var(--vh-text)' }}
        >
          Walkthroughs
        </h1>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: 'var(--vh-text-muted)',
          }}
        >
          Rendered MP4s from the remotion-studio render server.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <ServiceStatusPill status={serviceStatus} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh walkthrough list"
          style={toolbarBtnStyle('ghost', loading)}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={onRenderNew}
          aria-label="Render a new walkthrough"
          style={toolbarBtnStyle('active')}
        >
          + Render new
        </button>
      </div>
    </header>
  )
}

function ServiceStatusPill({ status }: { status: RenderServiceStatus }) {
  const palette =
    status === 'up'
      ? {
          fg: 'var(--vh-compliant)',
          bg: 'var(--vh-compliant-soft)',
          border: 'var(--vh-compliant-border)',
          label: 'Render service: up',
        }
      : status === 'degraded'
        ? {
            fg: 'var(--vh-warming)',
            bg: 'var(--vh-warming-soft)',
            border: 'var(--vh-warming-border)',
            label: 'Render service: degraded',
          }
        : {
            fg: 'var(--vh-blocked)',
            bg: 'var(--vh-blocked-soft)',
            border: 'var(--vh-blocked-border)',
            label: 'Render service: down',
          }
  return (
    <span
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: palette.fg,
        }}
      />
      {palette.label}
    </span>
  )
}

// -- Empty state ------------------------------------------------------------

function EmptyState({ onRenderNew }: { onRenderNew: () => void }) {
  return (
    <section
      style={{
        marginTop: 40,
        padding: 32,
        borderRadius: 14,
        border: '1px dashed var(--vh-glass-border-bright)',
        background: 'var(--vh-glass-bg)',
        textAlign: 'center',
        color: 'var(--vh-text-muted)',
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 12 }}>
        No walkthroughs yet. Queue your first render to see it land here.
      </div>
      <button
        type="button"
        onClick={onRenderNew}
        style={toolbarBtnStyle('active')}
      >
        + Render new
      </button>
    </section>
  )
}

// -- Grid -------------------------------------------------------------------

function RenderGrid({ jobs }: { jobs: ReadonlyArray<RenderJob> }) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 16,
      }}
    >
      {jobs.map((job) => (
        <li key={job.id}>
          <RenderCard job={job} />
        </li>
      ))}
    </ul>
  )
}

function RenderCard({ job }: { job: RenderJob }) {
  const streamHref = mediaApi.streamUrl(job.id)
  const isDone = job.status === 'done'
  const isFailed = job.status === 'failed'

  return (
    <article
      style={{
        borderRadius: 14,
        border: '1px solid var(--vh-glass-border)',
        background: 'var(--vh-glass-bg)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Video — only mounted when the job is done. Pending/failed jobs
       * show a placeholder block so the card height stays consistent. */}
      {isDone ? (
        <video
          controls
          preload="metadata"
          // poster left blank for v1 — the <video> element renders the
          // first decoded frame on its own once metadata arrives.
          poster=""
          src={streamHref}
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            borderRadius: 10,
            background: '#000',
            objectFit: 'contain',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            borderRadius: 10,
            background: 'var(--vh-base-elevated)',
            border: '1px solid var(--vh-glass-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--vh-text-muted)',
            fontFamily: 'monospace',
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {isFailed ? 'Render failed' : job.status}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: 'var(--vh-text)',
            fontFamily: 'monospace',
          }}
        >
          {String(job.composition_id)}
        </div>
        <StatusPill status={job.status} />
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--vh-text-muted)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span title={new Date(job.started_at).toISOString()}>
          {relativeTime(job.started_at)}
        </span>
        <span aria-hidden="true">·</span>
        <code style={inlineCodeStyle}>{job.id.slice(0, 8)}</code>
      </div>

      {isFailed && job.error && (
        <pre
          style={{
            margin: 0,
            padding: 8,
            borderRadius: 8,
            background: 'var(--vh-blocked-soft)',
            border: '1px solid var(--vh-blocked-border)',
            color: 'var(--vh-blocked)',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {job.error}
        </pre>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {isDone && (
          <a
            download={`walkthrough-${job.id}.mp4`}
            href={streamHref}
            style={{
              ...toolbarBtnStyle('ghost'),
              display: 'inline-flex',
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            Download
          </a>
        )}
      </div>
    </article>
  )
}

function StatusPill({ status }: { status: RenderJob['status'] }) {
  const palette =
    status === 'done'
      ? {
          fg: 'var(--vh-compliant)',
          bg: 'var(--vh-compliant-soft)',
          border: 'var(--vh-compliant-border)',
        }
      : status === 'failed'
        ? {
            fg: 'var(--vh-blocked)',
            bg: 'var(--vh-blocked-soft)',
            border: 'var(--vh-blocked-border)',
          }
        : status === 'rendering'
          ? {
              fg: 'var(--vh-active)',
              bg: 'var(--vh-active-soft)',
              border: 'var(--vh-active-border)',
            }
          : {
              fg: 'var(--vh-warming)',
              bg: 'var(--vh-warming-soft)',
              border: 'var(--vh-warming-border)',
            }
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 999,
        fontFamily: 'monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {status}
    </span>
  )
}

// -- Render-new sheet -------------------------------------------------------
//
// Two modes:
//   1. Typed form (default) — one of three per-composition form components
//      from src/components/media/composition-forms.tsx. Operator gets
//      per-field validation + a "Load defaults" button. Form internally
//      calls onSubmit(typedPayload); we wrap that in the queue-render call.
//   2. Advanced raw JSON (collapsed by default) — same JSON textarea that
//      shipped in v2. Kept as an escape hatch for operators who need to
//      drive the renderer by hand (e.g. while iterating on a new composition
//      shape that's not yet wired into a typed form).

function RenderNewSheet({
  onClose,
  onQueued,
}: {
  onClose: () => void
  onQueued: (jobId: string) => void
}) {
  const [compositionId, setCompositionId] =
    useState<CompositionId>('MarginLeakRecap')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Raw-JSON state — only used when the operator opens the advanced
  // fallback. We lazily-init to '' so the typed-form path stays cheap.
  const [propsJson, setPropsJson] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null)

  // One form ref per composition — pinned across re-renders so the visible
  // "Queue render" button in the action bar can call requestSubmit() on
  // the currently-mounted form.
  const mlrFormRef = useRef<HTMLFormElement | null>(null)
  const wkrFormRef = useRef<HTMLFormElement | null>(null)
  const ohFormRef = useRef<HTMLFormElement | null>(null)

  const handlePickComposition = useCallback((next: CompositionId) => {
    setCompositionId(next)
    setError(null)
    setSubmittedJobId(null)
  }, [])

  // Shared "queue this typed payload" path — invoked from any form's
  // onSubmit after its own validation passes.
  const queueRender = useCallback(
    async (props: Record<string, unknown>) => {
      setError(null)
      setBusy(true)
      try {
        const res = await mediaApi.renderWalkthrough({
          composition_id: compositionId,
          props,
        })
        setSubmittedJobId(res.job_id)
        // Slight delay so the operator sees the job_id flash before the
        // sheet closes + the list re-renders.
        window.setTimeout(() => onQueued(res.job_id), 700)
      } catch (e) {
        setError(toErrorMessage(e))
      } finally {
        setBusy(false)
      }
    },
    [compositionId, onQueued],
  )

  // The Queue button in the action bar: route to the right form's
  // requestSubmit() OR to the raw-JSON parser depending on which mode the
  // operator is in. requestSubmit() triggers the form's onSubmit handler
  // which runs validation; if it passes, the form calls queueRender().
  const handleQueueClick = useCallback(() => {
    if (advancedOpen) {
      setError(null)
      let parsed: Record<string, unknown>
      try {
        const raw = JSON.parse(propsJson)
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
          setError(
            'Props must be a JSON object (not array / null / primitive).',
          )
          return
        }
        parsed = raw as Record<string, unknown>
      } catch (e) {
        setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      void queueRender(parsed)
      return
    }
    const ref =
      compositionId === 'MarginLeakRecap'
        ? mlrFormRef
        : compositionId === 'WeeklyKpiRecap'
          ? wkrFormRef
          : ohFormRef
    ref.current?.requestSubmit()
  }, [advancedOpen, compositionId, propsJson, queueRender])

  return (
    <div
      data-voice-hub
      style={{ position: 'fixed', inset: 0, zIndex: 200 }}
      role="dialog"
      aria-modal="true"
      aria-label="Render a new walkthrough"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={busy ? undefined : onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(7,10,17,0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      />
      <motion.aside
        initial={{ x: '100%', opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0.4 }}
        transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 1 }}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(640px, 100vw)',
          background: 'var(--vh-base)',
          borderLeft: '1px solid var(--vh-glass-border-bright)',
          boxShadow: 'var(--vh-shadow-float)',
          display: 'flex',
          flexDirection: 'column',
          padding: 20,
          gap: 14,
          overflowY: 'auto',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--vh-text-muted)',
              }}
            >
              New walkthrough
            </div>
            <h2
              style={{
                margin: '4px 0 0',
                fontSize: 20,
                fontWeight: 700,
                color: 'var(--vh-text)',
              }}
            >
              Render a composition
            </h2>
          </div>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            aria-label="Close render sheet"
            style={{
              minWidth: 36,
              minHeight: 36,
              borderRadius: 8,
              border: '1px solid var(--vh-glass-border)',
              background: 'transparent',
              color: 'var(--vh-text-muted)',
              fontSize: 18,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            x
          </button>
        </header>

        <FormField label="Composition" htmlFor="rn-comp">
          <div
            role="radiogroup"
            aria-label="Composition"
            style={{ display: 'grid', gap: 6 }}
          >
            {COMPOSITION_IDS.map((id) => (
              <CompositionToggle
                key={id}
                id={id}
                checked={compositionId === id}
                onSelect={() => handlePickComposition(id)}
                disabled={busy}
              />
            ))}
          </div>
        </FormField>

        {/* Typed form — only one is mounted at a time. The form components
         * hold their own state internally, so swapping compositions
         * gives the operator a fresh defaults-pre-filled form (no
         * accidental cross-composition leakage). */}
        {!advancedOpen && (
          <>
            {compositionId === 'MarginLeakRecap' && (
              <MarginLeakRecapForm
                formRef={mlrFormRef}
                busy={busy}
                onSubmit={(payload) =>
                  queueRender(payload as unknown as Record<string, unknown>)
                }
              />
            )}
            {compositionId === 'WeeklyKpiRecap' && (
              <WeeklyKpiRecapForm
                formRef={wkrFormRef}
                busy={busy}
                onSubmit={(payload) =>
                  queueRender(payload as unknown as Record<string, unknown>)
                }
              />
            )}
            {compositionId === 'OutreachHook' && (
              <OutreachHookForm
                formRef={ohFormRef}
                busy={busy}
                onSubmit={(payload) =>
                  queueRender(payload as unknown as Record<string, unknown>)
                }
              />
            )}
          </>
        )}

        {/* Advanced: raw JSON fallback. Collapsed by default; expanded
         * gives the operator the v2 JSON textarea so they can drive the
         * renderer by hand (e.g. while iterating on a composition shape
         * that's not yet wired into a typed form). */}
        <AdvancedJsonToggle
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          disabled={busy}
        />
        {advancedOpen && (
          <FormField
            label="Props (raw JSON)"
            htmlFor="rn-props-raw"
            hint="Server validates with the composition's zod schema. Bad shapes surface as a failed job with the validator error in the grid card."
          >
            <textarea
              id="rn-props-raw"
              value={propsJson}
              onChange={(e) => setPropsJson(e.target.value)}
              disabled={busy}
              rows={18}
              spellCheck={false}
              placeholder='{ "org": { "name": "..." }, ... }'
              style={{
                ...inputStyle,
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.5,
                resize: 'vertical',
                minHeight: 280,
              }}
            />
          </FormField>
        )}

        {submittedJobId && (
          <div role="status" style={infoRowStyle}>
            Queued render — job_id{' '}
            <code style={inlineCodeStyle}>{submittedJobId}</code>
          </div>
        )}

        {error && (
          <div role="alert" style={errorRowStyle}>
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 8,
          }}
        >
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            aria-label="Cancel"
            style={toolbarBtnStyle('ghost', busy)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleQueueClick}
            disabled={busy}
            aria-label="Queue render"
            style={toolbarBtnStyle('compliant', busy)}
          >
            {busy ? 'Queuing…' : 'Queue render'}
          </button>
        </div>
      </motion.aside>
    </div>
  )
}

function AdvancedJsonToggle({
  open,
  onToggle,
  disabled,
}: {
  open: boolean
  onToggle: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      aria-expanded={open}
      aria-controls="rn-props-raw"
      style={{
        alignSelf: 'flex-start',
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--vh-glass-border)',
        background: open ? 'var(--vh-base-elevated)' : 'transparent',
        color: 'var(--vh-text-muted)',
        fontSize: 11,
        fontFamily: 'monospace',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {open ? '▾ Advanced: edit raw JSON' : '▸ Advanced: edit raw JSON'}
    </button>
  )
}

function CompositionToggle({
  id,
  checked,
  onSelect,
  disabled,
}: {
  id: CompositionId
  checked: boolean
  onSelect: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${
          checked ? 'var(--vh-active-border)' : 'var(--vh-glass-border)'
        }`,
        background: checked
          ? 'var(--vh-active-soft)'
          : 'var(--vh-base-elevated)',
        color: 'var(--vh-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: 13,
          fontFamily: 'monospace',
          color: checked ? 'var(--vh-active)' : 'var(--vh-text)',
        }}
      >
        {id}
      </span>
      <span style={{ fontSize: 11, color: 'var(--vh-text-faint)' }}>
        {COMPOSITION_LABELS[id]}
      </span>
    </button>
  )
}

// -- Tiny helpers -----------------------------------------------------------

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="font-mono"
        style={{
          display: 'block',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vh-text-muted)',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--vh-text-faint)',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}

function relativeTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const deltaSec = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const deltaMin = Math.round(deltaSec / 60)
  if (deltaMin < 60) return `${deltaMin} min ago`
  const deltaHr = Math.round(deltaMin / 60)
  if (deltaHr < 24) return `${deltaHr} hr ago`
  const deltaDay = Math.round(deltaHr / 24)
  return `${deltaDay} day${deltaDay === 1 ? '' : 's'} ago`
}

function toErrorMessage(e: unknown): string {
  if (e instanceof VoiceApiError) {
    if (typeof e.detail === 'string' && e.detail.length > 0) return e.detail
    return e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}

// -- Styles -----------------------------------------------------------------

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--vh-glass-border)',
  background: 'var(--vh-base-elevated)',
  color: 'var(--vh-text)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
}

const inlineCodeStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  color: 'var(--vh-text)',
  background: 'var(--vh-base-elevated)',
  padding: '1px 6px',
  borderRadius: 6,
  border: '1px solid var(--vh-glass-border)',
}

const errorRowStyle: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--vh-blocked-soft)',
  border: '1px solid var(--vh-blocked-border)',
  color: 'var(--vh-blocked)',
  fontSize: 13,
}

const warningRowStyle: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--vh-warming-soft)',
  border: '1px solid var(--vh-warming-border)',
  color: 'var(--vh-warming)',
  fontSize: 12,
  marginBottom: 12,
}

const infoRowStyle: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--vh-active-soft)',
  border: '1px solid var(--vh-active-border)',
  color: 'var(--vh-active)',
  fontSize: 13,
}

function toolbarBtnStyle(
  tone: 'active' | 'compliant' | 'blocked' | 'ghost',
  disabled = false,
): CSSProperties {
  const palettes = {
    active: {
      border: 'var(--vh-active-border)',
      bg: disabled ? 'transparent' : 'var(--vh-active-soft)',
      fg: 'var(--vh-active)',
    },
    compliant: {
      border: 'var(--vh-compliant-border)',
      bg: disabled ? 'var(--vh-compliant-soft)' : 'var(--vh-compliant)',
      fg: disabled ? 'var(--vh-compliant)' : '#06251b',
    },
    blocked: {
      border: 'var(--vh-blocked-border)',
      bg: disabled ? 'transparent' : 'var(--vh-blocked-soft)',
      fg: 'var(--vh-blocked)',
    },
    ghost: {
      border: 'var(--vh-glass-border-bright)',
      bg: 'transparent',
      fg: 'var(--vh-text)',
    },
  } as const
  const p = palettes[tone]
  return {
    minHeight: 40,
    padding: '0 16px',
    borderRadius: 10,
    border: `1px solid ${p.border}`,
    background: p.bg,
    color: p.fg,
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'all 150ms ease',
  }
}
