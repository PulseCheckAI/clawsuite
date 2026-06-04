// ── LiveHubOverview — /voice with real voice_calls feed ─────────────────────
// Mirrors HubOverview's layout (so /voice and /voice-preview look the same),
// but every number, every queue row, and the LIVE card derive from the
// `useVoiceCallsLive` feed instead of inline stubs.
//
// HubOverview stays untouched — /voice-preview keeps its zero-backend demo
// posture.
//
// KPIs (derived client-side from `calls`):
//   - Today        : count of rows with created_at within the local day,
//                    broken down by direction (outbound / inbound).
//   - Connected %  : completed / (completed + failed + gated_refused).
//   - Compliance   : split into compliant (placed|connected|completed),
//                    warming (pending), blocked (failed|gated_refused).
//
// "Live" card binds to the most-recent `status='connected'` row. While that
// row's transcript updates (realtime UPDATE), the card re-renders with the
// fresh status / duration.
//
// Queue table → next 6 rows that aren't completed/failed. Each row links to
// /voice/calls/<id> for the deep view.
// ────────────────────────────────────────────────────────────────────────────

import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { LiquidGlassPanel } from './LiquidGlassPanel'
import { DialerKeypad } from './DialerKeypad'
import { PlaceCallSheet } from './PlaceCallSheet'
import type { VoiceCallRow } from '@/lib/voice-api'
import { KpiCard } from '@/components/mission-control/kpi-card'
import { BarList } from '@/components/mission-control/bar-list'
import { StatusDot } from '@/components/mission-control/status-dot'
import { cn } from '@/lib/utils'
import { VoiceApiError, voiceApi } from '@/lib/voice-api'

// ── Props ──────────────────────────────────────────────────────────────────

export interface LiveHubOverviewProps {
  calls: Array<VoiceCallRow>
  loading: boolean
  error: string | null
  orgId: string | undefined
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isToday(iso: string | undefined | null): boolean {
  if (!iso) return false
  try {
    const d = new Date(iso)
    const n = new Date()
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    )
  } catch {
    return false
  }
}

function formatTime(iso: string | undefined | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

type Compliance = 'compliant' | 'warming' | 'blocked'

function statusToCompliance(status: VoiceCallRow['status']): Compliance {
  if (status === 'failed' || status === 'gated_refused') return 'blocked'
  if (status === 'pending') return 'warming'
  return 'compliant'
}

const COMPLIANCE_LABEL: Record<Compliance, string> = {
  compliant: 'Cleared',
  warming: 'Warming',
  blocked: 'Blocked',
}

const COMPLIANCE_VAR: Record<Compliance, string> = {
  compliant: 'var(--vh-compliant)',
  warming: 'var(--vh-warming)',
  blocked: 'var(--vh-blocked)',
}

const STAGGER_PARENT = {
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
}

const STAGGER_CHILD = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 220, damping: 28 },
  },
}

const HOVER_TILT = {
  rotateX: 2,
  rotateY: -2,
  y: -2,
  transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const },
}

// ───────────────────────────────────────────────────────────────────────────

export function LiveHubOverview({
  calls,
  loading,
  error,
  orgId,
}: LiveHubOverviewProps) {
  const [showDialer, setShowDialer] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dialerErr, setDialerErr] = useState<string | null>(null)

  // ── Derive KPIs / queue / live ───────────────────────────────────────────

  const todayCalls = useMemo(
    () => calls.filter((c) => isToday(c.created_at)),
    [calls],
  )

  const todayOutbound = useMemo(
    () => todayCalls.filter((c) => c.direction === 'outbound').length,
    [todayCalls],
  )
  const todayInbound = useMemo(
    () => todayCalls.filter((c) => c.direction === 'inbound').length,
    [todayCalls],
  )

  const connectedPct = useMemo(() => {
    const completed = todayCalls.filter((c) => c.status === 'completed').length
    const decided = todayCalls.filter(
      (c) =>
        c.status === 'completed' ||
        c.status === 'failed' ||
        c.status === 'gated_refused',
    ).length
    if (decided === 0) return { pct: 0, completed, decided }
    return {
      pct: Math.round((completed / decided) * 100),
      completed,
      decided,
    }
  }, [todayCalls])

  const complianceBreakdown = useMemo(() => {
    let compliant = 0
    let warming = 0
    let blocked = 0
    for (const c of todayCalls) {
      const bucket = statusToCompliance(c.status)
      if (bucket === 'compliant') compliant++
      else if (bucket === 'warming') warming++
      else blocked++
    }
    return [
      {
        label: 'Cleared (placed/connected/completed)',
        value: compliant,
        formattedValue: String(compliant),
      },
      {
        label: 'Warming (pending)',
        value: warming,
        formattedValue: String(warming),
      },
      {
        label: 'Blocked (failed / refused)',
        value: blocked,
        formattedValue: String(blocked),
      },
    ]
  }, [todayCalls])

  const liveCall = useMemo(
    () => calls.find((c) => c.status === 'connected') ?? null,
    [calls],
  )

  const queueRows = useMemo(
    () =>
      calls
        .filter(
          (c) =>
            c.status !== 'completed' &&
            c.status !== 'failed' &&
            c.status !== 'gated_refused',
        )
        .slice(0, 6),
    [calls],
  )

  // ── Dialer handler: POST place + open the call's deep view on success ────

  const handleDialerCall = async ({ to }: { to: string }) => {
    if (!orgId) {
      setDialerErr('Org not resolved yet — sign in and retry.')
      return
    }
    setDialerErr(null)
    try {
      const res = await voiceApi.placeCall({
        lead_id: `ad-hoc:${Date.now()}`,
        organization_id: orgId,
        phone: to,
        transport: 'twilio',
      })
      if (res.status === 'gated_refused') {
        setDialerErr(
          `Refused at the gate — ${res.refusal_reason ?? 'no reason provided'}`,
        )
      }
    } catch (e) {
      const msg =
        e instanceof VoiceApiError
          ? typeof e.detail === 'string'
            ? e.detail
            : e.message
          : e instanceof Error
            ? e.message
            : String(e)
      setDialerErr(msg)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      data-voice-hub
      className="relative min-h-screen px-6 py-6 lg:px-10 lg:py-8"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(46,150,255,0.08), transparent 60%), var(--vh-base)',
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
            PulseOS · Voice Hub · Live
          </div>
          <h1
            className="font-display mt-1 text-3xl font-bold tracking-tight lg:text-4xl"
            style={{ color: 'var(--vh-text)' }}
          >
            Make every call count.
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors"
            style={{
              borderColor: 'var(--vh-compliant-border)',
              backgroundColor: 'var(--vh-compliant-soft)',
              color: 'var(--vh-compliant)',
            }}
            aria-label="Open the place-call sheet"
          >
            Place Call
          </button>
          <button
            type="button"
            onClick={() => setShowDialer((v) => !v)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors"
            style={{
              borderColor: 'var(--vh-glass-border-bright)',
              backgroundColor: 'var(--vh-glass-bg)',
              color: 'var(--vh-text)',
            }}
            aria-label="Show or hide the keypad"
          >
            {showDialer ? 'Hide Keypad' : 'Show Keypad'}
          </button>
        </div>
      </header>

      {/* ── Error banner (only when REST cold-start failed) ──────────────── */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--vh-blocked-border)',
            background: 'var(--vh-blocked-soft)',
            color: 'var(--vh-blocked)',
          }}
        >
          Couldn't load calls — {error}
        </div>
      )}
      {dialerErr && (
        <div
          role="alert"
          className="mb-4 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--vh-warming-border)',
            background: 'var(--vh-warming-soft)',
            color: 'var(--vh-warming)',
          }}
        >
          {dialerErr}
        </div>
      )}

      {/* ── 3-up grid ───────────────────────────────────────────────────── */}
      <motion.div
        variants={STAGGER_PARENT}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-5 lg:grid-cols-3"
      >
        {/* LIVE CALL */}
        <motion.div
          variants={STAGGER_CHILD}
          whileHover={HOVER_TILT}
          style={{ transformPerspective: 1000 }}
        >
          <LiquidGlassPanel
            as="article"
            glow={liveCall ? 'active' : 'none'}
            aria-label="Live call status"
            className="h-full"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
                  LIVE
                </div>
                <div
                  className="font-display mt-1 text-xl font-bold"
                  style={{ color: 'var(--vh-text)' }}
                >
                  {liveCall
                    ? (liveCall.phone ?? 'Active call')
                    : 'No active call'}
                </div>
              </div>
              <StatusDot tone={liveCall ? 'live' : 'idle'} pulse={!!liveCall} />
            </div>
            <div className="mt-5 flex h-16 items-center justify-center">
              {liveCall ? (
                <div
                  className="font-mono text-[11px]"
                  style={{ color: 'var(--vh-active)' }}
                >
                  Connected · {liveCall.direction ?? '—'}
                </div>
              ) : (
                <span style={{ color: 'var(--vh-text-muted)', fontSize: 13 }}>
                  Ready to dial
                </span>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between text-xs">
              <span style={{ color: 'var(--vh-text-muted)' }}>
                Engine · pulseos-voice-engine
              </span>
              {liveCall ? (
                <Link
                  to="/voice/calls/$id"
                  params={{ id: liveCall.id }}
                  className="font-mono"
                  style={{ color: 'var(--vh-active)' }}
                >
                  Open →
                </Link>
              ) : (
                <span
                  className="font-mono"
                  style={{ color: 'var(--vh-text-faint)' }}
                >
                  awaiting calls
                </span>
              )}
            </div>
          </LiquidGlassPanel>
        </motion.div>

        {/* TODAY METRICS */}
        <motion.div
          variants={STAGGER_CHILD}
          whileHover={HOVER_TILT}
          style={{ transformPerspective: 1000 }}
          className="grid grid-cols-2 gap-3"
        >
          <KpiCard
            label="Calls Today"
            value={String(todayCalls.length)}
            context={`${todayOutbound} outbound · ${todayInbound} inbound`}
          />
          <KpiCard
            label="Connected %"
            value={`${connectedPct.pct}%`}
            context={`${connectedPct.completed} of ${connectedPct.decided} decided`}
          />
        </motion.div>

        {/* COMPLIANCE */}
        <motion.div
          variants={STAGGER_CHILD}
          whileHover={HOVER_TILT}
          style={{ transformPerspective: 1000 }}
        >
          <LiquidGlassPanel
            as="article"
            aria-label="Today's compliance breakdown"
            className="h-full"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
                  Compliance
                </div>
                <div
                  className="font-display mt-1 text-xl font-bold"
                  style={{ color: 'var(--vh-text)' }}
                >
                  Today's traffic
                </div>
              </div>
              <StatusDot tone={loading ? 'idle' : 'live'} />
            </div>
            <BarList items={complianceBreakdown} color="#2E96FF" />
            <div
              className="mt-4 border-t pt-3 text-xs"
              style={{
                borderColor: 'var(--vh-glass-border)',
                color: 'var(--vh-text-muted)',
              }}
            >
              Status buckets derived from voice_calls.status.
            </div>
          </LiquidGlassPanel>
        </motion.div>
      </motion.div>

      {/* ── Dialer + Queue ──────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <motion.div
          variants={STAGGER_CHILD}
          initial="hidden"
          animate="show"
          className="lg:col-span-2"
        >
          {showDialer ? (
            <DialerKeypad onCall={handleDialerCall} />
          ) : (
            <LiquidGlassPanel
              as="div"
              className="flex h-full items-center justify-center text-sm"
              style={{ color: 'var(--vh-text-muted)' }}
            >
              Keypad hidden — click "Show Keypad" above to re-open.
            </LiquidGlassPanel>
          )}
        </motion.div>

        <motion.div
          variants={STAGGER_CHILD}
          initial="hidden"
          animate="show"
          className="lg:col-span-3"
        >
          <LiquidGlassPanel
            as="section"
            aria-label="Active call queue"
            className="h-full"
          >
            <div className="mb-4 flex items-end justify-between">
              <div>
                <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
                  Queue
                </div>
                <div
                  className="font-display mt-1 text-xl font-bold"
                  style={{ color: 'var(--vh-text)' }}
                >
                  {queueRows.length === 0
                    ? loading
                      ? 'Loading…'
                      : 'No active calls'
                    : `Next ${queueRows.length} active`}
                </div>
              </div>
              <span
                className="font-mono text-[11px]"
                style={{ color: 'var(--vh-text-muted)' }}
              >
                LIVE · realtime
              </span>
            </div>

            {queueRows.length === 0 && !loading ? (
              <div
                className="rounded-lg border px-3 py-6 text-center text-sm"
                style={{
                  borderColor: 'var(--vh-glass-border)',
                  color: 'var(--vh-text-muted)',
                  background: 'var(--vh-glass-bg)',
                }}
              >
                Nothing in flight. Place a call to get started.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {queueRows.map((row) => {
                  const compliance = statusToCompliance(row.status)
                  return (
                    <li key={row.id}>
                      <Link
                        to="/voice/calls/$id"
                        params={{ id: row.id }}
                        className={cn(
                          'grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-lg border px-3 py-2.5 transition-colors',
                          `vh-row-glow-${compliance}`,
                        )}
                        style={{
                          borderColor: 'var(--vh-glass-border)',
                          backgroundColor: 'var(--vh-glass-bg)',
                          color: 'var(--vh-text)',
                          textDecoration: 'none',
                        }}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: COMPLIANCE_VAR[compliance],
                            boxShadow:
                              compliance === 'compliant'
                                ? `0 0 6px ${COMPLIANCE_VAR[compliance]}`
                                : undefined,
                          }}
                          aria-label={COMPLIANCE_LABEL[compliance]}
                        />
                        <div className="min-w-0">
                          <div
                            className="truncate text-sm font-semibold"
                            style={{ color: 'var(--vh-text)' }}
                          >
                            {row.phone ?? row.lead_id ?? row.id}
                          </div>
                          <div
                            className="truncate font-mono text-[11px]"
                            style={{ color: 'var(--vh-text-muted)' }}
                          >
                            {row.direction ?? '—'} ·{' '}
                            {row.scenario_id ? 'scenario' : 'ad-hoc'} ·{' '}
                            {row.status}
                          </div>
                        </div>
                        <div
                          className="font-mono text-xs whitespace-nowrap"
                          style={{ color: 'var(--vh-text-muted)' }}
                        >
                          {formatTime(row.created_at)}
                        </div>
                        <span
                          className="rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                          style={{
                            color: COMPLIANCE_VAR[compliance],
                            borderColor: COMPLIANCE_VAR[compliance],
                            backgroundColor: 'transparent',
                          }}
                        >
                          {COMPLIANCE_LABEL[compliance]}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </LiquidGlassPanel>
        </motion.div>
      </div>

      {/* ── Footer note ─────────────────────────────────────────────────── */}
      <div
        className="mt-6 text-center text-[11px]"
        style={{ color: 'var(--vh-text-faint)' }}
      >
        Live data · public.voice_calls (RLS enforced)
        {orgId ? ` · org ${orgId}` : ''}
      </div>

      {/* PlaceCallSheet — fed live org and wired to voice-engine */}
      <PlaceCallSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        organizationId={orgId}
      />
    </div>
  )
}
