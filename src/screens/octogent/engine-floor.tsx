/**
 * EngineFloor — single live canvas where every agent on the platform lives at
 * its actual service node. Replaces the faded EngineBackplate + separate
 * OrbitHelpers with one unified surface so you can see WHO is working WHERE
 * and watch data flow between them in real time.
 *
 * Concept: five horizontal "glass tracks", each a transparent tube that data
 * packets stream through (no SVG cables — just flowing dots inside glass).
 * Services are anchored on each track; live agents perch beside their home
 * service. When the WS fires a terminal-state-changed event with a tool
 * name, a colored spark is dispatched along the relevant track so you can
 * physically see the agent doing work.
 *
 * Tracks (top -> bottom):
 *   1. Edge          — Cloudflared → PulseOS → Auth Gate
 *   2. Orchestrator  — Cron · Octogent · Gateway · Event Bus · Voice
 *   3. Memory        — LiteLLM · Ollama · LightRAG · Supabase · TTS
 *   4. Workers       — Intel · RSS · Postiz · LinkedIn · Health
 *   5. Bench         — 12 helper personas the Conductor can dispatch
 *
 * Theme tokens (--theme-*) match the rest of /octogent. Agents are 10-12px
 * badges (smaller than the cards below) so every agent fits without sacrificing
 * the hero canvas. The SVG is full-width fluid.
 */
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { motion, useTime, useTransform } from 'motion/react'
import {
  HELPER_PERSONAS,
  type CronJob,
  type GatewaySession,
} from '@/hooks/use-all-agents'
import type { Agent } from '@/hooks/use-octogent'
import type { OctogentEvent } from '@/hooks/use-octogent-events'

// ── Coordinate system ───────────────────────────────────────────────────────
const W = 1200
const H = 780
const TRACK_PAD_X = 60

// ── Track + service definitions ─────────────────────────────────────────────

type Tone = 'edge' | 'core' | 'voice' | 'data' | 'worker' | 'bench'

type ServiceNode = {
  id: string
  label: string
  glyph: string
  /** Position on its track, 0..1 from left. */
  t: number
  tone: Tone
}

type Track = {
  id: 'edge' | 'orchestrator' | 'memory' | 'workers' | 'bench'
  label: string
  y: number
  tone: Tone
  nodes: Array<ServiceNode>
}

const TRACKS: Array<Track> = [
  {
    id: 'edge',
    label: 'Edge',
    y: 80,
    tone: 'edge',
    nodes: [
      {
        id: 'tunnel',
        label: 'Cloudflared',
        glyph: 'CF',
        t: 0.12,
        tone: 'edge',
      },
      { id: 'pulseos', label: 'PulseOS', glyph: 'OS', t: 0.5, tone: 'core' },
      { id: 'auth', label: 'Auth Gate', glyph: 'AU', t: 0.88, tone: 'core' },
    ],
  },
  {
    id: 'orchestrator',
    label: 'Orchestrator',
    y: 220,
    tone: 'core',
    nodes: [
      { id: 'cron', label: 'Cron', glyph: 'CR', t: 0.1, tone: 'worker' },
      { id: 'octogent', label: 'Octogent', glyph: 'OG', t: 0.32, tone: 'core' },
      { id: 'gateway', label: 'Gateway', glyph: 'GW', t: 0.56, tone: 'core' },
      { id: 'sse', label: 'Event Bus', glyph: 'EB', t: 0.74, tone: 'core' },
      { id: 'voice', label: 'Voice', glyph: 'VC', t: 0.92, tone: 'voice' },
    ],
  },
  {
    id: 'memory',
    label: 'Memory + Models',
    y: 360,
    tone: 'data',
    nodes: [
      { id: 'litellm', label: 'LiteLLM', glyph: 'LL', t: 0.1, tone: 'data' },
      { id: 'ollama', label: 'Ollama', glyph: 'OL', t: 0.3, tone: 'data' },
      { id: 'lightrag', label: 'LightRAG', glyph: 'KG', t: 0.5, tone: 'data' },
      { id: 'supabase', label: 'Supabase', glyph: 'SB', t: 0.72, tone: 'data' },
      { id: 'tts', label: 'TTS', glyph: 'TT', t: 0.92, tone: 'voice' },
    ],
  },
  {
    id: 'workers',
    label: 'Workers',
    y: 500,
    tone: 'worker',
    nodes: [
      { id: 'intel', label: 'Intel', glyph: 'IN', t: 0.12, tone: 'worker' },
      { id: 'rss', label: 'RSS', glyph: 'RS', t: 0.3, tone: 'worker' },
      { id: 'postiz', label: 'Postiz', glyph: 'PZ', t: 0.48, tone: 'worker' },
      {
        id: 'linkedin',
        label: 'LinkedIn',
        glyph: 'LI',
        t: 0.66,
        tone: 'worker',
      },
      { id: 'health', label: 'Health', glyph: 'HW', t: 0.84, tone: 'worker' },
    ],
  },
  {
    id: 'bench',
    label: 'Helper Bench',
    y: 640,
    tone: 'bench',
    nodes: [],
  },
]

const TONE_COLOR: Record<Tone, string> = {
  edge: 'var(--theme-muted-2)',
  core: 'var(--theme-accent)',
  voice: 'var(--theme-warning)',
  data: 'var(--theme-success)',
  worker: 'var(--theme-warning)',
  bench: 'var(--theme-accent-strong)',
}

function nodeX(track: Track, t: number): number {
  return TRACK_PAD_X + t * (W - TRACK_PAD_X * 2)
}

function findNode(nodeId: string): { track: Track; node: ServiceNode } | null {
  for (const track of TRACKS) {
    const node = track.nodes.find((n) => n.id === nodeId)
    if (node) return { track, node }
  }
  return null
}

// Map an MCP/tool name to the service node it conceptually targets. Used to
// route event-driven sparks to the right destination on the canvas.
function routeForTool(toolName?: string): string {
  if (!toolName) return 'octogent'
  const t = toolName.toLowerCase()
  if (t.includes('supabase') || t.includes('postgres')) return 'supabase'
  if (t.includes('lightrag') || t.includes('rag') || t.includes('memory'))
    return 'lightrag'
  if (t.includes('ollama') || t.includes('litellm') || t.includes('completion'))
    return 'litellm'
  if (t.includes('tts') || t.includes('voice') || t.includes('hume'))
    return 'tts'
  if (t.includes('slack') || t.includes('linkedin')) return 'linkedin'
  if (t.includes('rss') || t.includes('postiz') || t.includes('feed'))
    return 'postiz'
  if (t.includes('github') || t.includes('gh ')) return 'pulseos'
  if (t.includes('intel')) return 'intel'
  if (t.includes('cron') || t.includes('schedule')) return 'cron'
  return 'octogent'
}

type Spark = {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  toNodeId: string
  color: string
  label?: string
  bornAt: number
}

const SPARK_TTL_MS = 2400

function TrackTube({ track }: { track: Track }) {
  const x1 = TRACK_PAD_X
  const x2 = W - TRACK_PAD_X
  const r = 22
  const tubeY = track.y
  const tone = TONE_COLOR[track.tone]
  return (
    <g>
      <rect
        x={x1}
        y={tubeY - r}
        width={x2 - x1}
        height={r * 2}
        rx={r}
        ry={r}
        fill="var(--theme-card)"
        fillOpacity={0.45}
        stroke={tone}
        strokeOpacity={0.35}
        strokeWidth={1}
      />
      <rect
        x={x1 + 2}
        y={tubeY - r + 2}
        width={x2 - x1 - 4}
        height={r * 2 - 4}
        rx={r - 2}
        ry={r - 2}
        fill="none"
        stroke={tone}
        strokeOpacity={0.12}
        strokeWidth={2}
      />
      <text
        x={x1 + 8}
        y={tubeY - r - 6}
        fontSize={9}
        fill="var(--theme-muted-2)"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        {track.label}
      </text>
      <defs>
        <path
          id={`track-path-${track.id}`}
          d={`M ${x1 + r} ${tubeY} H ${x2 - r}`}
        />
      </defs>
      {[0, 1, 2, 3].map((i) => (
        <circle key={`pkt-${i}`} r={2.5} fill={tone} opacity={0.85}>
          <animateMotion
            dur={`${6 + i * 0.7}s`}
            begin={`${-i * 1.6}s`}
            repeatCount="indefinite"
          >
            <mpath href={`#track-path-${track.id}`} />
          </animateMotion>
        </circle>
      ))}
    </g>
  )
}

function ServiceNodeDot({
  track,
  node,
  hit,
}: {
  track: Track
  node: ServiceNode
  hit: boolean
}) {
  const x = nodeX(track, node.t)
  const y = track.y
  const color = TONE_COLOR[node.tone]
  return (
    <g transform={`translate(${x} ${y})`}>
      {hit && (
        <motion.circle
          r={14}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          initial={{ scale: 1, opacity: 0.65 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
        />
      )}
      <circle
        r={14}
        fill="var(--theme-card)"
        stroke={color}
        strokeWidth={1.5}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fontWeight={600}
        fill="var(--theme-text)"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          letterSpacing: '0.04em',
        }}
      >
        {node.glyph}
      </text>
      <text
        x={0}
        y={32}
        textAnchor="middle"
        fontSize={9}
        fill="var(--theme-muted)"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {node.label}
      </text>
    </g>
  )
}

function AgentBadge({
  cx,
  cy,
  glyph,
  color,
  alive,
  bobPhase,
  title,
  hot,
}: {
  cx: number
  cy: number
  glyph: string
  color: string
  alive: boolean
  bobPhase: number
  title: string
  hot?: boolean
}) {
  const time = useTime()
  const bob = useTransform(time, (t) =>
    alive ? Math.sin(t / 800 + bobPhase) * 1.8 : 0,
  )
  return (
    <motion.g style={{ y: bob }} transform={`translate(${cx} ${cy})`}>
      <title>{title}</title>
      {hot && (
        <motion.circle
          r={9}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 1.6, ease: 'easeOut' }}
        />
      )}
      <circle
        r={9}
        fill="var(--theme-card)"
        stroke={color}
        strokeWidth={alive ? 1.4 : 1}
        opacity={alive ? 1 : 0.55}
      />
      {alive && (
        <circle
          r={9}
          fill="none"
          stroke={color}
          strokeWidth={0.8}
          opacity={0.4}
        />
      )}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={7}
        fontWeight={600}
        fill={alive ? 'var(--theme-text)' : 'var(--theme-muted-2)'}
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          pointerEvents: 'none',
        }}
      >
        {glyph}
      </text>
    </motion.g>
  )
}

// Half-arc fan-out above (and to the sides of) a service node so badges never
// overlap. Returns absolute SVG coordinates.
function fanOutPos(
  nodeAbsX: number,
  nodeAbsY: number,
  index: number,
): { x: number; y: number } {
  const ring = Math.floor(index / 6)
  const slot = index % 6
  const arcAngles = [
    -Math.PI / 2,
    -Math.PI / 3,
    (-2 * Math.PI) / 3,
    -Math.PI / 4,
    (-3 * Math.PI) / 4,
    -Math.PI / 2.2,
  ]
  const angle = arcAngles[slot] ?? -Math.PI / 2
  const radius = 26 + ring * 22
  return {
    x: nodeAbsX + Math.cos(angle) * radius,
    y: nodeAbsY + Math.sin(angle) * radius,
  }
}

export type EngineFloorProps = {
  octogentAgents: ReadonlyArray<Agent>
  gatewaySessions: ReadonlyArray<GatewaySession>
  cronJobs: ReadonlyArray<CronJob>
  activeTools: Record<
    string,
    { tool?: string; runtimeState: string; untilTs: number }
  >
  /** Latest event to drive a spark when state-changed fires. */
  latestEvent?: OctogentEvent | null
  className?: string
  /** When true, drop the glass card chrome (bg/border/blur/shadow) so the
   *  engine floats on whatever surface hosts it — used when embedded in the
   *  Conductor's dark HUD. The tracks, nodes, agents and sparks still render. */
  transparent?: boolean
}

export function EngineFloor({
  octogentAgents,
  gatewaySessions,
  cronJobs,
  activeTools,
  latestEvent,
  className,
  transparent = false,
}: EngineFloorProps) {
  const [sparks, setSparks] = useState<Array<Spark>>([])
  const sparkIdRef = useRef(0)
  const lastEventRef = useRef<OctogentEvent | null>(null)

  const dispatchSpark = useCallback(
    (fromId: string, toId: string, color: string, label?: string) => {
      const from = findNode(fromId)
      const to = findNode(toId)
      if (!from || !to) return
      const id = `sp-${++sparkIdRef.current}-${Date.now()}`
      const fromX = nodeX(from.track, from.node.t)
      const fromY = from.track.y
      const toX = nodeX(to.track, to.node.t)
      const toY = to.track.y
      setSparks((prev) => [
        ...prev,
        {
          id,
          fromX,
          fromY,
          toX,
          toY,
          toNodeId: toId,
          color,
          label,
          bornAt: Date.now(),
        },
      ])
    },
    [],
  )

  useEffect(() => {
    if (!latestEvent || latestEvent === lastEventRef.current) return
    lastEventRef.current = latestEvent
    if (latestEvent.type !== 'terminal-state-changed') return
    const color = TONE_COLOR.core
    const target = routeForTool(latestEvent.toolName)
    dispatchSpark('octogent', target, color, latestEvent.toolName)
  }, [latestEvent, dispatchSpark])

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now()
      setSparks((prev) => prev.filter((s) => now - s.bornAt < SPARK_TTL_MS))
    }, 400)
    return () => window.clearInterval(id)
  }, [])

  const recentHitIds = useMemo(() => {
    const set = new Set<string>()
    for (const s of sparks) set.add(s.toNodeId)
    return set
  }, [sparks])

  type Badge = {
    key: string
    x: number
    y: number
    glyph: string
    color: string
    alive: boolean
    title: string
    hot: boolean
    /** Draw the orchestrator + knowledge-graph tethers for this badge. True for
     *  real agents (octogent/gateway/cron); false for the dormant helper bench
     *  so the canvas doesn't drown in lines. */
    link?: boolean
  }

  const badges: Array<Badge> = useMemo(() => {
    const buckets: Record<string, Array<Badge>> = {}

    function pushTo(homeId: string, badge: Omit<Badge, 'x' | 'y'>) {
      const home = findNode(homeId) ?? findNode('octogent')!
      const baseX = nodeX(home.track, home.node.t)
      const baseY = home.track.y
      const list = buckets[homeId] || (buckets[homeId] = [])
      const pos = fanOutPos(baseX, baseY, list.length)
      list.push({ ...badge, x: pos.x, y: pos.y })
    }

    for (const a of octogentAgents) {
      const alive = a.lifecycleState === 'running'
      const tool = activeTools[a.id]
      pushTo('octogent', {
        key: `og-${a.id}`,
        glyph: (a.displayName || a.id).slice(0, 2).toUpperCase(),
        color: TONE_COLOR.core,
        alive,
        title: `${a.displayName || a.id} · ${a.lifecycleState ?? 'idle'}${tool?.tool ? ` · ${tool.tool}` : ''}`,
        hot: !!tool,
        link: true,
      })
    }
    for (const s of gatewaySessions) {
      pushTo('gateway', {
        key: `gw-${s.id}`,
        glyph: s.id.slice(0, 2).toUpperCase(),
        color: TONE_COLOR.core,
        alive: true,
        title: `gateway · ${s.id} · ${s.model ?? 'unknown'}`,
        hot: false,
        link: true,
      })
    }
    for (const j of cronJobs) {
      pushTo('cron', {
        key: `cron-${j.id}`,
        glyph: (j.name || j.id).slice(0, 2).toUpperCase(),
        color: TONE_COLOR.worker,
        alive: j.enabled !== false,
        title: `cron · ${j.name || j.id} · ${j.cron ?? ''}`,
        hot: false,
        link: true,
      })
    }

    // Helper personas: distributed evenly across the bench tube, not orbiting.
    const benchTrack = TRACKS.find((t) => t.id === 'bench')!
    const personas = HELPER_PERSONAS
    const innerW = W - TRACK_PAD_X * 2 - 60
    const step = personas.length > 1 ? innerW / (personas.length - 1) : 0
    const startX = TRACK_PAD_X + 30
    const benchBucket: Array<Badge> = []
    personas.forEach((h, i) => {
      const x = startX + i * step
      const y = benchTrack.y
      benchBucket.push({
        key: `helper-${h.id}`,
        x,
        y,
        glyph: h.glyph,
        color: TONE_COLOR.bench,
        alive: false,
        title: `${h.name} — ${h.role}`,
        hot: false,
      })
    })
    buckets.__bench__ = benchBucket

    return Object.values(buckets).flat()
  }, [octogentAgents, gatewaySessions, cronJobs, activeTools])

  const wrapperStyle: CSSProperties = transparent
    ? {
        position: 'relative',
        width: '100%',
        background: 'transparent',
        overflow: 'visible',
      }
    : {
        position: 'relative',
        width: '100%',
        borderRadius: 24,
        border: '1px solid var(--theme-border)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--theme-card) 78%, transparent), color-mix(in srgb, var(--theme-card2) 60%, transparent))',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        boxShadow:
          '0 1px 0 var(--theme-shadow), 0 32px 80px -48px var(--theme-shadow)',
        overflow: 'hidden',
      }

  return (
    <div className={className} style={wrapperStyle} aria-label="Live engine">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
        style={{ display: 'block', maxHeight: 720 }}
      >
        <defs>
          <radialGradient id="ef-glow-core" cx="50%" cy="30%" r="55%">
            <stop
              offset="0%"
              stopColor="var(--theme-accent)"
              stopOpacity="0.16"
            />
            <stop
              offset="100%"
              stopColor="var(--theme-accent)"
              stopOpacity="0"
            />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="url(#ef-glow-core)" />

        {TRACKS.map((tr) => (
          <TrackTube key={tr.id} track={tr} />
        ))}

        {TRACKS.flatMap((tr) =>
          tr.nodes.map((n) => (
            <ServiceNodeDot
              key={`svc-${n.id}`}
              track={tr}
              node={n}
              hit={recentHitIds.has(n.id)}
            />
          )),
        )}

        {badges.map((b, i) => (
          <AgentBadge
            key={b.key}
            cx={b.x}
            cy={b.y}
            glyph={b.glyph}
            color={b.color}
            alive={b.alive}
            bobPhase={(i * 0.41) % Math.PI}
            title={b.title}
            hot={b.hot}
          />
        ))}

        {sparks.map((s) => {
          const dx = s.toX - s.fromX
          const dy = s.toY - s.fromY
          const cx = s.fromX + dx / 2 + dy * 0.06
          const cy = s.fromY + dy / 2 - dx * 0.06
          const pathId = `spark-path-${s.id}`
          return (
            <g key={s.id}>
              <defs>
                <path
                  id={pathId}
                  d={`M ${s.fromX} ${s.fromY} Q ${cx} ${cy} ${s.toX} ${s.toY}`}
                />
              </defs>
              <path
                d={`M ${s.fromX} ${s.fromY} Q ${cx} ${cy} ${s.toX} ${s.toY}`}
                fill="none"
                stroke={s.color}
                strokeWidth={1.4}
                strokeOpacity={0.55}
                strokeDasharray="2 4"
              />
              <circle r={4} fill={s.color}>
                <animateMotion
                  dur={`${SPARK_TTL_MS / 1000}s`}
                  begin="0s"
                  repeatCount="1"
                  fill="freeze"
                >
                  <mpath href={`#${pathId}`} />
                </animateMotion>
                <animate
                  attributeName="opacity"
                  values="0.2;1;1;0"
                  dur={`${SPARK_TTL_MS / 1000}s`}
                  fill="freeze"
                />
              </circle>
              {s.label && (
                <text
                  x={cx}
                  y={cy - 8}
                  textAnchor="middle"
                  fontSize={9}
                  fill={s.color}
                  opacity={0.8}
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, monospace',
                    letterSpacing: '0.04em',
                  }}
                >
                  {s.label.length > 26 ? `${s.label.slice(0, 24)}…` : s.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
