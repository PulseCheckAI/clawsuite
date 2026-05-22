// Conductor — Mission Control (2026-05-19 revolution)
//
// "Real machine" aesthetic: deep obsidian background, scan lines, terminal
// monospace, electric cyan accent. Replaces the prior "office break room"
// Conductor UI with a true agentic AI mission-control HUD.
//
// Same data hook (useConductorGateway) — UI-only redesign. Lifecycle:
//   idle → decomposing → running → complete
//
// Layout:
//   - idle:        Hero launcher (single mission input + model + parallelism)
//   - decomposing: Centered "planning" terminal with live thoughts streaming
//   - running:     3-column HUD — agent matrix | activity stream | task DAG
//   - complete:    Mission summary + transcript + relaunch / new mission

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Activity01Icon,
  AiBrain03Icon,
  Alert02Icon,
  BrowserIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CommandLineIcon,
  CpuIcon,
  CursorPointer02Icon,
  RefreshIcon,
  Rocket01Icon,
  Settings01Icon,
  Share01Icon,
  StopCircleIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  type ConductorTask,
  type ConductorWorker,
  type MissionHistoryEntry,
  useConductorGateway,
} from './hooks/use-conductor-gateway'

// StreamEvent isn't exported from the hook; structurally compatible re-declare.
type StreamEvent =
  | { type: 'assistant'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool'
      name?: string
      phase?: string
      data?: Record<string, unknown>
    }
  | { type: 'done'; state?: string; message?: string }
  | { type: 'error'; message: string }
  | { type: 'started'; runId?: string; sessionKey?: string }

// ─── tokens ─────────────────────────────────────────────────────────────────

const MC_STYLE: CSSProperties = {
  ['--mc-bg' as string]: '#070A11',
  ['--mc-surface' as string]: '#0D131D',
  ['--mc-surface-2' as string]: '#12192680',
  ['--mc-border' as string]: 'rgba(0, 229, 255, 0.10)',
  ['--mc-border-bright' as string]: 'rgba(0, 229, 255, 0.32)',
  ['--mc-text' as string]: '#E6F1FF',
  ['--mc-text-dim' as string]: '#8FA3BF',
  ['--mc-text-dimmer' as string]: '#7A8FA8',
  ['--mc-cyan' as string]: '#00E5FF',
  ['--mc-cyan-soft' as string]: 'rgba(0, 229, 255, 0.12)',
  ['--mc-magenta' as string]: '#FF4FD8',
  ['--mc-magenta-soft' as string]: 'rgba(255, 79, 216, 0.14)',
  ['--mc-amber' as string]: '#FFB547',
  ['--mc-amber-soft' as string]: 'rgba(255, 181, 71, 0.14)',
  ['--mc-emerald' as string]: '#3DF5A1',
  ['--mc-emerald-soft' as string]: 'rgba(61, 245, 161, 0.14)',
  ['--mc-rose' as string]: '#FF6B8B',
  ['--mc-rose-soft' as string]: 'rgba(255, 107, 139, 0.14)',
}

const BLENDED_COST_PER_M = 5

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 0.1 ? 2 : 3)}`
}
function estimateCost(tok: number): number {
  return (Math.max(0, tok) / 1_000_000) * BLENDED_COST_PER_M
}
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const s = Math.floor(ms / 1000)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}
function shortModel(name: string | null | undefined): string {
  if (!name) return '—'
  const last = name.split('/').pop() ?? name
  return last.replace(/^claude-/, '').replace(/-latest$/, '')
}
function callsignFromLabel(label: string, idx: number): string {
  const cleaned = label
    .replace(/^worker[-_]?/i, '')
    .replace(/[_-]+/g, '·')
    .toUpperCase()
    .trim()
  return cleaned || `AGENT·${String(idx + 1).padStart(2, '0')}`
}

// ─── ambient FX ────────────────────────────────────────────────────────────

function ScanlineBackdrop() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 -z-10 motion-reduce:hidden"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(0, 229, 255, 0.045) 0, rgba(0, 229, 255, 0.045) 1px, transparent 1px, transparent 3px)',
          maskImage:
            'radial-gradient(ellipse at center, black 30%, rgba(0,0,0,0.5) 80%, transparent 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0, 229, 255, 0.06), transparent 60%), radial-gradient(ellipse 60% 60% at 50% 100%, rgba(255, 79, 216, 0.04), transparent 60%)',
        }}
      />
    </>
  )
}

type AccentColor = 'cyan' | 'magenta' | 'emerald' | 'amber' | 'rose'

function Pulse({
  active,
  color = 'cyan',
}: {
  active: boolean
  color?: AccentColor
}) {
  const colorVar = `var(--mc-${color})`
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {active && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ backgroundColor: colorVar, opacity: 0.5 }}
        />
      )}
      <span
        className="relative inline-block h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: colorVar,
          boxShadow: active ? `0 0 12px 1px ${colorVar}` : 'none',
        }}
      />
    </span>
  )
}

function statusColor(s: ConductorWorker['status']): AccentColor {
  switch (s) {
    case 'running':
      return 'cyan'
    case 'complete':
      return 'emerald'
    case 'stale':
      return 'amber'
    default:
      return 'rose'
  }
}

function taskStatusColor(s: ConductorTask['status']): AccentColor {
  switch (s) {
    case 'running':
      return 'cyan'
    case 'complete':
      return 'emerald'
    case 'failed':
      return 'rose'
    default:
      return 'amber'
  }
}

// ─── header status bar ──────────────────────────────────────────────────────

function MissionStatusBar({
  phase,
  goal,
  elapsedMs,
  totalTokens,
  workerCount,
  activeCount,
  onStop,
  onReset,
  isStopping,
}: {
  phase: 'idle' | 'decomposing' | 'running' | 'complete'
  goal: string
  elapsedMs: number
  totalTokens: number
  workerCount: number
  activeCount: number
  onStop: () => void
  onReset: () => void
  isStopping: boolean
}) {
  const phaseColor: AccentColor =
    phase === 'complete'
      ? 'emerald'
      : phase === 'decomposing'
        ? 'amber'
        : 'cyan'
  const phaseLabel =
    phase === 'idle'
      ? 'STANDBY'
      : phase === 'decomposing'
        ? 'PLANNING'
        : phase === 'running'
          ? 'LIVE'
          : 'COMPLETE'

  return (
    <div className="sticky top-0 z-30 border-b border-[var(--mc-border)] bg-[var(--mc-bg)]/85 backdrop-blur-md">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <div
            className="relative flex h-9 w-9 items-center justify-center rounded-md border border-[var(--mc-border-bright)]"
            style={{
              backgroundColor: 'var(--mc-cyan-soft)',
              boxShadow: '0 0 24px -8px var(--mc-cyan)',
            }}
          >
            <HugeiconsIcon
              icon={CpuIcon}
              size={18}
              style={{ color: 'var(--mc-cyan)' }}
            />
          </div>
          <div className="leading-tight">
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mc-text-dimmer)]">
              CONDUCTOR · MISSION CONTROL
            </div>
            <div className="flex items-center gap-2 font-mono text-sm text-[var(--mc-text)]">
              <Pulse
                active={phase === 'running' || phase === 'decomposing'}
                color={phaseColor}
              />
              <span
                className="font-semibold tracking-wider"
                style={{ color: `var(--mc-${phaseColor})` }}
              >
                {phaseLabel}
              </span>
              {goal ? (
                <span className="ml-2 max-w-[40vw] truncate text-[var(--mc-text-dim)]">
                  {goal}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <MetricStrip
          chips={[
            { icon: Clock01Icon, label: 'T+', value: formatElapsed(elapsedMs) },
            {
              icon: AiBrain03Icon,
              label: 'TOK',
              value: (
                <AnimatedNumber
                  value={totalTokens}
                  format={(n) => Math.round(n).toLocaleString()}
                  duration={520}
                />
              ),
            },
            {
              icon: Activity01Icon,
              label: 'COST',
              value: (
                <AnimatedNumber
                  value={estimateCost(totalTokens)}
                  format={(n) => formatUsd(n)}
                  duration={520}
                />
              ),
            },
            {
              icon: CursorPointer02Icon,
              label: 'AGENTS',
              value: `${activeCount}/${workerCount}`,
            },
          ]}
        >
          {(phase === 'running' || phase === 'decomposing') && (
            <button
              type="button"
              onClick={onStop}
              disabled={isStopping}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
              style={{
                backgroundColor: 'var(--mc-rose-soft)',
                borderColor: 'var(--mc-rose)',
                color: 'var(--mc-rose)',
              }}
            >
              <HugeiconsIcon icon={StopCircleIcon} size={14} />
              {isStopping ? 'ABORTING' : 'ABORT'}
            </button>
          )}
          {phase === 'complete' && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--mc-border-bright)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--mc-cyan)] hover:bg-[var(--mc-cyan-soft)]"
            >
              <HugeiconsIcon icon={Rocket01Icon} size={14} />
              NEW MISSION
            </button>
          )}
        </MetricStrip>
      </div>
    </div>
  )
}

// Status-bar metric chip strip with subtle cursor parallax — each chip
// translates by a small per-index offset so the row feels like it floats
// above the HUD without distracting from the numbers themselves.
// pointer:coarse + prefers-reduced-motion fall back to a static strip.
function MetricStrip({
  chips,
  children,
}: {
  chips: Array<{
    icon: typeof Clock01Icon
    label: string
    value: React.ReactNode
  }>
  children?: React.ReactNode
}) {
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    if (typeof window === 'undefined') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (reduce || coarse) return

    let raf = 0
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    function tick() {
      cx += (tx - cx) * 0.12
      cy += (ty - cy) * 0.12
      el!.style.setProperty('--mx-bar', cx.toFixed(3))
      el!.style.setProperty('--my-bar', cy.toFixed(3))
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)

    function onMove(e: PointerEvent) {
      const r = el!.getBoundingClientRect()
      const ccx = r.left + r.width / 2
      const ccy = r.top + r.height / 2
      tx = Math.max(-1, Math.min(1, (e.clientX - ccx) / 480))
      ty = Math.max(-1, Math.min(1, (e.clientY - ccy) / 240))
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  return (
    <div
      ref={stripRef}
      className="ml-auto flex items-center gap-3 font-mono text-xs"
      style={
        {
          ['--mx-bar' as string]: '0',
          ['--my-bar' as string]: '0',
        } as CSSProperties
      }
    >
      {chips.map((c, i) => (
        <MetricChip key={c.label} {...c} depth={i + 1} />
      ))}
      {children}
    </div>
  )
}

function MetricChip({
  icon,
  label,
  value,
  depth = 0,
}: {
  icon: typeof Clock01Icon
  label: string
  value: React.ReactNode
  depth?: number
}) {
  // Per-chip parallax offset: 2px per depth unit, max ~8px at depth 4.
  // Reads --mx-bar/--my-bar set by the parent MetricStrip.
  const offset = depth * 2
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--mc-border)] bg-[var(--mc-surface)] px-2.5 py-1.5 motion-reduce:[transform:none!important]"
      style={{
        transform: `translate3d(calc(var(--mx-bar, 0) * ${offset}px), calc(var(--my-bar, 0) * ${offset}px), 0)`,
        transition: 'transform 240ms ease-out',
        willChange: 'transform',
      }}
    >
      <HugeiconsIcon
        icon={icon}
        size={13}
        style={{ color: 'var(--mc-text-dim)' }}
      />
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--mc-text-dimmer)]">
        {label}
      </span>
      <span className="tabular-nums text-[var(--mc-text)]">{value}</span>
    </div>
  )
}

// ─── idle: mission launcher ────────────────────────────────────────────────

// Hero glyph for the idle launcher — six depth layers (per epic-design):
// (0) animated grid mesh, (1) ambient glow blobs, (2) two SVG orbits + nodes,
// (3) the CPU glyph itself, (4) micro caret/halo overlay. All layers respond
// to cursor parallax via CSS vars --mx/--my updated on pointermove. Every
// motion respects prefers-reduced-motion + pointer:coarse (mobile = static).
// ─── AgentFloor — persistent "command room" view ────────────────────────────
//
// Always-on visualization of the agent topology even when no mission is queued.
// Orchestrator at center, 5 specialist worker stations arranged around it,
// neural lines connecting them with continuous comet packets, ambient particles
// drifting upward. Operator sees the architecture BREATHING all the time, not
// just during a mission. Goal: "I wanna see them working."

type FloorSlot = {
  id: string
  callsign: string
  role: string
  color: AccentColor
  left: number // viewBox % (0..100)
  top: number
  delay: number
  statuses: string[] // cycled at idle so agents feel like they're thinking
}

const FLOOR_ORCH = { x: 50, y: 42 }

const ORCH_STATUSES = [
  'monitoring queue',
  'ready',
  'observing workers',
  'idle · supervising',
]

const FLOOR_SLOTS: FloorSlot[] = [
  {
    id: 'r',
    callsign: 'RESEARCH·01',
    role: 'discovery',
    color: 'cyan',
    left: 14,
    top: 22,
    delay: 0,
    statuses: ['scanning corpus', 'indexing 1.2M docs', 'ready', 'standby'],
  },
  {
    id: 'c',
    callsign: 'CODER·02',
    role: 'implementation',
    color: 'emerald',
    left: 86,
    top: 22,
    delay: 0.6,
    statuses: ['warming compilers', 'loading patterns', 'ready', 'standby'],
  },
  {
    id: 'a',
    callsign: 'ANALYST·03',
    role: 'evaluation',
    color: 'amber',
    left: 12,
    top: 70,
    delay: 1.2,
    statuses: ['evaluating signals', 'tuning heuristics', 'ready', 'standby'],
  },
  {
    id: 'v',
    callsign: 'REVIEW·04',
    role: 'verification',
    color: 'magenta',
    left: 88,
    top: 70,
    delay: 1.8,
    statuses: ['caching rubrics', 'priming validators', 'ready', 'standby'],
  },
  {
    id: 'd',
    callsign: 'DEPLOY·05',
    role: 'shipping',
    color: 'cyan',
    left: 50,
    top: 86,
    delay: 2.4,
    statuses: ['prewarming targets', 'syncing runtime', 'ready', 'standby'],
  },
]

// Visible workstation zones on the floor — the operator sees exactly where
// they can drop an agent and what each location means. During drag, the
// nearest zone highlights; on drop, the agent snaps to that zone's center
// if within the snap threshold (else stays where dropped).
type FloorZone = {
  id: string
  label: string
  hint: string
  color: AccentColor
  left: number // center, viewBox %
  top: number
  w: number // half-width %
  h: number // half-height %
}

const FLOOR_ZONES: FloorZone[] = [
  {
    id: 'intake',
    label: 'INTAKE',
    hint: 'discovery · research',
    color: 'cyan',
    left: 14,
    top: 22,
    w: 12,
    h: 13,
  },
  {
    id: 'plan',
    label: 'PLANNING',
    hint: 'orchestrator zone',
    color: 'magenta',
    left: 50,
    top: 42,
    w: 14,
    h: 14,
  },
  {
    id: 'build',
    label: 'BUILD',
    hint: 'implementation',
    color: 'emerald',
    left: 86,
    top: 22,
    w: 12,
    h: 13,
  },
  {
    id: 'analyze',
    label: 'ANALYSIS',
    hint: 'evaluation',
    color: 'amber',
    left: 12,
    top: 70,
    w: 12,
    h: 13,
  },
  {
    id: 'review',
    label: 'REVIEW',
    hint: 'verification',
    color: 'magenta',
    left: 88,
    top: 70,
    w: 12,
    h: 13,
  },
  {
    id: 'ship',
    label: 'SHIP',
    hint: 'deployment',
    color: 'cyan',
    left: 50,
    top: 86,
    w: 14,
    h: 10,
  },
]

// Snap threshold — if agent's drop position is within this % of a zone's
// center, snap to that zone. Tuned for the 78vh floor.
const ZONE_SNAP_THRESHOLD = 12 // %

function nearestZone(
  left: number,
  top: number,
): { zone: FloorZone | null; distance: number } {
  let best: { zone: FloorZone; distance: number } | null = null
  for (const z of FLOOR_ZONES) {
    const d = Math.hypot(z.left - left, z.top - top)
    if (!best || d < best.distance) best = { zone: z, distance: d }
  }
  return best ?? { zone: null, distance: Infinity }
}

// Cycles through a list of statuses with a per-instance offset so multiple
// nodes never sync up. Returns the current label to render.
function useCyclingStatus(
  statuses: string[],
  intervalMs = 4200,
  offset = 0,
): string {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const start = window.setTimeout(() => {
      setIdx((i) => (i + 1) % statuses.length)
      const id = window.setInterval(
        () => setIdx((i) => (i + 1) % statuses.length),
        intervalMs,
      )
      ;(start as unknown as { _i?: number })._i = id as unknown as number
    }, offset)
    return () => {
      window.clearTimeout(start)
      const s = start as unknown as { _i?: number }
      if (s._i != null) window.clearInterval(s._i)
    }
  }, [statuses, intervalMs, offset])
  return statuses[idx] ?? statuses[0] ?? ''
}

function FloorNode({
  callsign,
  role,
  color,
  isOrchestrator,
  status,
}: {
  callsign: string
  role: string
  color: AccentColor
  isOrchestrator?: boolean
  status?: string
}) {
  const size = isOrchestrator ? 96 : 64
  return (
    <div
      className="relative flex flex-col items-center"
      style={{ width: size, transform: 'translate(-50%, -50%)' }}
    >
      {/* glow halo */}
      <div
        className="pointer-events-none absolute inset-[-40%] rounded-full motion-reduce:hidden"
        style={{
          background: `radial-gradient(circle, var(--mc-${color}-soft), transparent 65%)`,
          animation: `mc-breathe ${isOrchestrator ? '4.4s' : '5.6s'} ease-in-out infinite`,
        }}
        aria-hidden
      />
      {/* node body */}
      <div
        className="relative flex items-center justify-center rounded-2xl border"
        style={{
          width: size,
          height: size,
          borderColor: `var(--mc-${color})`,
          background: `linear-gradient(135deg, var(--mc-surface), var(--mc-${color}-soft))`,
          boxShadow: `0 0 24px -8px var(--mc-${color}), inset 0 0 0 1px rgba(255,255,255,0.04)`,
        }}
      >
        <HugeiconsIcon
          icon={isOrchestrator ? CpuIcon : AiBrain03Icon}
          size={isOrchestrator ? 28 : 20}
          style={{ color: `var(--mc-${color})` }}
        />
        {/* breathing pulse dot */}
        <span
          className="absolute -top-1 -right-1 inline-block h-2 w-2 rounded-full motion-reduce:hidden"
          style={{
            backgroundColor: `var(--mc-${color})`,
            boxShadow: `0 0 8px 1px var(--mc-${color})`,
            animation: `mc-breathe 1.6s ease-in-out infinite`,
          }}
        />
      </div>
      {/* callsign + cycling status */}
      <div className="mt-2 text-center">
        <div
          className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: `var(--mc-${color})` }}
        >
          {callsign}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--mc-text-dimmer)]">
          {role}
        </div>
        {status && (
          <div
            key={status}
            className="mt-0.5 font-mono text-[9px] italic motion-reduce:[animation:none]"
            style={{
              color: `var(--mc-${color})`,
              opacity: 0.75,
              animation: 'mc-event-in 380ms cubic-bezier(0.22,1,0.36,1) both',
            }}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  )
}

// Thin wrapper that calls the cycler hook per node so hook order is stable
// (we can't call hooks inside a loop iteration of the parent component).
function LiveFloorNode({
  callsign,
  role,
  color,
  statuses,
  offset,
  isOrchestrator,
}: {
  callsign: string
  role: string
  color: AccentColor
  statuses: string[]
  offset?: number
  isOrchestrator?: boolean
}) {
  const status = useCyclingStatus(statuses, 4200, offset ?? 0)
  return (
    <FloorNode
      callsign={callsign}
      role={role}
      color={color}
      isOrchestrator={isOrchestrator}
      status={status}
    />
  )
}

// ─── LiveFloorStrip — running-phase compact view ──────────────────────────
//
// Compact, read-only variant of AgentFloor for the running phase. Renders
// real ConductorWorker[] in fixed positions around a center orchestrator,
// with neural connection lines breathing between them. No drag, no zones,
// no localStorage — this is a status visualization, not a configurator.
// Wedged above the 3-column RunningHud so the operator always sees the
// active topology, satisfying "live conduction at all times".

const STRIP_LAYOUT: ReadonlyArray<{
  left: number
  top: number
  color: AccentColor
}> = [
  { left: 16, top: 32, color: 'cyan' },
  { left: 84, top: 32, color: 'emerald' },
  { left: 16, top: 72, color: 'amber' },
  { left: 84, top: 72, color: 'magenta' },
  { left: 50, top: 86, color: 'cyan' },
]

const STRIP_ORCH = { left: 50, top: 46 }

function workerToStripDisplay(
  w: ConductorWorker,
  layoutColor: AccentColor,
): {
  callsign: string
  role: string
  color: AccentColor
  statuses: string[]
} {
  const color: AccentColor =
    w.status === 'complete'
      ? 'emerald'
      : w.status === 'stale'
        ? 'amber'
        : w.status === 'running'
          ? layoutColor
          : 'magenta'
  const role =
    w.status === 'running'
      ? 'active'
      : w.status === 'complete'
        ? 'complete'
        : w.status === 'stale'
          ? 'stalled'
          : 'standby'
  const statuses = [w.tokenUsageLabel, shortModel(w.model), role, w.status]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
  return {
    callsign: (w.displayName || w.label || w.key).slice(0, 18),
    role,
    color,
    statuses: statuses.length > 0 ? statuses : ['standby'],
  }
}

function LiveFloorStrip({ workers }: { workers: ConductorWorker[] }) {
  const visible = workers.slice(0, STRIP_LAYOUT.length)
  const lines = visible.map((w, i) => {
    const p = STRIP_LAYOUT[i]!
    return {
      key: w.key,
      d: `M ${STRIP_ORCH.left} ${STRIP_ORCH.top} L ${p.left} ${p.top}`,
      color: p.color,
    }
  })
  const orchRole = workers.some((w) => w.status === 'running')
    ? 'coordinating'
    : workers.every((w) => w.status === 'complete') && workers.length > 0
      ? 'complete'
      : 'standby'

  return (
    <section
      className="relative w-full overflow-hidden rounded-2xl border border-[var(--mc-border)]"
      style={{
        height: 'min(34vh, 320px)',
        background:
          'radial-gradient(ellipse 60% 80% at 50% 50%, rgba(255, 79, 216, 0.06), transparent 60%), radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0, 229, 255, 0.06), transparent 60%), var(--mc-surface)',
        boxShadow:
          '0 0 80px -40px var(--mc-cyan), inset 0 0 0 1px rgba(0,229,255,0.06)',
      }}
      aria-label="Live agent floor — orchestrator and active workers"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {lines.map((line) => (
          <path
            key={line.key}
            d={line.d}
            stroke={`var(--mc-${line.color})`}
            strokeWidth="0.25"
            strokeOpacity="0.55"
            fill="none"
            strokeDasharray="0.6 1.4"
            style={{
              animation: 'mc-flow 5.4s cubic-bezier(0.65, 0, 0.35, 1) infinite',
            }}
          />
        ))}
      </svg>

      {/* orchestrator */}
      <div
        className="absolute motion-reduce:[animation:none!important]"
        style={{
          left: `${STRIP_ORCH.left}%`,
          top: `${STRIP_ORCH.top}%`,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <LiveFloorNode
          callsign="ORCHESTRATOR"
          role={orchRole}
          color="magenta"
          isOrchestrator
          statuses={ORCH_STATUSES}
          offset={0}
        />
      </div>

      {/* live workers */}
      {visible.map((w, i) => {
        const p = STRIP_LAYOUT[i]!
        const disp = workerToStripDisplay(w, p.color)
        return (
          <div
            key={w.key}
            className="absolute motion-reduce:[animation:none!important]"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <LiveFloorNode
              callsign={disp.callsign}
              role={disp.role}
              color={disp.color}
              statuses={disp.statuses}
              offset={i * 600}
            />
          </div>
        )
      })}

      {/* empty state — orchestrator alone until first worker spawns */}
      {visible.length === 0 && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[11px] uppercase tracking-wider"
          style={{ color: 'var(--mc-text-dimmer)' }}
          aria-live="polite"
        >
          <span style={{ color: 'var(--mc-cyan)' }}>$</span>&nbsp;awaiting
          worker spawn…
        </div>
      )}
    </section>
  )
}

// Orchestrator + workers share the same { left, top } shape so the drag
// system treats them uniformly.
const ORCH_ID = '__orch__'

const AGENT_FLOOR_STORAGE_KEY = 'conductor:agent-floor-positions'

function defaultFloorPositions(): Record<
  string,
  { left: number; top: number }
> {
  const p: Record<string, { left: number; top: number }> = {
    [ORCH_ID]: { left: FLOOR_ORCH.x, top: FLOOR_ORCH.y },
  }
  FLOOR_SLOTS.forEach((s) => {
    p[s.id] = { left: s.left, top: s.top }
  })
  return p
}

function loadFloorPositions(): Record<string, { left: number; top: number }> {
  if (typeof window === 'undefined') return defaultFloorPositions()
  try {
    const raw = window.localStorage.getItem(AGENT_FLOOR_STORAGE_KEY)
    if (!raw) return defaultFloorPositions()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return defaultFloorPositions()
    const result = defaultFloorPositions()
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!result[id]) continue
      if (
        v &&
        typeof v === 'object' &&
        typeof (v as { left?: unknown }).left === 'number' &&
        typeof (v as { top?: unknown }).top === 'number'
      ) {
        const lv = (v as { left: number }).left
        const tv = (v as { top: number }).top
        if (Number.isFinite(lv) && Number.isFinite(tv)) {
          result[id] = {
            left: Math.max(5, Math.min(95, lv)),
            top: Math.max(8, Math.min(94, tv)),
          }
        }
      }
    }
    return result
  } catch {
    return defaultFloorPositions()
  }
}

function AgentFloor() {
  const floorRef = useRef<HTMLDivElement>(null)

  // Initial positions: hydrate from localStorage if present, else defaults.
  const [positions, setPositions] = useState<
    Record<string, { left: number; top: number }>
  >(() => loadFloorPositions())
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  // Persist to localStorage when NOT mid-drag. During an active drag,
  // positions update at frame-rate (60+ Hz); writing on every tick churns
  // localStorage unnecessarily. We snapshot once when the drag ends.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (draggingId !== null) return
    try {
      window.localStorage.setItem(
        AGENT_FLOOR_STORAGE_KEY,
        JSON.stringify(positions),
      )
    } catch {
      // localStorage may be disabled (private mode); silently degrade.
    }
  }, [positions, draggingId])

  function resetLayout() {
    setPositions(defaultFloorPositions())
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(AGENT_FLOOR_STORAGE_KEY)
      } catch {
        // ignore
      }
    }
  }

  function pointerDown(id: string, e: React.PointerEvent<HTMLDivElement>) {
    // Coarse-pointer (touch) devices skip drag entirely — the agent floor
    // drag UX is fundamentally a desktop-mouse affordance at this scale.
    // Keyboard users get the equivalent via keyboardMove (Enter cycles zones).
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches
    ) {
      return
    }
    e.preventDefault()
    const floor = floorRef.current
    if (!floor) return
    const rect = floor.getBoundingClientRect()
    const curLeft = ((positions[id]?.left ?? 50) / 100) * rect.width + rect.left
    const curTop = ((positions[id]?.top ?? 50) / 100) * rect.height + rect.top
    dragOffsetRef.current = {
      dx: e.clientX - curLeft,
      dy: e.clientY - curTop,
    }
    setDraggingId(id)
  }

  // Keyboard alternative to drag (WCAG 2.5.7 Dragging Movements).
  // Arrow keys nudge the agent by 4 percentage points; Enter/Space
  // cycles to the next workstation zone in FLOOR_ZONES order.
  function keyboardMove(id: string, e: React.KeyboardEvent<HTMLDivElement>) {
    const STEP = 4
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setPositions((p) => {
        const cur = p[id] ?? { left: 50, top: 50 }
        return {
          ...p,
          [id]: { left: cur.left, top: Math.max(8, cur.top - STEP) },
        }
      })
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setPositions((p) => {
        const cur = p[id] ?? { left: 50, top: 50 }
        return {
          ...p,
          [id]: { left: cur.left, top: Math.min(94, cur.top + STEP) },
        }
      })
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setPositions((p) => {
        const cur = p[id] ?? { left: 50, top: 50 }
        return {
          ...p,
          [id]: { left: Math.max(5, cur.left - STEP), top: cur.top },
        }
      })
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setPositions((p) => {
        const cur = p[id] ?? { left: 50, top: 50 }
        return {
          ...p,
          [id]: { left: Math.min(95, cur.left + STEP), top: cur.top },
        }
      })
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setPositions((p) => {
        const cur = p[id] ?? { left: 50, top: 50 }
        const { zone: near } = nearestZone(cur.left, cur.top)
        const curIdx = near
          ? FLOOR_ZONES.findIndex((z) => z.id === near.id)
          : -1
        const next = FLOOR_ZONES[(curIdx + 1) % FLOOR_ZONES.length]
        return next ? { ...p, [id]: { left: next.left, top: next.top } } : p
      })
    }
  }

  useEffect(() => {
    if (!draggingId) return
    const activeId: string = draggingId
    const floor = floorRef.current
    if (!floor) return
    // rAF-coalesce pointermove → setPositions. On a 120 Hz display
    // the raw event stream can fire 120 times per second; without
    // gating each one re-renders the whole floor + 5 SVG bezier
    // paths. Coalescing caps the work at one update per frame.
    let rafId: number | null = null
    let pending: { left: number; top: number } | null = null
    function flush() {
      rafId = null
      const next = pending
      pending = null
      if (!next) return
      setPositions((p) => ({ ...p, [activeId]: next }))
    }
    function onMove(e: PointerEvent) {
      const rect = floor!.getBoundingClientRect()
      const { dx: ox, dy: oy } = dragOffsetRef.current
      const left = Math.max(
        5,
        Math.min(95, ((e.clientX - ox - rect.left) / rect.width) * 100),
      )
      const top = Math.max(
        8,
        Math.min(94, ((e.clientY - oy - rect.top) / rect.height) * 100),
      )
      pending = { left, top }
      if (rafId === null) rafId = requestAnimationFrame(flush)
    }
    function onUp() {
      // Flush any pending coalesced move before snapping so the snap
      // calculation sees the final cursor position.
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      const finalPending = pending
      pending = null
      setPositions((p) => {
        // Apply any unflushed pending move first.
        const base = finalPending ? { ...p, [activeId]: finalPending } : p
        const cur = base[activeId]
        if (!cur) return base
        const { zone, distance } = nearestZone(cur.left, cur.top)
        if (zone && distance <= ZONE_SNAP_THRESHOLD) {
          return { ...base, [activeId]: { left: zone.left, top: zone.top } }
        }
        return base
      })
      setDraggingId(null)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [draggingId])

  // While dragging, surface the nearest zone so we can highlight it.
  const dragHover = useMemo(() => {
    if (!draggingId) return null
    const pos = positions[draggingId]
    if (!pos) return null
    const { zone, distance } = nearestZone(pos.left, pos.top)
    if (!zone) return null
    return distance <= ZONE_SNAP_THRESHOLD ? zone.id : null
  }, [draggingId, positions])

  const orchPos = positions[ORCH_ID] ?? FLOOR_ORCH
  // viewBox 0..100 with preserveAspectRatio="none" so % maps directly.

  return (
    <div
      ref={floorRef}
      className="relative w-full select-none overflow-hidden rounded-3xl border border-[var(--mc-border-bright)]"
      style={{
        height: 'min(82vh, 880px)',
        background:
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0, 229, 255, 0.10), transparent 60%), radial-gradient(ellipse 70% 50% at 50% 110%, rgba(255, 79, 216, 0.08), transparent 60%), radial-gradient(ellipse 28% 22% at 50% 50%, rgba(255, 79, 216, 0.10), transparent 70%), var(--mc-surface)',
        boxShadow:
          '0 0 120px -40px var(--mc-cyan), 0 0 200px -80px var(--mc-magenta), inset 0 0 0 1px rgba(0,229,255,0.08)',
      }}
    >
      {/* per-node drift keyframes (small unique orbits so each agent
          appears to hover independently — disabled while being dragged) */}
      <style>{`
        @keyframes mc-drift-orch {
          0%, 100% { translate: 0 0; }
          25%      { translate: 6px -4px; }
          50%      { translate: -2px -8px; }
          75%      { translate: -6px -2px; }
        }
        @keyframes mc-drift-r {
          0%, 100% { translate: 0 0; }
          33%      { translate: 8px -6px; }
          66%      { translate: -4px -10px; }
        }
        @keyframes mc-drift-c {
          0%, 100% { translate: 0 0; }
          25%      { translate: -8px -4px; }
          50%      { translate: -4px -12px; }
          75%      { translate: 4px -6px; }
        }
        @keyframes mc-drift-a {
          0%, 100% { translate: 0 0; }
          40%      { translate: 10px 4px; }
          80%      { translate: 2px 10px; }
        }
        @keyframes mc-drift-v {
          0%, 100% { translate: 0 0; }
          30%      { translate: -10px 6px; }
          60%      { translate: -2px 10px; }
          90%      { translate: 6px 2px; }
        }
        @keyframes mc-drift-d {
          0%, 100% { translate: 0 0; }
          50%      { translate: 0 -8px; }
        }
      `}</style>

      {/* ceiling light beam */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-full w-[3px] motion-reduce:hidden"
        style={{
          marginLeft: '-1.5px',
          background:
            'linear-gradient(to bottom, rgba(0,229,255,0.40), transparent 55%)',
          filter: 'blur(3px)',
          animation: 'mc-breathe 7s ease-in-out infinite',
        }}
        aria-hidden
      />
      {/* depth-0 — receding grid floor (CSS 3D-ish) */}
      <div
        className="pointer-events-none absolute inset-0 motion-reduce:hidden"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,229,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage:
            'radial-gradient(ellipse 80% 90% at 50% 50%, black 20%, rgba(0,0,0,0.5) 60%, transparent 90%)',
          animation: 'mc-grid-pan 24s linear infinite',
        }}
        aria-hidden
      />

      {/* depth-0.5 — workstation drop zones (always visible, brighter on drag) */}
      {FLOOR_ZONES.map((zone) => {
        const isHover = dragHover === zone.id
        const isAnyDrag = draggingId != null
        return (
          <div
            key={zone.id}
            className="pointer-events-none absolute"
            style={{
              left: `${zone.left}%`,
              top: `${zone.top}%`,
              width: `${zone.w * 2}%`,
              height: `${zone.h * 2}%`,
              transform: 'translate(-50%, -50%)',
            }}
            aria-hidden
          >
            <div
              className="relative h-full w-full rounded-2xl border"
              style={{
                borderStyle: 'dashed',
                borderWidth: isHover ? 1.5 : 1,
                borderColor: `var(--mc-${zone.color})`,
                opacity: isHover ? 0.95 : isAnyDrag ? 0.55 : 0.28,
                background: isHover
                  ? `radial-gradient(ellipse at center, var(--mc-${zone.color}-soft), transparent 70%)`
                  : isAnyDrag
                    ? `radial-gradient(ellipse at center, color-mix(in srgb, var(--mc-${zone.color}-soft) 50%, transparent), transparent 75%)`
                    : 'transparent',
                boxShadow: isHover
                  ? `0 0 32px -4px var(--mc-${zone.color}), inset 0 0 24px -8px var(--mc-${zone.color})`
                  : 'none',
                transition:
                  'opacity 220ms ease-out, border-width 180ms ease-out, box-shadow 220ms ease-out, background 220ms ease-out',
              }}
            >
              {/* corner ticks — gives the zone a "blueprint" feel */}
              {[
                { l: -1, t: -1 },
                { l: -1, t: 'auto', b: -1 },
                { l: 'auto', t: -1, r: -1 },
                { l: 'auto', t: 'auto', r: -1, b: -1 },
              ].map((c, i) => (
                <span
                  key={i}
                  className="absolute h-2 w-2"
                  style={{
                    left: typeof c.l === 'number' ? c.l : undefined,
                    top: typeof c.t === 'number' ? c.t : undefined,
                    right: 'r' in c ? c.r : undefined,
                    bottom: 'b' in c ? c.b : undefined,
                    borderLeft:
                      c.l !== 'auto'
                        ? `1.5px solid var(--mc-${zone.color})`
                        : undefined,
                    borderRight:
                      c.l === 'auto'
                        ? `1.5px solid var(--mc-${zone.color})`
                        : undefined,
                    borderTop:
                      c.t !== 'auto'
                        ? `1.5px solid var(--mc-${zone.color})`
                        : undefined,
                    borderBottom:
                      c.t === 'auto'
                        ? `1.5px solid var(--mc-${zone.color})`
                        : undefined,
                    opacity: isHover ? 1 : 0.6,
                  }}
                />
              ))}
              {/* zone label */}
              <div className="absolute inset-x-0 top-1 flex items-center justify-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: `var(--mc-${zone.color})`,
                    boxShadow: `0 0 6px 0 var(--mc-${zone.color})`,
                  }}
                />
                <span
                  className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em]"
                  style={{ color: `var(--mc-${zone.color})` }}
                >
                  {zone.label}
                </span>
              </div>
              <div
                className="absolute inset-x-0 bottom-1.5 text-center font-mono text-[8px] uppercase tracking-wider"
                style={{ color: `var(--mc-text-dimmer)` }}
              >
                {zone.hint}
              </div>
            </div>
          </div>
        )
      })}

      {/* depth-1 — orchestrator center glow (follows orchestrator position) */}
      <div
        className="pointer-events-none absolute motion-reduce:hidden"
        style={{
          left: `${orchPos.left}%`,
          top: `${orchPos.top}%`,
          width: 360,
          height: 360,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(255, 79, 216, 0.22), transparent 60%)',
          filter: 'blur(28px)',
          animation: 'mc-breathe 6s ease-in-out infinite',
          transition:
            draggingId === ORCH_ID
              ? 'none'
              : 'left 200ms ease-out, top 200ms ease-out',
        }}
        aria-hidden
      />

      {/* depth-2 — connection lines + ambient comet packets (live re-routed) */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
        style={{ overflow: 'visible' }}
      >
        <defs>
          <filter
            id="mc-floor-glow"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="0.4" />
          </filter>
        </defs>
        {FLOOR_SLOTS.map((slot) => {
          const sp = positions[slot.id] ?? { left: slot.left, top: slot.top }
          const dx = sp.left - orchPos.left
          const dy = sp.top - orchPos.top
          const mx = (orchPos.left + sp.left) / 2
          const my = (orchPos.top + sp.top) / 2
          const cpx = mx + dy * 0.18
          const cpy = my - dx * 0.18
          const d = `M ${orchPos.left} ${orchPos.top} Q ${cpx} ${cpy} ${sp.left} ${sp.top}`
          return (
            <g key={slot.id}>
              <path
                d={d}
                fill="none"
                stroke={`var(--mc-${slot.color})`}
                strokeWidth="0.6"
                strokeOpacity="0.28"
                filter="url(#mc-floor-glow)"
              />
              <path
                d={d}
                fill="none"
                stroke={`var(--mc-${slot.color})`}
                strokeWidth="0.35"
                strokeOpacity="0.6"
                strokeLinecap="round"
                strokeDasharray="0.5 4"
                style={{
                  animation:
                    'mc-flow 5.4s cubic-bezier(0.65, 0, 0.35, 1) infinite',
                  animationDelay: `${slot.delay}s`,
                }}
              />
              <path
                d={d}
                fill="none"
                stroke={`var(--mc-${slot.color})`}
                strokeWidth="1"
                strokeLinecap="round"
                strokeDasharray="0.5 200"
                style={{
                  filter: `drop-shadow(0 0 1.8px var(--mc-${slot.color}))`,
                }}
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="0"
                  to="-200"
                  dur="5.2s"
                  begin={`${slot.delay}s`}
                  repeatCount="indefinite"
                />
              </path>
            </g>
          )
        })}
      </svg>

      {/* depth-3 — draggable orchestrator + worker nodes */}
      <div
        className={cn(
          'absolute motion-reduce:[animation:none!important] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-magenta)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
          draggingId === ORCH_ID ? 'z-30 cursor-grabbing' : 'cursor-grab',
        )}
        tabIndex={0}
        role="button"
        aria-label="Orchestrator agent — use arrow keys to nudge, Enter to cycle workstation zones"
        onPointerDown={(e) => pointerDown(ORCH_ID, e)}
        onKeyDown={(e) => keyboardMove(ORCH_ID, e)}
        style={{
          left: `${orchPos.left}%`,
          top: `${orchPos.top}%`,
          touchAction: 'none',
          transition:
            draggingId === ORCH_ID
              ? 'none'
              : 'left 220ms cubic-bezier(0.22,1,0.36,1), top 220ms cubic-bezier(0.22,1,0.36,1)',
          animation:
            draggingId === ORCH_ID
              ? 'none'
              : 'mc-drift-orch 14s ease-in-out infinite',
        }}
      >
        <LiveFloorNode
          callsign="ORCHESTRATOR"
          role="supervisor"
          color="magenta"
          isOrchestrator
          statuses={ORCH_STATUSES}
          offset={0}
        />
      </div>
      {FLOOR_SLOTS.map((slot) => {
        const sp = positions[slot.id] ?? { left: slot.left, top: slot.top }
        const isDragging = draggingId === slot.id
        return (
          <div
            key={slot.id}
            className={cn(
              'absolute motion-reduce:[animation:none!important] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
              isDragging ? 'z-30 cursor-grabbing' : 'cursor-grab',
            )}
            tabIndex={0}
            role="button"
            aria-label={`${slot.callsign} — ${slot.role} agent. Use arrow keys to nudge, Enter to cycle workstation zones.`}
            onPointerDown={(e) => pointerDown(slot.id, e)}
            onKeyDown={(e) => keyboardMove(slot.id, e)}
            style={{
              left: `${sp.left}%`,
              top: `${sp.top}%`,
              touchAction: 'none',
              transition: isDragging
                ? 'none'
                : 'left 220ms cubic-bezier(0.22,1,0.36,1), top 220ms cubic-bezier(0.22,1,0.36,1)',
              animation: isDragging
                ? 'none'
                : `mc-drift-${slot.id} ${10 + slot.delay * 2}s ease-in-out infinite`,
              animationDelay: `${slot.delay * 0.5}s`,
            }}
          >
            <LiveFloorNode
              callsign={slot.callsign}
              role={slot.role}
              color={slot.color}
              statuses={slot.statuses}
              offset={slot.delay * 600}
            />
          </div>
        )
      })}

      {/* depth-5 — ambient drifting particles */}
      <div
        className="pointer-events-none absolute inset-0 motion-reduce:hidden"
        aria-hidden
      >
        {Array.from({ length: 14 }).map((_, i) => {
          const left = (i * 73) % 100
          const delay = (i * 0.7) % 6
          const dur = 8 + ((i * 1.3) % 5)
          const colors: AccentColor[] = ['cyan', 'magenta', 'emerald', 'amber']
          const color = colors[i % colors.length]
          return (
            <span
              key={i}
              className="absolute h-[2px] w-[2px] rounded-full"
              style={{
                left: `${left}%`,
                bottom: 0,
                backgroundColor: `var(--mc-${color})`,
                boxShadow: `0 0 4px 0 var(--mc-${color})`,
                animation: `mc-rise ${dur}s ease-in-out infinite ${delay}s`,
              }}
            />
          )
        })}
      </div>

      {/* room label — top-left meta */}
      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2">
        <Pulse active color="cyan" />
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mc-cyan)]">
          AGENT FLOOR · LIVE
        </span>
      </div>
      <div className="absolute right-4 top-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--mc-text-dimmer)]">
        <span className="pointer-events-none">
          {FLOOR_SLOTS.length} workers ·{' '}
          {draggingId ? 'repositioning' : 'standing by'}
        </span>
        <span className="pointer-events-none text-[var(--mc-cyan)]">
          ⇢ DRAG TO ASSIGN
        </span>
        <button
          type="button"
          onClick={resetLayout}
          className="rounded border border-[var(--mc-border)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--mc-text-dim)] hover:border-[var(--mc-border-bright)] hover:text-[var(--mc-cyan)]"
          aria-label="Reset agent layout to defaults"
        >
          ↺ RESET
        </button>
      </div>
    </div>
  )
}

// Kept exported as a design reference — replaced by AgentFloor in the idle
// state on 2026-05-19 but the parallax stage is still useful elsewhere.
export function HeroGlyph() {
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (typeof window === 'undefined') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (reduce || coarse) return

    let raf = 0
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0

    function tick() {
      currentX += (targetX - currentX) * 0.12
      currentY += (targetY - currentY) * 0.12
      stage!.style.setProperty('--mx', currentX.toFixed(3))
      stage!.style.setProperty('--my', currentY.toFixed(3))
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)

    function onMove(e: PointerEvent) {
      const rect = stage!.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      // Normalize to [-1, 1] across a ~600px radius around the glyph center
      // so parallax dampens with distance (feels grounded, not chaotic).
      targetX = Math.max(-1, Math.min(1, (e.clientX - cx) / 320))
      targetY = Math.max(-1, Math.min(1, (e.clientY - cy) / 320))
    }
    function onLeave() {
      targetX = 0
      targetY = 0
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('blur', onLeave)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', onLeave)
    }
  }, [])

  return (
    <div
      ref={stageRef}
      className="relative mx-auto h-44 w-44 motion-reduce:mx-auto"
      style={
        {
          ['--mx' as string]: '0',
          ['--my' as string]: '0',
          perspective: '720px',
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {/* depth-0 — grid mesh, slowest parallax, subtle radial fade */}
      <div
        className="pointer-events-none absolute inset-[-20%] -z-30 motion-reduce:hidden"
        style={{
          transform:
            'translate3d(calc(var(--mx) * -6px), calc(var(--my) * -6px), 0)',
          backgroundImage:
            'linear-gradient(rgba(0,229,255,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.10) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage:
            'radial-gradient(circle at center, black 0%, rgba(0,0,0,0.6) 50%, transparent 75%)',
          animation: 'mc-grid-pan 18s linear infinite',
        }}
      />

      {/* depth-1 — ambient glow blobs (cyan + magenta) breathing */}
      <div
        className="pointer-events-none absolute inset-[-40%] -z-20"
        style={{
          transform:
            'translate3d(calc(var(--mx) * -12px), calc(var(--my) * -12px), 0)',
        }}
      >
        <div
          className="absolute left-[10%] top-[10%] h-3/4 w-3/4 rounded-full blur-3xl"
          style={{
            backgroundColor: 'var(--mc-cyan)',
            opacity: 0.22,
            animation: 'mc-breathe 6s ease-in-out infinite',
          }}
        />
        <div
          className="absolute right-[10%] bottom-[10%] h-2/3 w-2/3 rounded-full blur-3xl"
          style={{
            backgroundColor: 'var(--mc-magenta)',
            opacity: 0.14,
            animation: 'mc-breathe 8s ease-in-out infinite reverse',
          }}
        />
      </div>

      {/* depth-2 — orbiting SVG rings + nodes (data-flow halo) */}
      <svg
        viewBox="0 0 200 200"
        className="pointer-events-none absolute inset-0 h-full w-full -z-10"
        style={{
          transform:
            'translate3d(calc(var(--mx) * -22px), calc(var(--my) * -22px), 0)',
        }}
      >
        <defs>
          <radialGradient id="mc-orbit-fade" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--mc-cyan)" stopOpacity="0" />
            <stop offset="60%" stopColor="var(--mc-cyan)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--mc-cyan)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* outer orbit — slow */}
        <g
          style={{
            animation: 'mc-orbit-slow 22s linear infinite',
            transformOrigin: '100px 100px',
          }}
        >
          <circle
            cx="100"
            cy="100"
            r="88"
            fill="none"
            stroke="var(--mc-cyan)"
            strokeWidth="0.6"
            strokeOpacity="0.25"
            strokeDasharray="2 5"
          />
          <circle cx="100" cy="12" r="2" fill="var(--mc-cyan)" />
          <circle cx="188" cy="100" r="1.4" fill="var(--mc-magenta)" />
        </g>

        {/* inner orbit — mid, counter-spin */}
        <g
          style={{
            animation: 'mc-orbit-mid 13s linear infinite reverse',
            transformOrigin: '100px 100px',
          }}
        >
          <circle
            cx="100"
            cy="100"
            r="62"
            fill="none"
            stroke="var(--mc-cyan)"
            strokeWidth="0.6"
            strokeOpacity="0.32"
          />
          <circle cx="100" cy="38" r="2.2" fill="var(--mc-emerald)" />
          <circle cx="162" cy="100" r="1.8" fill="var(--mc-cyan)" />
          <circle cx="100" cy="162" r="1.6" fill="var(--mc-amber)" />
        </g>

        {/* Comet packets — independent of the orbit rotations, so they glide
            smoothly around the (visually static) circles. SMIL <animate>
            instead of CSS keyframes for per-circle dashoffset targets. */}
        <circle
          cx="100"
          cy="100"
          r="88"
          fill="none"
          stroke="var(--mc-cyan)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="3 550"
          style={{ filter: 'drop-shadow(0 0 4px var(--mc-cyan))' }}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-553"
            dur="6s"
            repeatCount="indefinite"
          />
        </circle>
        <circle
          cx="100"
          cy="100"
          r="62"
          fill="none"
          stroke="var(--mc-emerald)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="3 386"
          style={{ filter: 'drop-shadow(0 0 4px var(--mc-emerald))' }}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-389"
            dur="4.5s"
            repeatCount="indefinite"
            begin="1.2s"
          />
        </circle>

        {/* center halo */}
        <circle cx="100" cy="100" r="48" fill="url(#mc-orbit-fade)" />
      </svg>

      {/* depth-3 — the glyph itself, floating + tilting toward cursor */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform:
            'translate3d(calc(var(--mx) * -28px), calc(var(--my) * -28px), 0) rotateX(calc(var(--my) * 8deg)) rotateY(calc(var(--mx) * -8deg))',
          transformStyle: 'preserve-3d',
        }}
      >
        <div
          className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-[var(--mc-border-bright)] motion-reduce:[animation:none]"
          style={{
            background:
              'linear-gradient(135deg, rgba(0,229,255,0.22), rgba(255,79,216,0.10))',
            boxShadow:
              '0 0 64px -12px var(--mc-cyan), inset 0 0 0 1px rgba(255,255,255,0.05)',
            animation: 'mc-float 6.5s ease-in-out infinite',
          }}
        >
          <HugeiconsIcon
            icon={CpuIcon}
            size={38}
            style={{ color: 'var(--mc-cyan)' }}
          />
          {/* subtle inner specular highlight that drifts with cursor */}
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-60 motion-reduce:hidden"
            style={{
              background:
                'radial-gradient(80% 80% at calc(50% + var(--mx) * 18%) calc(50% + var(--my) * 18%), rgba(255,255,255,0.18), transparent 55%)',
            }}
          />
        </div>
      </div>

      {/* depth-5 — tiny foreground sparks (most aggressive parallax) */}
      <div
        className="pointer-events-none absolute inset-0 motion-reduce:hidden"
        style={{
          transform:
            'translate3d(calc(var(--mx) * -36px), calc(var(--my) * -36px), 0)',
        }}
      >
        <span
          className="absolute left-[14%] top-[22%] h-1 w-1 rounded-full"
          style={{
            backgroundColor: 'var(--mc-cyan)',
            boxShadow: '0 0 6px 0 var(--mc-cyan)',
            animation: 'mc-breathe 3.2s ease-in-out infinite',
          }}
        />
        <span
          className="absolute right-[18%] bottom-[28%] h-[3px] w-[3px] rounded-full"
          style={{
            backgroundColor: 'var(--mc-magenta)',
            boxShadow: '0 0 8px 0 var(--mc-magenta)',
            animation: 'mc-breathe 4.4s ease-in-out infinite reverse',
          }}
        />
        <span
          className="absolute right-[26%] top-[18%] h-[2px] w-[2px] rounded-full"
          style={{
            backgroundColor: 'var(--mc-emerald)',
            boxShadow: '0 0 6px 0 var(--mc-emerald)',
            animation: 'mc-breathe 5s ease-in-out infinite',
          }}
        />
      </div>
    </div>
  )
}

function MissionLauncher({
  onLaunch,
  isSending,
  settings,
  setSettings,
  history,
}: {
  onLaunch: (goal: string) => void
  isSending: boolean
  settings: ReturnType<typeof useConductorGateway>['conductorSettings']
  setSettings: ReturnType<typeof useConductorGateway>['setConductorSettings']
  history: MissionHistoryEntry[]
}) {
  const [goal, setGoal] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const canLaunch = goal.trim().length >= 4 && !isSending

  const examples = [
    'Build a landing page for a coffee shop with hero, menu, and contact form',
    'Research the top 5 React state-management libraries in 2026 and compare',
    'Refactor the auth module to use OAuth 2.1 with PKCE',
    'Generate a marketing report on Tampa restaurant tech adoption',
  ]

  return (
    <div className="flex w-full flex-col items-stretch py-6">
      {/* Floor goes full-width — only constrained by viewport padding. */}
      <div className="px-4 pb-6 sm:px-6">
        <AgentFloor />
      </div>
      {/* The mission input + examples + history below stay readable at max-w-5xl. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col items-stretch px-6">
        <div className="text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-[var(--mc-text-dimmer)]">
            PULSE · CONDUCTOR v2 — MISSION CONTROL
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--mc-text)]">
            Describe your mission.
          </h1>
          <p className="mt-2 text-sm text-[var(--mc-text-dim)]">
            A supervisor agent will decompose the goal into tasks, dispatch
            worker agents in parallel, and you&apos;ll watch them build it live
            below.
          </p>
        </div>

        <div
          className="mt-8 overflow-hidden rounded-2xl border border-[var(--mc-border-bright)] bg-[var(--mc-surface)]"
          style={{ boxShadow: '0 0 80px -30px var(--mc-cyan)' }}
        >
          <div className="flex items-center gap-2 border-b border-[var(--mc-border)] px-4 py-2.5">
            <Pulse active={false} color="cyan" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mc-text-dimmer)]">
              MISSION SPEC · stdin
            </span>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--mc-text-dimmer)]">
              {goal.length} chars
            </span>
          </div>
          <textarea
            ref={taRef}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canLaunch) {
                e.preventDefault()
                onLaunch(goal.trim())
              }
            }}
            rows={4}
            placeholder="> Build a real-time chat app with..."
            className="block w-full resize-none bg-transparent px-4 py-3 font-mono text-[15px] leading-relaxed text-[var(--mc-text)] placeholder:text-[var(--mc-text-dimmer)] focus:outline-none"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--mc-border)] bg-[var(--mc-surface-2)] px-4 py-2.5">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--mc-border)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-[var(--mc-text-dim)] hover:border-[var(--mc-border-bright)] hover:text-[var(--mc-text)]"
            >
              <HugeiconsIcon icon={Settings01Icon} size={12} />
              {showSettings ? 'Hide' : 'Configure'}
            </button>
            <div className="font-mono text-[11px] text-[var(--mc-text-dimmer)]">
              orchestrator{' '}
              <span className="text-[var(--mc-text-dim)]">
                {shortModel(settings.orchestratorModel) || 'auto'}
              </span>
              <span className="mx-2">·</span>
              worker{' '}
              <span className="text-[var(--mc-text-dim)]">
                {shortModel(settings.workerModel) || 'auto'}
              </span>
              <span className="mx-2">·</span>
              parallel{' '}
              <span className="text-[var(--mc-text-dim)]">
                {settings.maxParallel}
              </span>
            </div>
            <button
              type="button"
              onClick={() => canLaunch && onLaunch(goal.trim())}
              disabled={!canLaunch}
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition',
                canLaunch
                  ? 'text-[#0A0D14] hover:brightness-110'
                  : 'cursor-not-allowed bg-[var(--mc-surface-2)] text-[var(--mc-text-dimmer)]',
              )}
              style={
                canLaunch
                  ? {
                      backgroundColor: 'var(--mc-cyan)',
                      boxShadow: '0 0 24px -6px var(--mc-cyan)',
                    }
                  : undefined
              }
            >
              <HugeiconsIcon icon={Rocket01Icon} size={14} />
              {isSending ? 'LAUNCHING…' : 'LAUNCH MISSION'}
              <span className="ml-2 hidden rounded border border-current/40 px-1.5 py-0.5 text-[9px] opacity-70 md:inline">
                ⌘ ↵
              </span>
            </button>
          </div>

          {showSettings && (
            <div className="grid gap-3 border-t border-[var(--mc-border)] bg-[var(--mc-surface)] px-4 py-3 sm:grid-cols-2">
              <SettingsField
                label="Orchestrator model"
                value={settings.orchestratorModel}
                onChange={(v) =>
                  setSettings({ ...settings, orchestratorModel: v })
                }
                placeholder="claude-sonnet-4-6 (default)"
              />
              <SettingsField
                label="Worker model"
                value={settings.workerModel}
                onChange={(v) => setSettings({ ...settings, workerModel: v })}
                placeholder="claude-sonnet-4-6 (default)"
              />
              <SettingsField
                label="Projects dir"
                value={settings.projectsDir}
                onChange={(v) => setSettings({ ...settings, projectsDir: v })}
                placeholder="/tmp"
              />
              <SettingsRange
                label="Max parallel workers"
                value={settings.maxParallel}
                onChange={(v) => setSettings({ ...settings, maxParallel: v })}
                min={1}
                max={5}
              />
            </div>
          )}
        </div>

        <div className="mt-6 space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mc-text-dimmer)]">
            Example missions
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setGoal(ex)}
                className="rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] px-3 py-2.5 text-left font-mono text-[12px] text-[var(--mc-text-dim)] transition hover:border-[var(--mc-border-bright)] hover:bg-[var(--mc-surface-2)] hover:text-[var(--mc-text)]"
              >
                <span style={{ color: 'var(--mc-cyan)' }}>$</span> {ex}
              </button>
            ))}
          </div>
        </div>

        <MissionHistoryRail history={history} />
      </div>
    </div>
  )
}

function SettingsField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--mc-text-dimmer)]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-[var(--mc-border)] bg-[var(--mc-surface-2)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--mc-text)] placeholder:text-[var(--mc-text-dimmer)] focus:border-[var(--mc-border-bright)] focus:outline-none"
        spellCheck={false}
      />
    </label>
  )
}

function SettingsRange({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--mc-text-dimmer)]">
        {label} <span style={{ color: 'var(--mc-cyan)' }}>{value}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="accent-[var(--mc-cyan)]"
      />
    </label>
  )
}

// ─── agent matrix (left col) ───────────────────────────────────────────────

function AgentNode({
  worker,
  idx,
  isOrchestrator,
  taskCount,
}: {
  worker: ConductorWorker | null
  idx: number
  isOrchestrator?: boolean
  taskCount?: number
}) {
  const callsign = isOrchestrator
    ? 'ORCHESTRATOR'
    : worker
      ? callsignFromLabel(worker.label, idx)
      : `AGENT·${String(idx + 1).padStart(2, '0')}`
  const status = worker?.status ?? (isOrchestrator ? 'running' : 'idle')
  const color: AccentColor = isOrchestrator ? 'magenta' : statusColor(status)
  const tokens = worker?.totalTokens ?? 0
  const model = worker?.model
  const running =
    status === 'running' || (isOrchestrator && status !== 'complete')

  return (
    <div
      data-mc-node={isOrchestrator ? 'orchestrator' : 'worker'}
      data-mc-running={running ? 'true' : 'false'}
      data-mc-color={color}
      className="relative overflow-hidden rounded-lg border bg-[var(--mc-surface)] px-3 py-2.5 transition"
      style={{
        borderColor: running ? `var(--mc-${color})` : 'var(--mc-border)',
        boxShadow: running ? `0 0 18px -10px var(--mc-${color})` : undefined,
      }}
    >
      {running && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
          style={{
            backgroundColor: `var(--mc-${color})`,
            boxShadow: `0 0 12px 0 var(--mc-${color})`,
          }}
        />
      )}
      <div className="flex items-center gap-2">
        <Pulse active={Boolean(running)} color={color} />
        <span
          className="font-mono text-[11px] font-semibold tracking-wider"
          style={{ color: `var(--mc-${color})` }}
        >
          {callsign}
        </span>
        <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-[var(--mc-text-dimmer)]">
          {status}
        </span>
      </div>
      <div className="mt-1.5 truncate font-mono text-[10px] text-[var(--mc-text-dim)]">
        {isOrchestrator ? (
          <>
            dispatching{' '}
            <AnimatedNumber
              value={taskCount ?? 0}
              format={(n) => String(Math.round(n))}
              duration={620}
            />{' '}
            task{(taskCount ?? 0) === 1 ? '' : 's'}
          </>
        ) : (
          (worker?.label ?? 'standby')
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-[var(--mc-text-dimmer)]">
        <span>{shortModel(model)}</span>
        <span>·</span>
        <span className="tabular-nums">
          <AnimatedNumber
            value={tokens}
            format={(n) => Math.round(n).toLocaleString()}
            duration={520}
          />{' '}
          tok
        </span>
      </div>
      {running && (
        <div className="mt-2 h-[2px] overflow-hidden rounded-full bg-[var(--mc-border)]">
          <div
            className="h-full w-1/3 animate-[mc-shimmer_2.4s_ease-in-out_infinite]"
            style={{
              background: `linear-gradient(90deg, transparent, var(--mc-${color}), transparent)`,
            }}
          />
        </div>
      )}
    </div>
  )
}

function SectionLabel({
  icon,
  label,
  sub,
}: {
  icon: typeof CommandLineIcon
  label: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--mc-border)] pb-2">
      <HugeiconsIcon
        icon={icon}
        size={14}
        style={{ color: 'var(--mc-cyan)' }}
      />
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mc-text)]">
        {label}
      </span>
      {sub && (
        <span className="ml-auto font-mono text-[10px] tracking-wider text-[var(--mc-text-dimmer)]">
          {sub}
        </span>
      )}
    </div>
  )
}

function NeuralLines({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [paths, setPaths] = useState<
    Array<{ d: string; key: string; color: string }>
  >([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function compute() {
      const c = containerRef.current
      if (!c) return
      const orch = c.querySelector<HTMLElement>('[data-mc-node="orchestrator"]')
      const targets = Array.from(
        c.querySelectorAll<HTMLElement>(
          '[data-mc-node="worker"][data-mc-running="true"]',
        ),
      )
      if (!orch || targets.length === 0) {
        setPaths([])
        return
      }
      const cBox = c.getBoundingClientRect()
      const oBox = orch.getBoundingClientRect()
      // Source: just inside the right edge of the orchestrator card.
      const sx = oBox.right - cBox.left - 6
      const sy = oBox.top - cBox.top + oBox.height / 2
      const next = targets.map((t, i) => {
        const tBox = t.getBoundingClientRect()
        // Target: left edge of each running worker card.
        const tx = tBox.left - cBox.left + 6
        const ty = tBox.top - cBox.top + tBox.height / 2
        const dy = ty - sy
        // Curve outward (right) before bending back toward the worker — gives a
        // "broadcast loop" feel even though both endpoints live in the same column.
        const sway = Math.max(40, Math.abs(dy) * 0.6)
        const c1x = sx + sway
        const c1y = sy + dy * 0.1
        const c2x = tx + sway
        const c2y = ty - dy * 0.1
        const d = `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${tx} ${ty}`
        const color = (t.dataset.mcColor as string) || 'cyan'
        return { d, key: `nl-${i}`, color }
      })
      setPaths(next)
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    const innerRo = targetObserve(container, compute)
    const mo = new MutationObserver(compute)
    mo.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-mc-running', 'data-mc-node', 'data-mc-color'],
    })
    container.addEventListener('scroll', compute)
    window.addEventListener('resize', compute)
    return () => {
      ro.disconnect()
      innerRo.disconnect()
      mo.disconnect()
      container.removeEventListener('scroll', compute)
      window.removeEventListener('resize', compute)
    }
  }, [containerRef])

  if (paths.length === 0) return null
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter
          id="mc-neural-glow"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      {paths.map((p, i) => (
        <g key={p.key}>
          {/* Soft glow underlay */}
          <path
            d={p.d}
            fill="none"
            stroke={`var(--mc-${p.color})`}
            strokeWidth={1.4}
            strokeOpacity={0.28}
            filter="url(#mc-neural-glow)"
          />
          {/* Continuous breath — slow, ease-in-out, never racing */}
          <path
            d={p.d}
            fill="none"
            stroke={`var(--mc-${p.color})`}
            strokeWidth={1}
            strokeOpacity={0.55}
            strokeLinecap="round"
            strokeDasharray="2 14"
            style={{
              animation: 'mc-flow 3.6s cubic-bezier(0.65, 0, 0.35, 1) infinite',
            }}
          />
          {/* Single comet-packet — one bright dash glides start→end */}
          <path
            d={p.d}
            fill="none"
            stroke={`var(--mc-${p.color})`}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeDasharray="3 1200"
            style={{
              animation: `mc-packet 3.4s cubic-bezier(0.65, 0, 0.35, 1) infinite`,
              animationDelay: `${i * 0.4}s`,
              filter: 'drop-shadow(0 0 4px currentColor)',
            }}
          />
        </g>
      ))}
    </svg>
  )
}

// Force a recompute when individual worker cards resize (helps when the
// shimmer bar mounts late and bumps the card height). Returns the inner
// observer so the caller must disconnect it in its effect cleanup —
// otherwise observers leak across phase transitions / StrictMode mounts.
function targetObserve(container: HTMLElement, cb: () => void): ResizeObserver {
  const targets = container.querySelectorAll<HTMLElement>('[data-mc-node]')
  const ro = new ResizeObserver(cb)
  targets.forEach((t) => ro.observe(t))
  return ro
}

// Cross-column overlay — anchors on orchestrator (left col) and arcs to each
// running task card (right col). Lives inside the parent grid container so
// the SVG can span both columns. Lazy-recomputes on resize/scroll/mutation.
function CrossColumnLines({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [paths, setPaths] = useState<
    Array<{ d: string; key: string; color: string }>
  >([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function compute() {
      const c = containerRef.current
      if (!c) return
      const orch = c.querySelector<HTMLElement>('[data-mc-node="orchestrator"]')
      const tasks = Array.from(
        c.querySelectorAll<HTMLElement>('[data-mc-task="running"]'),
      )
      if (!orch || tasks.length === 0) {
        setPaths([])
        return
      }
      const cBox = c.getBoundingClientRect()
      const oBox = orch.getBoundingClientRect()
      const sx = oBox.right - cBox.left
      const sy = oBox.top - cBox.top + oBox.height / 2
      const next = tasks.map((t, i) => {
        const tBox = t.getBoundingClientRect()
        const tx = tBox.left - cBox.left
        const ty = tBox.top - cBox.top + tBox.height / 2
        const midX = (sx + tx) / 2
        // Wide S-curve sweeping through the activity stream column.
        const d = `M ${sx} ${sy} C ${midX} ${sy} ${midX} ${ty} ${tx} ${ty}`
        const color = (t.dataset.mcTaskColor as string) || 'cyan'
        return { d, key: `cc-${i}`, color }
      })
      setPaths(next)
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    const mo = new MutationObserver(compute)
    mo.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-mc-task', 'data-mc-task-color', 'data-mc-node'],
    })
    container.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => {
      ro.disconnect()
      mo.disconnect()
      container.removeEventListener('scroll', compute, true)
      window.removeEventListener('resize', compute)
    }
  }, [containerRef])

  if (paths.length === 0) return null
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter id="mc-cc-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      {paths.map((p, i) => (
        <g key={p.key} opacity={0.9}>
          <path
            d={p.d}
            fill="none"
            stroke={`var(--mc-${p.color})`}
            strokeWidth={1.4}
            strokeOpacity={0.22}
            filter="url(#mc-cc-glow)"
          />
          <path
            d={p.d}
            fill="none"
            stroke={`var(--mc-${p.color})`}
            strokeWidth={1}
            strokeOpacity={0.5}
            strokeLinecap="round"
            strokeDasharray="2 16"
            style={{
              animation: 'mc-flow 4.5s cubic-bezier(0.65, 0, 0.35, 1) infinite',
            }}
          />
          <path
            d={p.d}
            fill="none"
            stroke={`var(--mc-${p.color})`}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeDasharray="3 1200"
            style={{
              animation:
                'mc-packet 4.2s cubic-bezier(0.65, 0, 0.35, 1) infinite',
              animationDelay: `${i * 0.55}s`,
              filter: 'drop-shadow(0 0 6px currentColor)',
            }}
          />
        </g>
      ))}
    </svg>
  )
}

function AgentMatrix({
  workers,
  taskCount,
  maxParallel,
}: {
  workers: ConductorWorker[]
  taskCount: number
  maxParallel: number
}) {
  const ghostSlots = Math.max(0, maxParallel - workers.length)
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <SectionLabel
        icon={CommandLineIcon}
        label="Agent Matrix"
        sub={`${workers.length} dispatched · ${maxParallel} slots`}
      />
      <div ref={contentRef} className="relative flex flex-col gap-3">
        <NeuralLines containerRef={contentRef} />
        <AgentNode
          worker={null}
          idx={-1}
          isOrchestrator
          taskCount={taskCount}
        />
        {workers.map((w, i) => (
          <AgentNode key={w.key} worker={w} idx={i} />
        ))}
      </div>
      {Array.from({ length: ghostSlots }).map((_, i) => (
        <div
          key={`ghost-${i}`}
          className="rounded-lg border border-dashed border-[var(--mc-border)] bg-transparent px-3 py-2.5"
        >
          <div className="flex items-center gap-2">
            <Pulse active={false} color="rose" />
            <span className="font-mono text-[11px] tracking-wider text-[var(--mc-text-dimmer)]">
              SLOT · OPEN
            </span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-[var(--mc-text-dimmer)]">
            awaiting dispatch
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── activity stream (center col) ───────────────────────────────────────────

function StreamEventRow({ event, idx }: { event: StreamEvent; idx: number }) {
  // Per-event color + glyph + label so the stream reads like real machine
  // telemetry instead of a single rolling text blob.
  let color: AccentColor = 'cyan'
  let label = ''
  let body = ''
  let dim = false
  switch (event.type) {
    case 'assistant':
      color = 'cyan'
      label = 'AGENT'
      body = event.text
      break
    case 'thinking':
      color = 'magenta'
      label = 'THINK'
      body = event.text
      dim = true
      break
    case 'tool': {
      color = 'amber'
      const phase = (event.phase || '').toUpperCase()
      label = `TOOL${phase ? '·' + phase : ''}`
      const name = event.name ?? '<unknown>'
      const dataKeys = event.data
        ? Object.keys(event.data).slice(0, 3).join(', ')
        : ''
      body = dataKeys ? `${name}(${dataKeys})` : name
      break
    }
    case 'started':
      color = 'cyan'
      label = 'BOOT'
      body = `runId=${event.runId ?? '—'} session=${event.sessionKey ?? '—'}`
      dim = true
      break
    case 'done':
      color = 'emerald'
      label = 'DONE'
      body = event.message ?? event.state ?? 'ok'
      break
    case 'error':
      color = 'rose'
      label = 'ERR '
      body = event.message
      break
  }
  return (
    <div
      className="flex items-start gap-2 py-0.5 motion-reduce:[animation:none]"
      style={{
        animation: 'mc-event-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
    >
      <span
        className="mt-[2px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor: `var(--mc-${color})`,
          boxShadow: `0 0 6px 0 var(--mc-${color})`,
        }}
        aria-hidden
      />
      <span
        className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
        style={{ color: `var(--mc-${color})` }}
      >
        {label.padEnd(6, ' ')}
      </span>
      <span className="ml-1 shrink-0 font-mono text-[10px] tabular-nums text-[var(--mc-text-dimmer)]">
        #{String(idx + 1).padStart(3, '0')}
      </span>
      <pre
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed',
          dim
            ? 'italic text-[var(--mc-text-dimmer)]'
            : 'text-[var(--mc-text-dim)]',
        )}
      >
        {body}
      </pre>
    </div>
  )
}

function ActivityStream({
  streamEvents,
  streamText,
  planText,
  streamError,
}: {
  streamEvents: StreamEvent[]
  streamText: string
  planText: string
  streamError: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const hasEvents = streamEvents.length > 0
  const fallback = streamText || planText

  useEffect(() => {
    if (stickToBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [streamEvents.length, fallback, stickToBottom])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setStickToBottom(distFromBottom < 80)
  }

  return (
    <div className="flex h-full flex-col">
      <SectionLabel
        icon={Activity01Icon}
        label="Activity Stream"
        sub={
          hasEvents
            ? `${streamEvents.length} events · ${stickToBottom ? 'tail · live' : 'scroll · paused'}`
            : stickToBottom
              ? 'tail · live'
              : 'scroll · paused'
        }
      />
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        aria-label="Mission activity stream"
        className="mt-2 flex-1 overflow-y-auto rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] p-3"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, rgba(0, 229, 255, 0.02), transparent 30%)',
        }}
      >
        {hasEvents ? (
          <div className="flex flex-col">
            {streamEvents.map((ev, i) => (
              // Composite key — StreamEvent has no id field. Index alone
              // would reconcile incorrectly if the hook ever dedups/retries.
              // Pairing with type at least scopes mistakes to like-typed
              // events instead of crossing into different shapes.
              <StreamEventRow key={`${ev.type}-${i}`} event={ev} idx={i} />
            ))}
            <span
              className="mt-1 ml-0.5 inline-block h-3 w-[7px] animate-[mc-caret_1s_steps(1)_infinite]"
              style={{ backgroundColor: 'var(--mc-cyan)' }}
            />
          </div>
        ) : fallback ? (
          <>
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--mc-text-dim)]">
              {fallback}
            </pre>
            <span
              className="ml-0.5 inline-block h-3 w-[7px] animate-[mc-caret_1s_steps(1)_infinite]"
              style={{ backgroundColor: 'var(--mc-cyan)' }}
            />
          </>
        ) : (
          <div className="font-mono text-[11px] text-[var(--mc-text-dimmer)]">
            <span style={{ color: 'var(--mc-cyan)' }}>$</span> awaiting first
            transmission…
          </div>
        )}
        {streamError && (
          <div
            role="alert"
            className="mt-3 rounded-md border px-3 py-2"
            style={{
              borderColor: 'var(--mc-rose)',
              backgroundColor: 'var(--mc-rose-soft)',
              color: 'var(--mc-rose)',
            }}
          >
            <div className="font-semibold">STREAM ERROR</div>
            <div className="mt-1 text-xs">{streamError}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function MissionHistoryRail({ history }: { history: MissionHistoryEntry[] }) {
  const top = history.slice(0, 5)
  if (top.length === 0) return null

  function durMs(a: string, b: string): number {
    const ta = Date.parse(a)
    const tb = Date.parse(b)
    return Number.isFinite(ta) && Number.isFinite(tb) ? Math.max(0, tb - ta) : 0
  }

  return (
    <div className="mt-6 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mc-text-dimmer)]">
          Recent missions
        </div>
        <div className="font-mono text-[10px] tracking-wider text-[var(--mc-text-dimmer)]">
          {history.length} total
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {top.map((m) => {
          const ok = m.status === 'completed'
          const color: AccentColor = ok ? 'emerald' : 'rose'
          const dur = formatElapsed(durMs(m.startedAt, m.completedAt))
          return (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-md border border-[var(--mc-border)] bg-[var(--mc-surface)] px-3 py-2 transition hover:border-[var(--mc-border-bright)]"
            >
              <Pulse active={false} color={color} />
              <span
                className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
                style={{ color: `var(--mc-${color})` }}
              >
                {ok ? 'OK' : 'ERR'}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--mc-text)]">
                {m.goal}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-[var(--mc-text-dimmer)]">
                {dur}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-[var(--mc-text-dimmer)]">
                {m.workerCount}w
              </span>
              <span className="hidden font-mono text-[10px] tabular-nums text-[var(--mc-text-dimmer)] sm:inline">
                {(m.totalTokens / 1000).toFixed(1)}k tok
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── task DAG (right col) ───────────────────────────────────────────────────

function TaskCard({
  task,
  idx,
  worker,
}: {
  task: ConductorTask
  idx: number
  worker: ConductorWorker | null
}) {
  const color = taskStatusColor(task.status)
  const active = task.status === 'running'
  const completeOrFailed =
    task.status === 'complete' || task.status === 'failed'

  return (
    <div
      data-mc-task={task.status}
      data-mc-task-color={color}
      className="relative rounded-lg border bg-[var(--mc-surface)] px-3 py-2.5"
      style={{
        borderColor: active ? `var(--mc-${color})` : 'var(--mc-border)',
        boxShadow: active ? `0 0 18px -10px var(--mc-${color})` : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px]"
          style={{
            borderColor: `var(--mc-${color})`,
            color: `var(--mc-${color})`,
          }}
        >
          {idx + 1}
        </span>
        <Pulse active={active} color={color} />
        <span
          className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: `var(--mc-${color})` }}
        >
          {task.status}
        </span>
        {completeOrFailed && (
          <HugeiconsIcon
            icon={
              task.status === 'complete' ? CheckmarkCircle02Icon : Alert02Icon
            }
            size={12}
            style={{ color: `var(--mc-${color})` }}
            className="ml-1"
          />
        )}
      </div>
      <div className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-[var(--mc-text)]">
        {task.title}
      </div>
      {worker && (
        <div className="mt-2 font-mono text-[10px] text-[var(--mc-text-dimmer)]">
          → {callsignFromLabel(worker.label, idx)}
        </div>
      )}
    </div>
  )
}

function TaskDag({
  tasks,
  workers,
}: {
  tasks: ConductorTask[]
  workers: ConductorWorker[]
}) {
  const workerByKey = useMemo(() => {
    const m = new Map<string, ConductorWorker>()
    workers.forEach((w) => m.set(w.key, w))
    return m
  }, [workers])

  const done = tasks.filter((t) => t.status === 'complete').length
  const total = tasks.length

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <SectionLabel
        icon={CheckmarkCircle02Icon}
        label="Task DAG"
        sub={total > 0 ? `${done}/${total} complete` : 'no tasks yet'}
      />
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--mc-border)] px-3 py-6 text-center font-mono text-[11px] text-[var(--mc-text-dimmer)]">
          Tasks will materialize once the orchestrator finishes planning.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((t, i) => (
            <TaskCard
              key={t.id}
              task={t}
              idx={i}
              worker={
                t.workerKey ? (workerByKey.get(t.workerKey) ?? null) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── complete state ────────────────────────────────────────────────────────

// Apple-keynote count-up: smoothly interpolate 0 → target over duration using
// requestAnimationFrame + ease-out cubic. Updates state ~60x/s during the
// run, then settles on the exact target value. Reduced-motion users skip
// straight to the final number.
function useAnimatedNumber(target: number, durationMs = 1100): number {
  const [value, setValue] = useState(target)
  const startedAtRef = useRef<number | null>(null)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !Number.isFinite(target)) {
      setValue(target)
      return
    }
    // Skip RAF entirely when the delta is sub-pixel — token counts tick by
    // 1-3 per stream event and a 0.7-unit count-up spawns a full 60-frame
    // animation loop for visually-identical output. Pay the RAF only when
    // the change is human-noticeable.
    if (Math.abs(target - fromRef.current) < 1) {
      setValue(target)
      return
    }
    fromRef.current = value
    startedAtRef.current = null
    function step(ts: number) {
      if (startedAtRef.current == null) startedAtRef.current = ts
      const elapsed = ts - (startedAtRef.current ?? ts)
      const progress = Math.min(1, elapsed / durationMs)
      // ease-out cubic — feels organic, decelerates into the target
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = fromRef.current + (target - fromRef.current) * eased
      setValue(next)
      if (progress < 1) {
        rafRef.current = window.requestAnimationFrame(step)
      } else {
        setValue(target)
      }
    }
    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs])

  return value
}

function AnimatedNumber({
  value,
  format,
  duration,
}: {
  value: number
  format: (n: number) => string
  duration?: number
}) {
  const live = useAnimatedNumber(value, duration)
  return <>{format(live)}</>
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string
  value: React.ReactNode
  color: AccentColor
}) {
  return (
    <div
      className="rounded-xl border bg-[var(--mc-surface)] px-4 py-3"
      style={{
        borderColor: `var(--mc-${color})`,
        boxShadow: `0 0 32px -16px var(--mc-${color})`,
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mc-text-dimmer)]">
        {label}
      </div>
      <div
        className="mt-1 tabular-nums font-mono text-2xl font-semibold"
        style={{ color: `var(--mc-${color})` }}
      >
        {value}
      </div>
    </div>
  )
}

// Best-effort extraction of the artifact directory from orchestrator/worker
// streams. Recognizes /tmp/dispatch-<slug>/ paths the dispatch skill emits.
function extractProjectPath(text: string): string | null {
  if (!text) return null
  const structured = [
    /\b(?:Created|Output|Wrote|Saved to|Built|Generated|Written to)\s+(\/tmp\/dispatch-[^\s"')`\]>]+)/gi,
    /\b(?:Created|Output|Wrote|Saved to|Built|Generated|Written to)\s*:\s*(\/tmp\/dispatch-[^\s"')`\]>]+)/gi,
  ]
  for (const pattern of structured) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const raw = m[1]?.replace(/[.,;:!?`]+$/, '')
      if (!raw) continue
      const norm = raw.replace(/\/(index\.html|dist|build)\/?$/i, '')
      if (norm.startsWith('/tmp/dispatch-')) return norm
    }
  }
  const generic = text.match(/\/tmp\/dispatch-[^\s"')`\]>]+/g) ?? []
  for (const raw of generic) {
    const norm = raw
      .replace(/[.,;:!?\-`]+$/, '')
      .replace(/\/(index\.html|dist|build)\/?$/i, '')
    if (norm.startsWith('/tmp/dispatch-')) return norm
  }
  return null
}

// Apple-discipline artifact preview: simulated browser chrome (traffic lights
// + url bar), refresh + open-in-new-tab, cyan glow frame, skeleton while iframe
// loads, "no preview" fallback when there's no artifact path to embed.
function OutputPreview({ projectPath }: { projectPath: string | null }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState(false)

  if (!projectPath) {
    return (
      <div className="flex flex-col gap-2">
        <SectionLabel icon={BrowserIcon} label="Artifact preview" />
        <div className="rounded-xl border border-dashed border-[var(--mc-border)] bg-[var(--mc-surface)] px-6 py-10 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mc-text-dimmer)]">
            No artifact preview
          </div>
          <div className="mt-2 text-sm text-[var(--mc-text-dim)]">
            This mission didn&apos;t emit a recognizable artifact path. Research
            and review missions often complete without writing files.
          </div>
        </div>
      </div>
    )
  }

  const previewSrc = `/api/preview-file?path=${encodeURIComponent(
    `${projectPath}/index.html`,
  )}`

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel
        icon={BrowserIcon}
        label="Artifact preview"
        sub={projectPath}
      />
      <div
        className="overflow-hidden rounded-xl border border-[var(--mc-border-bright)] bg-[var(--mc-surface)]"
        style={{ boxShadow: '0 0 48px -18px var(--mc-cyan)' }}
      >
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[var(--mc-border)] bg-[var(--mc-surface-2)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: 'var(--mc-rose)', opacity: 0.6 }}
            />
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: 'var(--mc-amber)', opacity: 0.6 }}
            />
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: 'var(--mc-emerald)', opacity: 0.6 }}
            />
          </div>
          <div className="ml-3 flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--mc-border)] bg-[var(--mc-surface)] px-2.5 py-1">
            <Pulse active={false} color="cyan" />
            <span className="truncate font-mono text-[11px] text-[var(--mc-text-dim)]">
              {projectPath}/index.html
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoaded(false)
              setReloadKey((k) => k + 1)
            }}
            aria-label="Reload preview"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--mc-border)] text-[var(--mc-text-dim)] hover:border-[var(--mc-border-bright)] hover:text-[var(--mc-cyan)]"
          >
            <HugeiconsIcon icon={RefreshIcon} size={12} />
          </button>
          <a
            href={previewSrc}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--mc-border)] text-[var(--mc-text-dim)] hover:border-[var(--mc-border-bright)] hover:text-[var(--mc-cyan)]"
          >
            <HugeiconsIcon icon={Share01Icon} size={12} />
          </a>
        </div>
        {/* Iframe + skeleton */}
        <div className="relative h-[60vh] min-h-[480px] bg-white">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--mc-surface-2)]">
              <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--mc-text-dimmer)]">
                <Pulse active color="cyan" />
                loading artifact…
              </div>
            </div>
          )}
          <iframe
            key={reloadKey}
            src={previewSrc}
            title="Mission artifact"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </div>
  )
}

// Cinematic celebration backdrop — wraps the success banner with depth
// layers, one-shot entry animation, and ambient sparks. Restraint over
// confetti: Apple-style "moment" not party-crash. Reduced-motion strips
// the celebration entirely and renders a static banner.
function CelebrationBackdrop({ children }: { children: React.ReactNode }) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    // Defer one frame so the initial transform applies + transitions in.
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className="relative">
      {/* depth-1 — emerald + cyan ambient glow */}
      <div
        className="pointer-events-none absolute inset-[-30%] -z-10 motion-reduce:hidden"
        aria-hidden
      >
        <div
          className="absolute left-[10%] top-[5%] h-3/4 w-1/2 rounded-full blur-3xl"
          style={{
            backgroundColor: 'var(--mc-emerald)',
            opacity: 0.16,
            animation: 'mc-breathe 5s ease-in-out infinite',
          }}
        />
        <div
          className="absolute right-[10%] bottom-[5%] h-2/3 w-1/2 rounded-full blur-3xl"
          style={{
            backgroundColor: 'var(--mc-cyan)',
            opacity: 0.1,
            animation: 'mc-breathe 7s ease-in-out infinite reverse',
          }}
        />
      </div>

      {/* depth-2 — orbiting "complete" ring */}
      <svg
        viewBox="0 0 600 200"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full motion-reduce:hidden"
        aria-hidden
      >
        <g
          style={{
            animation: 'mc-orbit-slow 32s linear infinite',
            transformOrigin: '300px 100px',
          }}
        >
          <ellipse
            cx="300"
            cy="100"
            rx="280"
            ry="70"
            fill="none"
            stroke="var(--mc-emerald)"
            strokeWidth="0.6"
            strokeOpacity="0.30"
            strokeDasharray="3 8"
          />
          <circle cx="20" cy="100" r="2" fill="var(--mc-emerald)" />
          <circle cx="580" cy="100" r="1.6" fill="var(--mc-cyan)" />
        </g>
      </svg>

      {/* depth-5 — rising sparks (subtle, ~3 elements) */}
      <div
        className="pointer-events-none absolute inset-0 motion-reduce:hidden"
        aria-hidden
      >
        <span
          className="absolute left-[18%] bottom-[8%] h-[3px] w-[3px] rounded-full"
          style={{
            backgroundColor: 'var(--mc-emerald)',
            boxShadow: '0 0 8px 0 var(--mc-emerald)',
            animation: 'mc-rise 4.5s ease-in-out infinite',
          }}
        />
        <span
          className="absolute left-[42%] bottom-[12%] h-[2px] w-[2px] rounded-full"
          style={{
            backgroundColor: 'var(--mc-cyan)',
            boxShadow: '0 0 6px 0 var(--mc-cyan)',
            animation: 'mc-rise 6s ease-in-out infinite 1s',
          }}
        />
        <span
          className="absolute right-[24%] bottom-[6%] h-[3px] w-[3px] rounded-full"
          style={{
            backgroundColor: 'var(--mc-amber)',
            boxShadow: '0 0 6px 0 var(--mc-amber)',
            animation: 'mc-rise 5.2s ease-in-out infinite 2s',
          }}
        />
      </div>

      {/* depth-3 — the actual banner (entry-animated) */}
      <div
        className="relative"
        style={{
          transition:
            'transform 520ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 360ms ease-out',
          transform: entered
            ? 'translateY(0) scale(1)'
            : 'translateY(8px) scale(0.985)',
          opacity: entered ? 1 : 0,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function MissionSummary({
  goal,
  elapsedMs,
  totalTokens,
  workers,
  streamText,
  onReset,
  onRetry,
}: {
  goal: string
  elapsedMs: number
  totalTokens: number
  workers: ConductorWorker[]
  streamText: string
  onReset: () => void
  onRetry: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-6">
      <CelebrationBackdrop>
        <div
          className="rounded-2xl border px-5 py-4"
          style={{
            borderColor: 'var(--mc-emerald)',
            backgroundColor: 'var(--mc-emerald-soft)',
            boxShadow: '0 0 80px -20px var(--mc-emerald)',
          }}
        >
          <div className="flex items-center gap-3">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={28}
              style={{
                color: 'var(--mc-emerald)',
                animation: 'mc-stamp 700ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
            <div>
              <div
                className="font-mono text-[10px] uppercase tracking-[0.32em]"
                style={{ color: 'var(--mc-emerald)' }}
              >
                MISSION COMPLETE
              </div>
              <div className="mt-0.5 text-base text-[var(--mc-text)]">
                {goal}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--mc-border-bright)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--mc-cyan)] hover:bg-[var(--mc-cyan-soft)]"
              >
                <HugeiconsIcon icon={RefreshIcon} size={14} />
                RERUN
              </button>
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider hover:brightness-110"
                style={{
                  backgroundColor: 'var(--mc-cyan)',
                  color: '#0A0D14',
                  boxShadow: '0 0 24px -6px var(--mc-cyan)',
                }}
              >
                <HugeiconsIcon icon={Rocket01Icon} size={14} />
                NEW MISSION
              </button>
            </div>
          </div>
        </div>
      </CelebrationBackdrop>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryStat
          label="Elapsed"
          color="cyan"
          value={
            <AnimatedNumber
              value={elapsedMs}
              format={(n) => formatElapsed(n)}
              duration={1400}
            />
          }
        />
        <SummaryStat
          label="Tokens"
          color="emerald"
          value={
            <AnimatedNumber
              value={totalTokens}
              format={(n) => Math.round(n).toLocaleString()}
              duration={1400}
            />
          }
        />
        <SummaryStat
          label="Cost"
          color="amber"
          value={
            <AnimatedNumber
              value={estimateCost(totalTokens)}
              format={(n) => formatUsd(n)}
              duration={1400}
            />
          }
        />
        <SummaryStat
          label="Agents"
          color="magenta"
          value={
            <AnimatedNumber
              value={workers.length}
              format={(n) => String(Math.round(n))}
              duration={900}
            />
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-2">
          <SectionLabel
            icon={CommandLineIcon}
            label="Crew"
            sub={`${workers.length} agents`}
          />
          <div className="flex flex-col gap-2">
            {workers.map((w, i) => (
              <AgentNode key={w.key} worker={w} idx={i} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <SectionLabel icon={Activity01Icon} label="Transcript" />
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] p-3 font-mono text-[12px] leading-relaxed text-[var(--mc-text-dim)]">
            <pre className="whitespace-pre-wrap break-words">
              {streamText || '(no transcript captured)'}
            </pre>
          </div>
        </div>
      </div>

      <OutputPreview projectPath={extractProjectPath(streamText)} />
    </div>
  )
}

// ─── decomposing state ─────────────────────────────────────────────────────

function MissionPlanning({
  planText,
  streamError,
}: {
  planText: string
  streamError: string | null
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-stretch gap-4 px-6 py-12">
      <div className="text-center">
        <div
          className="inline-flex items-center gap-2 rounded-md border border-[var(--mc-border-bright)] px-3 py-1.5"
          style={{ backgroundColor: 'var(--mc-cyan-soft)' }}
        >
          <Pulse active color="amber" />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.32em]"
            style={{ color: 'var(--mc-amber)' }}
          >
            ORCHESTRATOR · PLANNING
          </span>
        </div>
        <h2 className="mt-4 text-xl text-[var(--mc-text)]">
          Decomposing your mission…
        </h2>
        <p className="mt-1 text-sm text-[var(--mc-text-dim)]">
          The supervisor agent is analyzing the goal and drafting a task plan.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4 font-mono text-[12px] leading-relaxed text-[var(--mc-text-dim)]">
        {planText ? (
          <>
            <pre className="whitespace-pre-wrap break-words">{planText}</pre>
            <span
              className="ml-0.5 inline-block h-3 w-[7px] animate-[mc-caret_1s_steps(1)_infinite]"
              style={{ backgroundColor: 'var(--mc-cyan)' }}
            />
          </>
        ) : (
          <div className="text-[var(--mc-text-dimmer)]">
            <span style={{ color: 'var(--mc-cyan)' }}>$</span> orchestrator is
            thinking…
          </div>
        )}
      </div>

      {streamError && (
        <div
          className="rounded-lg border px-4 py-3"
          style={{
            borderColor: 'var(--mc-rose)',
            backgroundColor: 'var(--mc-rose-soft)',
            color: 'var(--mc-rose)',
          }}
        >
          <div className="font-mono text-[11px] uppercase tracking-wider">
            ERROR
          </div>
          <div className="mt-1 text-sm">{streamError}</div>
        </div>
      )}
    </div>
  )
}

// ─── root ──────────────────────────────────────────────────────────────────

// Owns the ref CrossColumnLines uses to span both columns. Kept as its own
// component (vs inlining in Conductor) so the ref + useEffect stay scoped to
// the running phase and reset cleanly when phase changes.
function RunningHud({
  workers,
  tasks,
  maxParallel,
  streamEvents,
  streamText,
  planText,
  streamError,
}: {
  workers: ConductorWorker[]
  tasks: ConductorTask[]
  maxParallel: number
  streamEvents: StreamEvent[]
  streamText: string
  planText: string
  streamError: string | null
}) {
  const hudRef = useRef<HTMLDivElement>(null)
  return (
    <div className="flex h-full flex-col gap-3 px-6 py-4">
      {/* Live conduction strip — orchestrator + real workers, always visible
          during running phase. Read-only complement to the 3-column HUD. */}
      <LiveFloorStrip workers={workers} />
      <div
        ref={hudRef}
        className="relative grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_320px]"
      >
        <CrossColumnLines containerRef={hudRef} />
        <AgentMatrix
          workers={workers}
          taskCount={tasks.length}
          maxParallel={maxParallel}
        />
        <ActivityStream
          streamEvents={streamEvents}
          streamText={streamText}
          planText={planText}
          streamError={streamError}
        />
        <TaskDag tasks={tasks} workers={workers} />
      </div>
    </div>
  )
}

// Boot sequence — fires once when phase transitions idle → decomposing.
// Streams terminal-style boot lines + a CRT power-on horizontal sweep, then
// fades out and unmounts. Auto-completes after ~1.9s. Reduced-motion users
// skip the visual flair entirely (the overlay never mounts).
const BOOT_LINES: Array<{
  at: number
  text: string
  color: 'cyan' | 'magenta' | 'emerald' | 'amber'
}> = [
  { at: 0, text: '> initializing conductor v2…', color: 'cyan' },
  {
    at: 180,
    text: '> establishing neural link to gateway @ 127.0.0.1:18789',
    color: 'cyan',
  },
  { at: 360, text: '> orchestrator: bootstrapping', color: 'magenta' },
  { at: 540, text: '> parsing mission spec', color: 'cyan' },
  { at: 760, text: '> dispatch skill: loaded', color: 'cyan' },
  { at: 940, text: '> worker pool: standby (slots open)', color: 'amber' },
  {
    at: 1120,
    text: '> READY · transferring control to planning phase',
    color: 'emerald',
  },
]

function BootSequence({ onComplete }: { onComplete: () => void }) {
  const [visibleCount, setVisibleCount] = useState(0)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      const id = window.setTimeout(onComplete, 80)
      return () => window.clearTimeout(id)
    }
    const timers: number[] = []
    BOOT_LINES.forEach((line, i) => {
      timers.push(window.setTimeout(() => setVisibleCount(i + 1), line.at))
    })
    const last = BOOT_LINES[BOOT_LINES.length - 1].at
    timers.push(window.setTimeout(() => setExiting(true), last + 360))
    timers.push(window.setTimeout(onComplete, last + 800))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [onComplete])

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[var(--mc-bg)]"
      style={{
        transition: 'opacity 380ms ease-out',
        opacity: exiting ? 0 : 1,
      }}
      aria-hidden="true"
    >
      {/* CRT sweep — power-on band travels top→down once */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] motion-reduce:hidden"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--mc-cyan), transparent)',
          boxShadow: '0 0 24px 4px var(--mc-cyan)',
          animation: 'mc-sweep 760ms ease-out forwards',
        }}
      />

      {/* Dense scan-line overlay, vignette mask */}
      <div
        className="pointer-events-none absolute inset-0 motion-reduce:hidden"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(0,229,255,0.08) 0, rgba(0,229,255,0.08) 1px, transparent 1px, transparent 3px)',
          maskImage:
            'radial-gradient(ellipse at center, black 30%, rgba(0,0,0,0.4) 75%, transparent 100%)',
          opacity: exiting ? 0 : 0.6,
          transition: 'opacity 380ms ease-out',
        }}
      />

      <div className="relative w-full max-w-2xl px-6">
        <div className="mb-4 flex items-center justify-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor: 'var(--mc-cyan)',
              boxShadow: '0 0 16px 2px var(--mc-cyan)',
              animation: 'mc-breathe 0.6s ease-in-out infinite',
            }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-[var(--mc-cyan)]">
            CONDUCTOR · BOOT
          </span>
        </div>
        <div className="rounded-lg border border-[var(--mc-border-bright)] bg-[var(--mc-surface)]/85 p-4 backdrop-blur-sm">
          <pre className="font-mono text-[12px] leading-relaxed">
            {BOOT_LINES.slice(0, visibleCount).map((line, i) => (
              <span
                key={i}
                style={{
                  color: `var(--mc-${line.color})`,
                  display: 'block',
                  opacity: 0,
                  animation: 'mc-line-in 260ms ease-out forwards',
                }}
              >
                {line.text}
              </span>
            ))}
            {visibleCount > 0 && visibleCount < BOOT_LINES.length && (
              <span
                className="ml-0.5 inline-block h-3 w-[7px]"
                style={{
                  backgroundColor: 'var(--mc-cyan)',
                  animation: 'mc-caret 1s steps(1) infinite',
                }}
              />
            )}
          </pre>
        </div>
      </div>
    </div>
  )
}

export function Conductor() {
  const gw = useConductorGateway()

  // Tick the elapsed counter once per second while a mission is live.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (gw.phase !== 'running' && gw.phase !== 'decomposing') return
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [gw.phase])

  // Boot sequence — fire once when phase transitions idle → decomposing.
  const [showBoot, setShowBoot] = useState(false)
  // Stable callback identity — without useCallback the inline arrow recreates
  // every parent render (e.g. the 1 s elapsed-time ticker), churning the
  // BootSequence effect's deps and risking restarts mid-sequence.
  const handleBootComplete = useCallback(() => setShowBoot(false), [])
  const prevPhase = useRef(gw.phase)
  useEffect(() => {
    if (prevPhase.current === 'idle' && gw.phase === 'decomposing') {
      setShowBoot(true)
    }
    prevPhase.current = gw.phase
  }, [gw.phase])

  const totalTokens = gw.workers.reduce(
    (sum, w) => sum + (w.totalTokens || 0),
    0,
  )
  const activeCount =
    gw.activeWorkers?.length ??
    gw.workers.filter((w) => w.status === 'running').length

  const handleLaunch = (goal: string) => {
    void gw.sendMission(goal)
  }

  return (
    <div
      style={MC_STYLE}
      className="relative h-full overflow-hidden bg-[var(--mc-bg)] text-[var(--mc-text)]"
    >
      <ScanlineBackdrop />

      {showBoot && <BootSequence onComplete={handleBootComplete} />}

      <style>{`
        @keyframes mc-shimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(420%); }
        }
        @keyframes mc-sweep {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(90vh); opacity: 0; }
        }
        @keyframes mc-line-in {
          0% { opacity: 0; transform: translateY(-4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes mc-event-in {
          0% { opacity: 0; transform: translateY(6px); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: translateY(0); }
        }
        /* Single data packet glides along an SVG path. The path it's drawn
           on has stroke-dasharray "3 1200" — one tiny visible dash with a
           huge gap — and we slide the dashoffset to translate that single
           dash from start to end. Looks like a comet, not a marquee. */
        @keyframes mc-packet {
          0%   { stroke-dashoffset:    0; opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 1; }
          100% { stroke-dashoffset: -1200; opacity: 0; }
        }
        @keyframes mc-caret {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes mc-flow {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -30; }
        }
        @keyframes mc-orbit-slow {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes mc-orbit-mid {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes mc-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(0.4deg); }
        }
        @keyframes mc-breathe {
          0%, 100% { opacity: 0.18; transform: scale(1); }
          50% { opacity: 0.34; transform: scale(1.06); }
        }
        @keyframes mc-grid-pan {
          0% { background-position: 0 0; }
          100% { background-position: 24px 24px; }
        }
        @keyframes mc-stamp {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes mc-rise {
          0%   { transform: translateY(0)    scale(1);   opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateY(-48px) scale(0.6); opacity: 0; }
        }
      `}</style>

      <MissionStatusBar
        phase={gw.phase}
        goal={gw.goal}
        elapsedMs={gw.missionElapsedMs}
        totalTokens={totalTokens}
        workerCount={gw.workers.length}
        activeCount={activeCount}
        onStop={() => void gw.stopMission?.()}
        onReset={() => gw.resetMission?.()}
        isStopping={false}
      />

      <div className="h-[calc(100%-57px)] overflow-y-auto">
        {gw.phase === 'idle' && (
          <MissionLauncher
            onLaunch={handleLaunch}
            isSending={gw.isSending}
            settings={gw.conductorSettings}
            setSettings={gw.setConductorSettings}
            history={gw.missionHistory ?? []}
          />
        )}

        {gw.phase === 'decomposing' && (
          <MissionPlanning
            planText={gw.planText}
            streamError={gw.streamError}
          />
        )}

        {gw.phase === 'running' && (
          <RunningHud
            workers={gw.workers}
            tasks={gw.tasks}
            maxParallel={gw.conductorSettings.maxParallel}
            streamEvents={(gw.streamEvents ?? []) as StreamEvent[]}
            streamText={gw.streamText}
            planText={gw.planText}
            streamError={gw.streamError}
          />
        )}

        {gw.phase === 'complete' && (
          <MissionSummary
            goal={gw.goal}
            elapsedMs={gw.missionElapsedMs}
            totalTokens={totalTokens}
            workers={gw.workers}
            streamText={gw.streamText}
            onReset={() => gw.resetMission?.()}
            onRetry={() => gw.retryMission?.()}
          />
        )}
      </div>
    </div>
  )
}
