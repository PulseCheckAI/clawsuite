// HubOverview — the /voice route landing page.
// ───────────────────────────────────────────────────────────────────────────
// Layout:
//   ┌─────────────────────────────────────────────────────────────────┐
//   │  TOP BAR   title + Place Call CTA + + Scenario CTA              │
//   ├──────────────────┬───────────────────┬──────────────────────────┤
//   │  LIVE CALL       │  TODAY METRICS    │  COMPLIANCE TRAFFIC      │
//   │  (waveform stub) │  (KpiCard reuse)  │  (BarList reuse)         │
//   ├──────────────────┴───────────────────┴──────────────────────────┤
//   │  QUEUE — next 6 calls, color-coded compliance row by row        │
//   ├─────────────────────────────────────────────────────────────────┤
//   │  AGENT DNA — caller name + comms register + prosody pulse mock  │
//   └─────────────────────────────────────────────────────────────────┘
//
// All data is STUBBED inline so this renders end-to-end without S1/S2/S3.
// Antigravity entrance: parent <motion.div> staggerChildren 0.1s so cards
// drop in like dominoes. Each card uses a subtle isometric tilt on hover.
//
// Reuses three Mission Control components — KpiCard, BarList, StatusDot —
// so the voice hub reads as an extension of the existing OS, not a graft.
// (No edits to those components: voice-only tokens layer on TOP.)
//
// Consumer: src/routes/voice.tsx
// Sibling primitives: ./LiquidGlassPanel, ./DialerKeypad

import { useState } from 'react'
import { motion } from 'motion/react'
import { LiquidGlassPanel } from './LiquidGlassPanel'
import { DialerKeypad } from './DialerKeypad'
import { KpiCard } from '@/components/mission-control/kpi-card'
import { BarList } from '@/components/mission-control/bar-list'
import { StatusDot } from '@/components/mission-control/status-dot'
import { cn } from '@/lib/utils'

// ── Stubbed data (S1/S2/S3 will replace with live queries) ────────────────

interface QueueRow {
  id: string
  contactName: string
  contactPhone: string
  scenario: string
  scheduledAt: string // ISO-8601
  compliance: 'compliant' | 'warming' | 'blocked'
  complianceReason?: string
}

const QUEUE_STUB: ReadonlyArray<QueueRow> = [
  {
    id: 'q1',
    contactName: 'Acropolis Greek Taverna',
    contactPhone: '+1 (305) 555-0143',
    scenario: 'Pilot Discovery',
    scheduledAt: '2026-05-25T14:30:00Z',
    compliance: 'compliant',
    complianceReason: 'Inbound consent · 2026-05-22',
  },
  {
    id: 'q2',
    contactName: 'Corner Table',
    contactPhone: '+1 (415) 555-0199',
    scenario: 'Margin Review',
    scheduledAt: '2026-05-25T14:45:00Z',
    compliance: 'compliant',
    complianceReason: 'Existing customer',
  },
  {
    id: 'q3',
    contactName: 'Bayside Catering',
    contactPhone: '+1 (727) 555-0117',
    scenario: 'Cold Outreach',
    scheduledAt: '2026-05-25T15:00:00Z',
    compliance: 'warming',
    complianceReason: 'DNC check pending',
  },
  {
    id: 'q4',
    contactName: 'Riverside Bistro',
    contactPhone: '+1 (305) 555-0211',
    scenario: 'Pilot Discovery',
    scheduledAt: '2026-05-25T15:15:00Z',
    compliance: 'compliant',
  },
  {
    id: 'q5',
    contactName: 'Harbor Hops Brewing',
    contactPhone: '+1 (727) 555-0288',
    scenario: 'Cold Outreach',
    scheduledAt: '2026-05-25T15:30:00Z',
    compliance: 'blocked',
    complianceReason: 'On internal DNC list',
  },
  {
    id: 'q6',
    contactName: 'Coastal Coffeehouse',
    contactPhone: '+1 (305) 555-0344',
    scenario: 'Margin Review',
    scheduledAt: '2026-05-25T15:45:00Z',
    compliance: 'compliant',
  },
] as const

const COMPLIANCE_BREAKDOWN = [
  { label: 'Cleared (TCPA + DNC)', value: 84, formattedValue: '84' },
  { label: 'Warming (review queued)', value: 11, formattedValue: '11' },
  { label: 'Blocked (DNC / refused)', value: 5, formattedValue: '5' },
]

const AGENT_DNA_STUB = {
  callerName: 'Sam Waez',
  org: 'Acropolis Greek Taverna',
  commsRegister: 'casual',
  verbosity: 'medium',
  pace: 'fast',
  topPain: 'labor scheduling waste',
  lastCall: '2026-05-22',
  // Prosody pulse — 24 samples 0..1. Mock; in prod streams from voice-engine.
  prosodyPulse: [
    0.32, 0.48, 0.55, 0.42, 0.61, 0.78, 0.7, 0.58, 0.65, 0.71, 0.83, 0.92, 0.78,
    0.66, 0.71, 0.62, 0.55, 0.49, 0.58, 0.66, 0.72, 0.61, 0.5, 0.42,
  ],
} as const

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const COMPLIANCE_LABEL: Record<QueueRow['compliance'], string> = {
  compliant: 'Cleared',
  warming: 'Warming',
  blocked: 'Blocked',
}

const COMPLIANCE_VAR: Record<QueueRow['compliance'], string> = {
  compliant: 'var(--vh-compliant)',
  warming: 'var(--vh-warming)',
  blocked: 'var(--vh-blocked)',
}

// Antigravity stagger config — read once per render at the parent level.
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

// Isometric subtle tilt on hover — antigravity, but not full 3D.
const HOVER_TILT = {
  rotateX: 2,
  rotateY: -2,
  y: -2,
  transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const },
}

// ───────────────────────────────────────────────────────────────────────────

export function HubOverview() {
  const [showDialer, setShowDialer] = useState(true)

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
            PulseOS · Voice Hub
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
            onClick={() => setShowDialer((v) => !v)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors"
            style={{
              borderColor: 'var(--vh-compliant-border)',
              backgroundColor: 'var(--vh-compliant-soft)',
              color: 'var(--vh-compliant)',
            }}
            aria-label="Open or close the dialer keypad"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <path
                d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Place Call
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors"
            style={{
              borderColor: 'var(--vh-glass-border-bright)',
              backgroundColor: 'var(--vh-glass-bg)',
              color: 'var(--vh-text)',
            }}
            aria-label="Create a new call scenario"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Scenario
          </button>
        </div>
      </header>

      {/* ── Staggered 3-up grid ─────────────────────────────────────────── */}
      <motion.div
        variants={STAGGER_PARENT}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-5 lg:grid-cols-3"
      >
        {/* LIVE CALL — animated waveform stub */}
        <motion.div
          variants={STAGGER_CHILD}
          whileHover={HOVER_TILT}
          style={{ transformPerspective: 1000 }}
        >
          <LiquidGlassPanel
            as="article"
            glow="active"
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
                  No active call
                </div>
              </div>
              <StatusDot tone="idle" pulse={false} />
            </div>

            {/* Waveform stub — 24 bars, animation drift via :nth-child delay */}
            <div
              className="mt-5 flex h-16 items-center justify-center"
              aria-hidden="true"
            >
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="vh-wave-bar"
                  style={{
                    animationDelay: `${(i * 0.08).toFixed(2)}s`,
                    opacity: 0.4,
                  }}
                />
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs">
              <span style={{ color: 'var(--vh-text-muted)' }}>
                Ready to dial
              </span>
              <span className="font-mono" style={{ color: 'var(--vh-active)' }}>
                Engine · pulseos-voice-engine
              </span>
            </div>
          </LiquidGlassPanel>
        </motion.div>

        {/* TODAY METRICS — reuse Mission Control KpiCard */}
        <motion.div
          variants={STAGGER_CHILD}
          whileHover={HOVER_TILT}
          style={{ transformPerspective: 1000 }}
          className="grid grid-cols-2 gap-3"
        >
          <KpiCard
            label="Calls Today"
            value="47"
            delta="+12 vs avg"
            deltaTone="positive"
            context="29 outbound · 18 inbound"
          />
          <KpiCard
            label="Connected %"
            value="68%"
            delta="+4pt"
            deltaTone="positive"
            context="32 connected of 47"
          />
        </motion.div>

        {/* COMPLIANCE — BarList reused with voice-active accent */}
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
                  TCPA Traffic
                </div>
              </div>
              <StatusDot tone="live" />
            </div>
            <BarList items={COMPLIANCE_BREAKDOWN} color="#2E96FF" />
            <div
              className="mt-4 border-t pt-3 text-xs"
              style={{
                borderColor: 'var(--vh-glass-border)',
                color: 'var(--vh-text-muted)',
              }}
            >
              All numbers DNC-checked at queue time.
            </div>
          </LiquidGlassPanel>
        </motion.div>
      </motion.div>

      {/* ── Dialer + Queue side-by-side ─────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Dialer */}
        <motion.div
          variants={STAGGER_CHILD}
          initial="hidden"
          animate="show"
          className="lg:col-span-2"
        >
          {showDialer ? (
            <DialerKeypad />
          ) : (
            <LiquidGlassPanel
              as="div"
              className="flex h-full items-center justify-center text-sm"
              style={{ color: 'var(--vh-text-muted)' }}
            >
              Dialer hidden — click "Place Call" above to re-open.
            </LiquidGlassPanel>
          )}
        </motion.div>

        {/* Queue table */}
        <motion.div
          variants={STAGGER_CHILD}
          initial="hidden"
          animate="show"
          className="lg:col-span-3"
        >
          <LiquidGlassPanel
            as="section"
            aria-label="Upcoming call queue"
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
                  Next {QUEUE_STUB.length} calls
                </div>
              </div>
              <span
                className="font-mono text-[11px]"
                style={{ color: 'var(--vh-text-muted)' }}
              >
                LIVE · auto-refresh
              </span>
            </div>

            <ul className="space-y-1.5">
              {QUEUE_STUB.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-lg border px-3 py-2.5 transition-colors',
                    `vh-row-glow-${row.compliance}`,
                  )}
                  style={{
                    borderColor: 'var(--vh-glass-border)',
                    backgroundColor: 'var(--vh-glass-bg)',
                  }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: COMPLIANCE_VAR[row.compliance],
                      boxShadow:
                        row.compliance === 'compliant'
                          ? `0 0 6px ${COMPLIANCE_VAR[row.compliance]}`
                          : undefined,
                    }}
                    aria-label={COMPLIANCE_LABEL[row.compliance]}
                  />
                  <div className="min-w-0">
                    <div
                      className="truncate text-sm font-semibold"
                      style={{ color: 'var(--vh-text)' }}
                    >
                      {row.contactName}
                    </div>
                    <div
                      className="truncate font-mono text-[11px]"
                      style={{ color: 'var(--vh-text-muted)' }}
                    >
                      {row.contactPhone} · {row.scenario}
                    </div>
                  </div>
                  <div
                    className="font-mono text-xs whitespace-nowrap"
                    style={{ color: 'var(--vh-text-muted)' }}
                  >
                    {formatTime(row.scheduledAt)}
                  </div>
                  <span
                    className="rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                    style={{
                      color: COMPLIANCE_VAR[row.compliance],
                      borderColor: COMPLIANCE_VAR[row.compliance],
                      backgroundColor: 'transparent',
                    }}
                  >
                    {COMPLIANCE_LABEL[row.compliance]}
                  </span>
                </li>
              ))}
            </ul>
          </LiquidGlassPanel>
        </motion.div>
      </div>

      {/* ── Agent DNA panel ─────────────────────────────────────────────── */}
      <motion.div
        variants={STAGGER_CHILD}
        initial="hidden"
        animate="show"
        whileHover={HOVER_TILT}
        style={{ transformPerspective: 1200 }}
        className="mt-6"
      >
        <LiquidGlassPanel
          as="section"
          glow="active"
          aria-label="Agent DNA — caller profile"
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr_280px]">
            {/* Caller identity */}
            <div>
              <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
                Agent DNA
              </div>
              <div
                className="font-display mt-1 text-2xl font-bold"
                style={{ color: 'var(--vh-text)' }}
              >
                {AGENT_DNA_STUB.callerName}
              </div>
              <div
                className="mt-0.5 text-xs"
                style={{ color: 'var(--vh-text-muted)' }}
              >
                {AGENT_DNA_STUB.org}
              </div>
              <div
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                style={{
                  borderColor: 'var(--vh-active-border)',
                  color: 'var(--vh-active)',
                  backgroundColor: 'var(--vh-active-soft)',
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--vh-active)' }}
                />
                Memory loaded
              </div>
            </div>

            {/* Behavioral traits */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DnaRow
                label="Comms register"
                value={AGENT_DNA_STUB.commsRegister}
              />
              <DnaRow label="Verbosity" value={AGENT_DNA_STUB.verbosity} />
              <DnaRow label="Pace" value={AGENT_DNA_STUB.pace} />
              <DnaRow label="Last call" value={AGENT_DNA_STUB.lastCall} />
              <DnaRow label="Top pain" value={AGENT_DNA_STUB.topPain} full />
            </div>

            {/* Prosody pulse */}
            <div>
              <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[color:var(--vh-text-muted)] uppercase">
                Prosody pulse
              </div>
              <div className="mt-2 flex h-16 items-end gap-[3px]">
                {AGENT_DNA_STUB.prosodyPulse.map((amp, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-block',
                      width: 5,
                      height: `${Math.max(8, amp * 100)}%`,
                      borderRadius: 2,
                      background:
                        'linear-gradient(180deg, var(--vh-active), var(--vh-compliant))',
                      opacity: 0.6 + amp * 0.4,
                    }}
                    aria-hidden="true"
                  />
                ))}
              </div>
              <div
                className="mt-2 text-[11px]"
                style={{ color: 'var(--vh-text-muted)' }}
              >
                Last 24s · steady, warm tone
              </div>
            </div>
          </div>
        </LiquidGlassPanel>
      </motion.div>

      {/* Footer note — orient the user to stub state */}
      <div
        className="mt-6 text-center text-[11px]"
        style={{ color: 'var(--vh-text-faint)' }}
      >
        Stubbed data · S1 schema / S2 voice-engine API / S3 inbound resolver
        wire live data when they land.
      </div>
    </div>
  )
}

// Small helper component for the DNA row pairs.
function DnaRow({
  label,
  value,
  full = false,
}: {
  label: string
  value: string
  full?: boolean
}) {
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <div className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
        {label}
      </div>
      <div
        className="mt-0.5 text-sm font-medium capitalize"
        style={{ color: 'var(--vh-text)' }}
      >
        {value}
      </div>
    </div>
  )
}
