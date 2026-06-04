/**
 * EngineFloorLive — the Octogent "reactor constellation" embedded in the
 * Conductor. A ground-up, revolutionary take on the engine floor that keeps the
 * Mission-Control identity (navy base, cyan accent, pulse-gradient, Liquid Glass
 * iOS-26 surfaces) but reinvents how agents look + operate live:
 *
 *   ┌─ Knowledge Graph (LightRAG) — luminous glass anchor, top
 *   │        ╲   tether (every agent ↔ KG)
 *   │   ◌  ◌   ◌      ← live agents: liquid-glass pucks orbiting the core,
 *   │  ◌   ⊙   ◌         each tethered to BOTH the orchestrator and the KG,
 *   │   ◌  ◌   ◌         drifting continuously; surge + spark on tool use.
 *   └─ ⊙ Octogent orchestrator — pulsing glass reactor core, center
 *      · rim service nodes (Supabase · Models · Postiz · LinkedIn · Intel)
 *        where agents "dock" (spark travels there) when they call that tool.
 *
 * Layering: an SVG plane (behind) carries the tethers, dash-flow and tool
 * sparks; an HTML plane (front) carries the glass nodes so they get REAL
 * backdrop-blur (SVG can't). Transparent background → floats on the HUD.
 * All motion honors prefers-reduced-motion.
 */
import {
  type CSSProperties,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useOctogentSnapshot, type Agent } from '@/hooks/use-octogent'
import {
  useGatewaySessions,
  useCronJobs,
  type GatewaySession,
  type CronJob,
} from '@/hooks/use-all-agents'
import {
  useOctogentEvents,
  type OctogentEvent,
} from '@/hooks/use-octogent-events'
import { useLightragStatus } from '@/hooks/use-lightrag-status'
import {
  useConductorGateway,
  type ConductorWorker,
} from '@/screens/gateway/hooks/use-conductor-gateway'
import { cn } from '@/lib/utils'
import { AgentTerminalDrawer } from './cockpit/agent-terminal-drawer'
import { KgQueryPopover } from './cockpit/kg-query-popover'
import { SpawnAtDepartmentDialog } from './cockpit/spawn-at-department-dialog'

// ── theme tokens (Liquid Glass + navy Mission Control) ───────────────────────
const CYAN = '#00E5FF'
const CYAN_SOFT = 'rgba(0, 229, 255, 0.12)'
const MAGENTA = '#FF4FD8'
const AMBER = '#FFB547'
const EMERALD = '#3DF5A1'
const ROSE = '#FF6B8B'
const TEXT = '#E6F1FF'
const DIM = '#8FA3BF'
const DIMMER = '#7A8FA8'

// Liquid-glass surface recipe (iOS-26 → web). Reused on every node.
function glass(accent: string, strong = false): CSSProperties {
  return {
    background: 'rgba(13, 19, 29, 0.55)',
    backdropFilter: 'blur(22px) saturate(180%)',
    WebkitBackdropFilter: 'blur(22px) saturate(180%)',
    border: `1px solid ${strong ? accent : 'rgba(255,255,255,0.12)'}`,
    boxShadow: `0 16px 50px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.30), inset 0 -2px 8px rgba(0,0,0,0.30)${strong ? `, 0 0 36px -6px ${accent}` : ''}`,
  }
}

// ── geometry (percent coordinates, 0..100) ──────────────────────────────────
const ORCH = { x: 50, y: 60 } // shared orchestrator core (layout anchor only)
const KG = { x: 50, y: 15 } // shared knowledge-graph anchor (read-affinity)
// Two distinct cluster hubs flanking the shared core. Each hub is JUST a label +
// orbit center — NOT a second orchestrator. Reactor (Octogent terminals, WS-live)
// orbits the left hub; Mission (Conductor workers, 3s poll) orbits the right hub.
// Both clusters tether back to the single central ORCH core; they never tether to
// each other (disjoint namespaces: Agent.id vs ConductorWorker.key).
const REACTOR_HUB = { x: 33, y: 60 }
const MISSION_HUB = { x: 67, y: 60 }
// Tighter rings than the old single-cluster layout so two hubs coexist.
const RING = [
  { rx: 17, ry: 16, per: 8 },
  { rx: 27, ry: 25, per: 12 },
]
const MAX_ORBIT = 20 // per-cluster cap so the canvas stays readable

type Svc = { id: string; label: string; glyph: string; x: number; y: number }
// Rim services agents dock at. KG is its own anchor (top), so it's not here.
const SERVICES: ReadonlyArray<Svc> = [
  { id: 'litellm', label: 'Models', glyph: 'LM', x: 10, y: 34 },
  { id: 'supabase', label: 'Supabase', glyph: 'SB', x: 90, y: 34 },
  { id: 'postiz', label: 'Postiz', glyph: 'PZ', x: 13, y: 86 },
  { id: 'linkedin', label: 'LinkedIn', glyph: 'LI', x: 87, y: 86 },
  { id: 'intel', label: 'Intel', glyph: 'IN', x: 50, y: 93 },
]

// Drop-target id for the KG anchor (it is not a SERVICES rim node).
const KG_DROP_ID = 'kg'

// service.id → real .octogent tentacle id. INTENTIONALLY EMPTY: the spawn
// contract (POST /octogent/api/terminals {tentacleId}) needs a verified
// tentacle id, and these have NOT been confirmed against the live
// .octogent/tentacles/<id> set (deferred-confirm in the spec). Until a mapping
// is verified, SpawnAtDepartmentDialog resolves undefined → renders an honest
// "tentacle not mapped — spawn unavailable" instead of POSTing a guessed id.
// Populate an entry ONLY after confirming the real tentacle id exists.
const SERVICE_TO_TENTACLE: Readonly<Record<string, string>> = {
  // e.g. supabase: '<verified-tentacle-id>',  // ← fill after confirming
}

function tentacleForDept(deptId: string): string | undefined {
  return SERVICE_TO_TENTACLE[deptId]
}

// Single definition of "KG I/O": a toolName matching this regex is a real read
// against the knowledge graph. Reused by BOTH the magenta tool-spark router and
// the per-agent KG read-tether so they can never diverge. Equals the task regex.
const KG_TOOL_RE = /lightrag|rag|memory|graph|query|recall|embed/i

// Per-agent KG frequency window + saturation cap (decay horizon mirrors the 8s
// activeTools untilTs and is swept by the existing 1s decay clock).
const KG_WINDOW_MS = 8_000
const KG_MAX_HITS = 6

// Pure intensity from a per-agent ring buffer of recent KG-hit timestamps.
// 0 when no fresh real event → the tether is absent (not merely faint).
function kgIntensity(hits: number[] | undefined, now: number): number {
  if (!hits || hits.length === 0) return 0
  const fresh = hits.filter((t) => now - t < KG_WINDOW_MS)
  if (fresh.length === 0) return 0
  // recency weights smooth decay; frequency (count in window) weights thickness
  const recency = 1 - (now - Math.max(...fresh)) / KG_WINDOW_MS // 1→0 over window
  const freq = Math.min(1, fresh.length / KG_MAX_HITS)
  return Math.max(0, Math.min(1, 0.4 * recency + 0.6 * freq))
}

// Where does a tool's spark fly? KG for memory/rag, else a rim service, else
// back to the orchestrator (reporting in).
function routeForTool(tool?: string): { x: number; y: number } {
  if (!tool) return ORCH
  const t = tool.toLowerCase()
  if (KG_TOOL_RE.test(t)) return KG
  if (/(supabase|postgres|sql)/.test(t)) return SERVICES[1]
  if (/(ollama|litellm|completion|model|llm)/.test(t)) return SERVICES[0]
  if (/(postiz|rss|feed|social)/.test(t)) return SERVICES[2]
  if (/(slack|linkedin|email|outreach)/.test(t)) return SERVICES[3]
  if (/(intel|scrape|apify|search|web)/.test(t)) return SERVICES[4]
  return ORCH
}

// Place puck i (of n) on a ring centered on `hub`. Generalized from the old
// ORCH-only version so each cluster can orbit its own hub.
function ringPos(
  i: number,
  n: number,
  hub: { x: number; y: number },
): { x: number; y: number } {
  let ring = 0
  let acc = 0
  while (ring < RING.length - 1 && i >= acc + RING[ring]!.per) {
    acc += RING[ring]!.per
    ring++
  }
  const slot = i - acc
  const here = Math.min(RING[ring]!.per, n - acc)
  const { rx, ry } = RING[ring]!
  // start at top, distribute evenly, offset alternate rings so they interleave
  const ang =
    (-90 + (360 / Math.max(1, here)) * slot + ring * 13) * (Math.PI / 180)
  return { x: hub.x + rx * Math.cos(ang), y: hub.y + ry * Math.sin(ang) }
}

type Puck = {
  key: string
  glyph: string
  label: string
  // 'octogent' | 'gateway' | 'cron' = Reactor cluster (Octogent /terminal-snapshots
  // + host gateway/cron, WS-live). 'mission' = Conductor worker (3s poll), a fully
  // separate namespace (ConductorWorker.key) — never merged with Reactor pucks.
  kind: 'octogent' | 'gateway' | 'cron' | 'mission'
  color: string
  alive: boolean
  tool?: string
  toolKey?: string // id used to look up activeTools (Reactor only; Mission never has one)
  sub?: string // optional secondary label (Mission: token-usage label)
}

export function EngineFloorLive() {
  const snap = useOctogentSnapshot()
  const gateway = useGatewaySessions()
  const cron = useCronJobs()
  const lightrag = useLightragStatus()
  // Conductor mission population (Mission cluster). Pure-read here — we only
  // consume workers/phase; the hook's own 3s poll (enabled only while a mission
  // is live) is the canonical mission poller and is dedup'd by TanStack's shared
  // query cache. This is a SECOND useConductorGateway instance (Conductor screen
  // has one); they don't share React state but share the query cache key, so no
  // extra network fetch beyond that one poll. See implementation note below.
  const conductor = useConductorGateway()
  const missionWorkers: ConductorWorker[] = conductor.workers
  const missionActive = conductor.phase !== 'idle'

  // ── cockpit interactivity state ────────────────────────────────────────────
  // Selected octogent terminal id → opens the live stream drawer. Only ever set
  // from kind:'octogent' pucks (the sole carriers of a real terminalId).
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(
    null,
  )
  const [kgOpen, setKgOpen] = useState(false)
  // Drag-drop spawn target: a department (SERVICES rim node or KG anchor) the
  // user dropped a puck onto → opens SpawnAtDepartmentDialog (spawn-here).
  const [spawnTarget, setSpawnTarget] = useState<{
    deptLabel: string
    tentacleId?: string
    draggedFromLabel?: string
  } | null>(null)
  // Label of the puck currently being dragged (context only — never teleported).
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null)

  // Core launch — reuses the Conductor SSOT sendMission (POST /api/conductor-spawn).
  const [launchPending, setLaunchPending] = useState(false)
  const launchMission = useCallback(async () => {
    if (launchPending) return
    const goal = window.prompt('Launch mission — describe the goal:')?.trim()
    if (!goal) return
    setLaunchPending(true)
    try {
      await conductor.sendMission(goal)
    } catch {
      // sendMission surfaces its own error state in Mission Control; the floor
      // stays read-only here.
    } finally {
      setLaunchPending(false)
    }
  }, [conductor, launchPending])

  const openDept = useCallback(
    (deptLabel: string, deptId: string) => {
      if (!draggingLabel) return
      setSpawnTarget({
        deptLabel,
        tentacleId: tentacleForDept(deptId),
        draggedFromLabel: draggingLabel,
      })
    },
    [draggingLabel],
  )

  const [activeTools, setActiveTools] = useState<
    Record<string, { tool?: string; runtimeState: string; untilTs: number }>
  >({})

  // Per-agent ring buffer of recent KG-hit epoch-ms (terminalId → timestamps).
  // Only real terminal-state-changed events whose toolName matches KG_TOOL_RE
  // ever land here, so a KG tether can only exist for an agent with real I/O.
  const [kgHits, setKgHits] = useState<Record<string, number[]>>({})

  const handleEvent = useCallback((event: OctogentEvent) => {
    if (event.type !== 'terminal-state-changed') return
    setActiveTools((prev) => ({
      ...prev,
      [event.terminalId]: {
        tool: event.toolName,
        runtimeState: event.agentRuntimeState,
        untilTs: Date.now() + 8_000,
      },
    }))
    // Count ONLY KG-matching toolName events toward the per-agent frequency.
    if (event.toolName && KG_TOOL_RE.test(event.toolName)) {
      const now = Date.now()
      setKgHits((prev) => {
        const arr = (prev[event.terminalId] ?? []).filter(
          (t) => now - t < KG_WINDOW_MS,
        )
        return { ...prev, [event.terminalId]: [...arr, now] }
      })
    }
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now()
      setActiveTools((prev) => {
        let changed = false
        const next: typeof prev = {}
        for (const [k, v] of Object.entries(prev)) {
          if (v.untilTs > now) next[k] = v
          else changed = true
        }
        return changed ? next : prev
      })
      // Same decay clock prunes the KG ring buffer: drop timestamps past the
      // window and delete empty entries → intensity falls to 0 ~8s after the
      // last real event, so the tether can never be always-on. The setState
      // also forces a re-render each tick so decay is visually smooth.
      setKgHits((prev) => {
        let changed = false
        const next: typeof prev = {}
        for (const [k, arr] of Object.entries(prev)) {
          const fresh = arr.filter((ts) => now - ts < KG_WINDOW_MS)
          if (fresh.length === arr.length) next[k] = arr
          else if (fresh.length > 0) {
            next[k] = fresh
            changed = true
          } else changed = true
        }
        return changed ? next : prev
      })
    }, 1_000)
    return () => window.clearInterval(t)
  }, [])

  const { connected } = useOctogentEvents({ onEvent: handleEvent })

  // Recomputed each render; the 1s sweeper guarantees ≥1Hz re-render so KG
  // intensity decays smoothly without an extra timer.
  const nowTick = Date.now()

  const agents: Agent[] = snap.agents.data ?? []
  const gatewaySessions: GatewaySession[] = gateway.data ?? []
  const cronJobs: CronJob[] = cron.data ?? []

  // ── REACTOR cluster (Octogent terminals + host gateway/cron) ───────────────
  // Sourced ONLY from /octogent/api/terminal-snapshots (+ host gateway/cron),
  // driven live by the terminal-events WS. These are the agents wired to the
  // orchestrator + KG; they keep their real WS tool sparks and KG read-tether.
  const reactorPucks: Puck[] = useMemo(() => {
    const out: Puck[] = []
    for (const a of agents) {
      out.push({
        key: `og-${a.id}`,
        glyph: (a.displayName || a.id).slice(0, 2).toUpperCase(),
        label: a.displayName || a.id,
        kind: 'octogent',
        color: CYAN,
        alive: a.lifecycleState === 'running',
        toolKey: a.id,
      })
    }
    for (const s of gatewaySessions) {
      out.push({
        key: `gw-${s.id}`,
        glyph: s.id.slice(0, 2).toUpperCase(),
        label: s.id,
        kind: 'gateway',
        color: EMERALD,
        alive: true,
      })
    }
    for (const j of cronJobs) {
      out.push({
        key: `cron-${j.id}`,
        glyph: (j.name || j.id).slice(0, 2).toUpperCase(),
        label: j.name || j.id,
        kind: 'cron',
        color: AMBER,
        alive: j.enabled !== false,
      })
    }
    return out
  }, [agents, gatewaySessions, cronJobs])

  // ── MISSION cluster (Conductor workers) ────────────────────────────────────
  // Sourced ONLY from useConductorGateway().workers (ConductorWorker.key, 3s
  // poll of POST-spawned sessions). Status-only state — NO toolKey, so it can
  // never get a tool spark OR a KG flash (the conductor poll exposes no per-tool
  // signal). Key prefix `mw-` keeps it disjoint from Reactor `og-/gw-/cron-`.
  const missionPucks: Puck[] = useMemo(() => {
    return missionWorkers.map((w) => {
      const status = w.status
      const color =
        status === 'running'
          ? EMERALD
          : status === 'idle'
            ? CYAN
            : status === 'stale'
              ? ROSE
              : DIM // 'complete'
      return {
        key: `mw-${w.key}`,
        glyph: (w.displayName || w.label).slice(0, 2).toUpperCase(),
        label: w.displayName || w.label,
        kind: 'mission' as const,
        color,
        alive: status === 'running' || status === 'idle',
        sub: w.tokenUsageLabel,
        // intentionally NO toolKey: Mission workers have no live tool signal.
      }
    })
  }, [missionWorkers])

  // Place each cluster on its own hub, independent caps + overflow.
  const reactorShown = reactorPucks.slice(0, MAX_ORBIT)
  const reactorOverflow = reactorPucks.length - reactorShown.length
  const reactorPlaced = reactorShown.map((p, i) => ({
    ...p,
    ...ringPos(i, reactorShown.length, REACTOR_HUB),
  }))

  const missionShown = missionPucks.slice(0, MAX_ORBIT)
  const missionOverflow = missionPucks.length - missionShown.length
  const missionPlaced = missionShown.map((p, i) => ({
    ...p,
    ...ringPos(i, missionShown.length, MISSION_HUB),
  }))

  // Separate live counts — provenance never collapsed into one number.
  const reactorLive = reactorShown.filter((p) => p.alive).length
  const missionLive = missionShown.filter((p) => p.alive).length

  // Selected terminal → resolve its label + lifecycle for the drawer. If the
  // agent vanished from the snapshot (killed/exited) we keep the drawer open
  // with the last-known id so Stop/Kill errors surface honestly.
  const selectedAgent: Agent | undefined = selectedTerminalId
    ? agents.find((a) => a.id === selectedTerminalId)
    : undefined

  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{ background: 'transparent', color: TEXT }}
    >
      <style>{`
        @keyframes ef-orbit { 0%,100%{transform:translate(-50%,-50%) translate(0,0)} 25%{transform:translate(-50%,-50%) translate(4px,-3px)} 50%{transform:translate(-50%,-50%) translate(-2px,-6px)} 75%{transform:translate(-50%,-50%) translate(-5px,-1px)} }
        @keyframes ef-breathe { 0%,100%{opacity:.55;transform:scale(1)} 50%{opacity:1;transform:scale(1.06)} }
        @keyframes ef-flow { to { stroke-dashoffset: -20; } }
        @media (prefers-reduced-motion: reduce){
          .ef-anim{animation:none!important}
        }
      `}</style>

      {/* header — two honest, per-cluster status pills (provenance + transport) */}
      <div className="flex shrink-0 items-center gap-3 px-6 pt-5">
        {/* REACTOR pill — Octogent terminals, WS-live transport */}
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
          style={glass(connected ? EMERALD : AMBER)}
          title={
            connected
              ? 'Octogent terminals · live over websocket (terminal-state-changed)'
              : 'Octogent event websocket disconnected'
          }
        >
          <span
            className={cn(
              'ef-anim inline-block size-2 rounded-full',
              connected && 'animate-pulse',
            )}
            style={{
              background: connected ? EMERALD : AMBER,
              boxShadow: connected ? `0 0 8px ${EMERALD}` : undefined,
            }}
          />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.28em]"
            style={{ color: DIMMER }}
          >
            REACTOR
          </span>
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: CYAN }}
          >
            {reactorLive} live
          </span>
          <span
            className="font-mono text-[8px] uppercase tracking-[0.16em]"
            style={{ color: DIMMER }}
          >
            {connected ? 'WS' : 'WS·off'}
          </span>
        </div>
        {/* MISSION pill — Conductor workers, 3s-poll transport */}
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
          style={glass(missionActive ? CYAN : DIM)}
          title={
            missionActive
              ? 'Conductor mission workers · 3s poll of spawned sessions'
              : 'No active Conductor mission (poll disabled while idle)'
          }
        >
          <span
            className={cn(
              'ef-anim inline-block size-2 rounded-full',
              missionActive && 'animate-pulse',
            )}
            style={{
              background: missionActive ? CYAN : DIMMER,
              boxShadow: missionActive ? `0 0 8px ${CYAN}` : undefined,
            }}
          />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.28em]"
            style={{ color: DIMMER }}
          >
            MISSION
          </span>
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: missionActive ? CYAN : DIMMER }}
          >
            {missionActive ? `${missionWorkers.length} active` : 'idle'}
          </span>
          <span
            className="font-mono text-[8px] uppercase tracking-[0.16em]"
            style={{ color: DIMMER }}
          >
            {missionActive ? '3s POLL' : '—'}
          </span>
        </div>
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
          style={glass(lightrag.healthy ? CYAN : ROSE)}
          title={
            lightrag.healthy
              ? 'Knowledge graph reachable'
              : 'LightRAG unavailable'
          }
        >
          <span
            className={cn(
              'ef-anim inline-block size-2 rounded-full',
              lightrag.healthy && 'animate-pulse',
            )}
            style={{
              background: lightrag.healthy ? CYAN : ROSE,
              boxShadow: lightrag.healthy ? `0 0 8px ${CYAN}` : undefined,
            }}
          />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: lightrag.healthy ? CYAN : ROSE }}
          >
            {lightrag.healthy ? 'KG wired' : 'KG down'}
          </span>
        </div>
        {snap.isError && (
          <span
            className="ml-auto font-mono text-[10px] uppercase tracking-wider"
            style={{ color: ROSE }}
          >
            octogent unreachable
          </span>
        )}
      </div>

      {/* stage */}
      <div className="relative min-h-0 flex-1">
        {/* ambient core glow */}
        <div
          className="ef-anim pointer-events-none absolute"
          style={{
            left: `${ORCH.x}%`,
            top: `${ORCH.y}%`,
            width: 420,
            height: 420,
            transform: 'translate(-50%,-50%)',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${CYAN_SOFT}, transparent 62%)`,
            filter: 'blur(34px)',
            animation: 'ef-breathe 6s ease-in-out infinite',
          }}
        />

        {/* SVG plane — tethers + flow + tool sparks (behind glass nodes) */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {/* REACTOR tethers — to ORCH core + (real) KG read-tether + tool sparks */}
          {reactorPlaced.map((p) => {
            const tool = p.toolKey ? activeTools[p.toolKey] : undefined
            const target = tool ? routeForTool(tool.tool) : null
            // Per-agent KG read-tether intensity — pure function of observed
            // KG-tool events. Gateway/cron pucks have no toolKey → always 0.
            const kg = kgIntensity(
              p.toolKey ? kgHits[p.toolKey] : undefined,
              nowTick,
            )
            return (
              <g key={`t-${p.key}`}>
                {/* tether → orchestrator */}
                <line
                  x1={p.x}
                  y1={p.y}
                  x2={ORCH.x}
                  y2={ORCH.y}
                  stroke={CYAN}
                  strokeOpacity={p.alive ? 0.4 : 0.16}
                  strokeWidth={0.18}
                  strokeDasharray="0.6 1.6"
                  className="ef-anim"
                  style={{
                    animation: p.alive
                      ? 'ef-flow 2.6s linear infinite'
                      : undefined,
                  }}
                />
                {/* KG read-tether — exists ONLY while a real KG-tool event
                    lives for this agent (kg > 0). Thickness = frequency,
                    opacity = recency, flow speed = busyness. Absent (not
                    rendered) when no recent real I/O → never always-on. */}
                {kg > 0 && (
                  <line
                    x1={p.x}
                    y1={p.y}
                    x2={KG.x}
                    y2={KG.y}
                    stroke={'#7DF3FF'}
                    strokeOpacity={0.12 + 0.68 * kg}
                    strokeWidth={0.14 + 0.5 * kg}
                    strokeDasharray="0.4 2.2"
                    className="ef-anim"
                    style={{
                      animation: `ef-flow ${(3.4 - 2.0 * kg).toFixed(2)}s linear infinite`,
                    }}
                  />
                )}
                {/* tool spark: agent surges to the service it's working with */}
                {target && (
                  <>
                    <line
                      x1={p.x}
                      y1={p.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={MAGENTA}
                      strokeOpacity={0.5}
                      strokeWidth={0.3}
                      strokeDasharray="0.5 1.2"
                    />
                    <circle r={0.9} fill={MAGENTA} className="ef-anim">
                      <animateMotion
                        dur="1.4s"
                        repeatCount="indefinite"
                        path={`M ${p.x} ${p.y} L ${target.x} ${target.y}`}
                      />
                    </circle>
                  </>
                )}
              </g>
            )
          })}
          {/* MISSION tethers — ONE link to the shared ORCH core, styled distinctly
              (emerald, dashed). NO KG tether and NO tool spark: the Conductor poll
              exposes no per-tool or per-KG signal, so anything more would be fake.
              Tether to core only — never to a Reactor puck (disjoint namespaces). */}
          {missionPlaced.map((p) => (
            <line
              key={`mt-${p.key}`}
              x1={p.x}
              y1={p.y}
              x2={ORCH.x}
              y2={ORCH.y}
              stroke={EMERALD}
              strokeOpacity={p.alive ? 0.3 : 0.12}
              strokeWidth={0.16}
              strokeDasharray="0.9 1.4"
              className="ef-anim"
              style={{
                animation: p.alive ? 'ef-flow 3.0s linear infinite' : undefined,
              }}
            />
          ))}
        </svg>

        {/* HTML plane — liquid-glass nodes (real backdrop-blur) */}
        {/* rim services — also drag-drop targets to spawn a NEW agent there */}
        {SERVICES.map((s) => (
          <NodeChip
            key={s.id}
            x={s.x}
            y={s.y}
            glyph={s.glyph}
            label={s.label}
            accent={draggingLabel ? CYAN : DIM}
            small
            droppable={Boolean(draggingLabel)}
            onDropHere={() => openDept(s.label, s.id)}
          />
        ))}

        {/* knowledge graph anchor — click to open the read-only query box;
            also a drag-drop target to spawn a new agent affined to the KG. */}
        <div
          className="absolute flex flex-col items-center"
          style={{
            left: `${KG.x}%`,
            top: `${KG.y}%`,
            transform: 'translate(-50%,-50%)',
          }}
          onDragOver={(e) => {
            if (draggingLabel) e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            openDept('Knowledge Graph', KG_DROP_ID)
          }}
        >
          <button
            type="button"
            onClick={() => setKgOpen((v) => !v)}
            aria-label="Open knowledge graph query"
            aria-expanded={kgOpen}
            className="flex cursor-pointer items-center justify-center rounded-2xl transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
            style={{ width: 76, height: 76, ...glass(CYAN, true) }}
          >
            <span
              className="font-mono text-lg font-bold"
              style={{ color: CYAN }}
            >
              KG
            </span>
          </button>
          <div className="mt-2 text-center">
            <div
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: CYAN }}
            >
              Knowledge Graph
            </div>
            <div
              className="font-mono text-[9px] uppercase tracking-wider"
              style={{ color: DIMMER }}
            >
              {lightrag.healthy ? 'LightRAG · live' : 'LightRAG · offline'}
            </div>
          </div>
        </div>

        {/* orchestrator reactor core */}
        <div
          className="absolute flex flex-col items-center"
          style={{
            left: `${ORCH.x}%`,
            top: `${ORCH.y}%`,
            transform: 'translate(-50%,-50%)',
          }}
        >
          <div className="relative flex items-center justify-center">
            <div
              className="ef-anim pointer-events-none absolute rounded-full"
              style={{
                inset: -16,
                border: `1px solid ${MAGENTA}`,
                opacity: 0.5,
                animation: 'ef-breathe 4.4s ease-in-out infinite',
              }}
            />
            <button
              type="button"
              onClick={() => void launchMission()}
              disabled={launchPending}
              aria-label="Launch mission"
              title="Launch mission — spawns a Conductor orchestrator"
              className={cn(
                'flex items-center justify-center rounded-3xl transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4FD8]',
                launchPending
                  ? 'cursor-not-allowed opacity-70'
                  : 'cursor-pointer',
              )}
              style={{ width: 104, height: 104, ...glass(MAGENTA, true) }}
            >
              <span
                className="font-mono text-xl font-bold"
                style={{ color: '#FFC6F2' }}
              >
                {launchPending ? '···' : 'OG'}
              </span>
            </button>
          </div>
          <div className="mt-2 text-center">
            <div
              className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: '#FFC6F2' }}
            >
              Octogent
            </div>
            <div
              className="font-mono text-[9px] uppercase tracking-wider"
              style={{ color: DIMMER }}
            >
              {launchPending
                ? 'launching mission…'
                : `shared core · ${reactorLive} reactor · ${missionLive} mission`}
            </div>
            <div
              className="font-mono text-[8px] uppercase tracking-wider"
              style={{ color: DIMMER }}
            >
              click to launch mission
            </div>
          </div>
        </div>

        {/* cluster hub labels — each hub is a label + orbit center, NOT a second
            orchestrator. Counts are kept separate so provenance is never hidden. */}
        <ClusterHubLabel
          x={REACTOR_HUB.x}
          title="Reactor Terminals"
          accent={CYAN}
          line={
            connected
              ? `${reactorLive} live · WS`
              : `${reactorLive} live · WS·off`
          }
        />
        <ClusterHubLabel
          x={MISSION_HUB.x}
          title="Mission Workers"
          accent={missionActive ? EMERALD : DIM}
          line={
            missionActive
              ? `${missionWorkers.length} active · 3s poll`
              : 'no active mission'
          }
        />

        {/* orbiting agent pucks — REACTOR cluster (Octogent + host gateway/cron).
            ONLY kind:'octogent' pucks are interactive: click → live stream drawer,
            drag → spawn-a-new-agent-here. gateway/cron pucks have no octogent
            terminalId so they expose no stream/stop/kill affordance. */}
        {reactorPlaced.map((p, i) => {
          const tool = p.toolKey ? activeTools[p.toolKey] : undefined
          const kg = kgIntensity(
            p.toolKey ? kgHits[p.toolKey] : undefined,
            nowTick,
          )
          const interactive = p.kind === 'octogent' && Boolean(p.toolKey)
          const openDrawer = () => {
            if (interactive && p.toolKey) setSelectedTerminalId(p.toolKey)
          }
          return (
            <div
              key={p.key}
              className={cn(
                'ef-anim absolute flex flex-col items-center',
                interactive && 'cursor-pointer',
              )}
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                transform: 'translate(-50%,-50%)',
                animation: p.alive
                  ? `ef-orbit ${11 + (i % 6)}s ease-in-out infinite`
                  : undefined,
                animationDelay: `${(i % 7) * 0.4}s`,
              }}
              title={
                interactive
                  ? `${p.label} · ${p.kind}${tool?.tool ? ` · ${tool.tool}` : p.alive ? ' · live' : ' · idle'} · click to open · drag to spawn here`
                  : `${p.label} · ${p.kind}${tool?.tool ? ` · ${tool.tool}` : p.alive ? ' · live' : ' · idle'}`
              }
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `Open terminal ${p.label}` : undefined}
              draggable={interactive}
              onDragStart={() => {
                if (interactive) setDraggingLabel(p.label)
              }}
              onDragEnd={() => setDraggingLabel(null)}
              onClick={interactive ? openDrawer : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openDrawer()
                      }
                    }
                  : undefined
              }
            >
              <div
                className="relative flex items-center justify-center rounded-2xl"
                style={{
                  width: 38,
                  height: 38,
                  ...glass(p.color, p.alive),
                  opacity: p.alive ? 1 : 0.6,
                }}
              >
                {tool && (
                  <span
                    className="ef-anim pointer-events-none absolute rounded-2xl"
                    style={{
                      inset: -5,
                      border: `1px solid ${p.color}`,
                      animation: 'ef-breathe 1.6s ease-in-out infinite',
                    }}
                  />
                )}
                {/* "reading KG now" affordance — gated 1:1 on real KG I/O */}
                {kg > 0 && (
                  <span
                    className="ef-anim pointer-events-none absolute rounded-2xl"
                    style={{
                      inset: -8,
                      border: `1px solid #7DF3FF`,
                      opacity: 0.2 + 0.6 * kg,
                      animation: 'ef-breathe 1.6s ease-in-out infinite',
                    }}
                  />
                )}
                <span
                  className="font-mono text-[11px] font-semibold"
                  style={{ color: p.alive ? TEXT : DIMMER }}
                >
                  {p.glyph}
                </span>
              </div>
              <div
                className="mt-1 max-w-[88px] truncate text-center font-mono text-[9px]"
                style={{ color: DIM }}
              >
                {p.label}
              </div>
              {tool?.tool && (
                <div
                  className="font-mono text-[8px] uppercase tracking-wider"
                  style={{ color: p.color }}
                >
                  ▸{' '}
                  {tool.tool.length > 14
                    ? `${tool.tool.slice(0, 12)}…`
                    : tool.tool}
                </div>
              )}
            </div>
          )
        })}

        {/* orbiting agent pucks — MISSION cluster (Conductor workers, 3s poll).
            Status-only state: NO tool spark, NO KG flash, NO per-tool label
            (the conductor poll exposes no live tool signal). */}
        {missionPlaced.map((p, i) => (
          <div
            key={p.key}
            className="ef-anim absolute flex flex-col items-center"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              transform: 'translate(-50%,-50%)',
              animation: p.alive
                ? `ef-orbit ${11 + (i % 6)}s ease-in-out infinite`
                : undefined,
              animationDelay: `${(i % 7) * 0.4}s`,
            }}
            title={`${p.label} · mission worker · ${p.alive ? 'active' : 'done/stale'}${p.sub ? ` · ${p.sub}` : ''}`}
          >
            <div
              className="relative flex items-center justify-center rounded-2xl"
              style={{
                width: 38,
                height: 38,
                ...glass(p.color, p.alive),
                opacity: p.alive ? 1 : 0.6,
              }}
            >
              <span
                className="font-mono text-[11px] font-semibold"
                style={{ color: p.alive ? TEXT : DIMMER }}
              >
                {p.glyph}
              </span>
            </div>
            <div
              className="mt-1 max-w-[88px] truncate text-center font-mono text-[9px]"
              style={{ color: DIM }}
            >
              {p.label}
            </div>
            {p.sub && (
              <div
                className="font-mono text-[8px] uppercase tracking-wider"
                style={{ color: DIMMER }}
              >
                {p.sub}
              </div>
            )}
          </div>
        ))}

        {/* empty + overflow states — per cluster, never collapsed */}
        {reactorPlaced.length === 0 && (
          <div
            className="absolute left-[33%] top-[88%] -translate-x-1/2 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ ...glass(CYAN), color: DIMMER }}
            aria-live="polite"
          >
            <span style={{ color: CYAN }}>$</span>&nbsp;no reactor terminals
          </div>
        )}
        {/* Mission empty states are truthful about WHY: idle (poll disabled) vs
            decomposing (mission live, workers not spawned yet) vs none. Never
            seeds demo pucks. */}
        {missionPlaced.length === 0 && (
          <div
            className="absolute left-[67%] top-[88%] -translate-x-1/2 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ ...glass(missionActive ? EMERALD : DIM), color: DIMMER }}
            aria-live="polite"
          >
            {missionActive ? (
              <>
                <span style={{ color: EMERALD }}>·</span>&nbsp;mission
                decomposing…
              </>
            ) : (
              <>
                <span style={{ color: DIMMER }}>·</span>&nbsp;no active mission
              </>
            )}
          </div>
        )}
        {reactorOverflow > 0 && (
          <div
            className="absolute left-3 bottom-3 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ ...glass(CYAN), color: DIM }}
          >
            +{reactorOverflow} reactor in orbit
          </div>
        )}
        {missionOverflow > 0 && (
          <div
            className="absolute right-3 bottom-3 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ ...glass(EMERALD), color: DIM }}
          >
            +{missionOverflow} mission in orbit
          </div>
        )}

        {/* ── cockpit overlays ────────────────────────────────────────────── */}
        {/* KG read-only query box */}
        {kgOpen && <KgQueryPopover onClose={() => setKgOpen(false)} />}

        {/* per-terminal live stream + steer/stop/kill drawer (octogent only) */}
        {selectedTerminalId && (
          <AgentTerminalDrawer
            terminalId={selectedTerminalId}
            label={selectedAgent?.displayName || selectedTerminalId}
            lifecycleState={selectedAgent?.lifecycleState}
            onClose={() => setSelectedTerminalId(null)}
          />
        )}

        {/* spawn-a-new-agent-here dialog (opened by drag-drop onto a dept) */}
        {spawnTarget && (
          <SpawnAtDepartmentDialog
            deptLabel={spawnTarget.deptLabel}
            tentacleId={spawnTarget.tentacleId}
            draggedFromLabel={spawnTarget.draggedFromLabel}
            onClose={() => setSpawnTarget(null)}
          />
        )}
      </div>
    </div>
  )
}

// Cluster hub label — a small honest caption pinned above the hub's orbit
// center. NOT a node/orchestrator; purely a provenance + transport label.
function ClusterHubLabel({
  x,
  title,
  line,
  accent,
}: {
  x: number
  title: string
  line: string
  accent: string
}) {
  return (
    <div
      className="pointer-events-none absolute flex flex-col items-center text-center"
      style={{
        left: `${x}%`,
        top: `${MISSION_HUB.y - 30}%`,
        transform: 'translate(-50%,-50%)',
      }}
    >
      <div
        className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: accent }}
      >
        {title}
      </div>
      <div
        className="font-mono text-[9px] uppercase tracking-wider"
        style={{ color: DIMMER }}
      >
        {line}
      </div>
    </div>
  )
}

// Small liquid-glass rim node (service the agents dock at). When `droppable`
// (a puck is being dragged), it accepts a drop to open the spawn-here dialog.
function NodeChip({
  x,
  y,
  glyph,
  label,
  accent,
  small,
  droppable,
  onDropHere,
}: {
  x: number
  y: number
  glyph: string
  label: string
  accent: string
  small?: boolean
  droppable?: boolean
  onDropHere?: () => void
}) {
  const s = small ? 44 : 60
  return (
    <div
      className="absolute flex flex-col items-center"
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}
      onDragOver={(e: DragEvent) => {
        if (droppable) e.preventDefault()
      }}
      onDrop={(e: DragEvent) => {
        if (!droppable) return
        e.preventDefault()
        onDropHere?.()
      }}
    >
      <div
        className="flex items-center justify-center rounded-xl"
        style={{
          width: s,
          height: s,
          ...glass(accent, droppable),
        }}
      >
        <span
          className="font-mono text-[10px] font-semibold"
          style={{ color: TEXT }}
        >
          {glyph}
        </span>
      </div>
      <div
        className="mt-1 font-mono text-[9px] uppercase tracking-wider"
        style={{ color: droppable ? accent : DIMMER }}
      >
        {droppable ? 'spawn here' : label}
      </div>
    </div>
  )
}
