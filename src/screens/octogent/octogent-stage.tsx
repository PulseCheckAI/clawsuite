/**
 * Octogent Stage — PulseOS-native unified surface showing every agent source
 * running on this host plus a curated library of helper subagents.
 *
 * Layout (top -> bottom):
 *   1. Header + count pills (totals across Octogent + Gateway + Cron + Helpers).
 *   2. Autonomy strip — master + per-mode counts + live-stream + KG pills.
 *   3. EngineFloor — hero canvas: every agent docked at its real service node
 *      on 5 horizontal glass tubes; live data packets flow inside the tubes;
 *      WS terminal-state-changed events spawn colored sparks along the tracks.
 *   4. Agent inspector — Octogent terminals, Gateway sessions, Cron jobs as
 *      compact horizontal cards, sorted by source then lifecycle state.
 *   5. Scopes grid — Octogent's Scope (renamed tentacle) cards with todos and
 *      attached agents.
 *   6. Unified task feed — pending todos + cron jobs merged into one stream.
 *
 * Theme tokens mirror /conductor's THEME_STYLE for visual cohesion. Motion
 * is used for entrance, hover, progress fills, agent bob, and event-driven
 * sparks. Push updates arrive over the proxied terminal-events WebSocket.
 */
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { motion, AnimatePresence, useTime, useTransform } from 'motion/react'
import {
  useOctogentSnapshot,
  type Agent,
  type AgentLifecycle,
  type Scope,
} from '@/hooks/use-octogent'
import {
  useGatewaySessions,
  useCronJobs,
  HELPER_PERSONAS,
  type GatewaySession,
  type CronJob,
} from '@/hooks/use-all-agents'
import { useAutonomyCounts } from '@/hooks/use-agent-autonomy'
import {
  useOctogentEvents,
  type OctogentEvent,
} from '@/hooks/use-octogent-events'
import { useLightragStatus } from '@/hooks/use-lightrag-status'
import { cn } from '@/lib/utils'
import { EngineFloor } from './engine-floor'
import {
  AutonomyControl,
  AutonomyDot,
  MasterAutonomyControl,
} from './autonomy-control'

const THEME_STYLE: CSSProperties = {
  ['--theme-bg' as string]: 'var(--color-surface)',
  ['--theme-card' as string]: 'var(--color-primary-50)',
  ['--theme-card2' as string]: 'var(--color-primary-100)',
  ['--theme-border' as string]: 'var(--color-primary-200)',
  ['--theme-border2' as string]: 'var(--color-primary-400)',
  ['--theme-text' as string]: 'var(--color-ink)',
  ['--theme-muted' as string]: 'var(--color-primary-700)',
  ['--theme-muted-2' as string]: 'var(--color-primary-600)',
  ['--theme-accent' as string]: 'var(--color-accent-500)',
  ['--theme-accent-strong' as string]: 'var(--color-accent-600)',
  ['--theme-accent-soft' as string]:
    'color-mix(in srgb, var(--color-accent-500) 12%, transparent)',
  ['--theme-accent-glow' as string]:
    'color-mix(in srgb, var(--color-accent-500) 28%, transparent)',
  ['--theme-shadow' as string]:
    'color-mix(in srgb, var(--color-primary-950) 14%, transparent)',
  ['--theme-danger' as string]: 'var(--color-red-600, #dc2626)',
  ['--theme-warning' as string]: 'var(--color-amber-600, #d97706)',
  ['--theme-success' as string]: 'var(--color-emerald-600, #059669)',
}

const LIFECYCLE_STYLE: Record<
  AgentLifecycle,
  { label: string; dot: string; ring: string }
> = {
  running: {
    label: 'Live',
    dot: 'var(--theme-success)',
    ring: 'var(--theme-success)',
  },
  registered: {
    label: 'Ready',
    dot: 'var(--theme-accent)',
    ring: 'var(--theme-accent)',
  },
  stopped: {
    label: 'Stopped',
    dot: 'var(--theme-muted-2)',
    ring: 'var(--theme-border2)',
  },
  exited: {
    label: 'Exited',
    dot: 'var(--theme-muted-2)',
    ring: 'var(--theme-border2)',
  },
  stale: {
    label: 'Stale',
    dot: 'var(--theme-warning)',
    ring: 'var(--theme-warning)',
  },
}

function CountPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
}) {
  const valueColor =
    tone === 'accent'
      ? 'var(--theme-accent)'
      : tone === 'success'
        ? 'var(--theme-success)'
        : tone === 'warning'
          ? 'var(--theme-warning)'
          : tone === 'danger'
            ? 'var(--theme-danger)'
            : 'var(--theme-text)'
  return (
    <div
      className="rounded-2xl border px-5 py-3"
      style={{
        background: 'color-mix(in srgb, var(--theme-card) 92%, transparent)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        borderColor: 'var(--theme-border)',
        boxShadow:
          '0 1px 0 var(--theme-shadow), 0 12px 24px -16px var(--theme-shadow)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.18em]"
        style={{ color: 'var(--theme-muted-2)' }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-semibold tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </div>
    </div>
  )
}

function relativeAge(epochMs?: number | null): string {
  if (!epochMs) return ''
  const delta = Date.now() - epochMs
  if (delta < 0) return 'soon'
  const s = Math.floor(delta / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function LiveAgentCard({
  agentId,
  source,
  title,
  subtitle,
  state,
  meta,
  index,
  activeTool,
}: {
  agentId: string
  source: 'octogent' | 'gateway' | 'cron'
  title: string
  subtitle?: string
  state: keyof typeof LIFECYCLE_STYLE | 'enabled' | 'disabled' | 'queued'
  meta?: string
  /** Live tool-call indicator driven by WS terminal-state-changed events. */
  activeTool?: { tool?: string; runtimeState: string } | null
  index: number
}) {
  const SOURCE_COLOR: Record<typeof source, string> = {
    octogent: 'var(--theme-accent)',
    gateway: 'var(--theme-text)',
    cron: 'var(--theme-warning)',
  }
  const lifecycleStyle =
    (LIFECYCLE_STYLE as Record<string, (typeof LIFECYCLE_STYLE)['running']>)[
      state
    ] ?? null
  const isLive = state === 'running' || state === 'enabled'
  const ring = lifecycleStyle?.ring ?? SOURCE_COLOR[source]
  // Subtle live "breathing" bob for active cards — derived from a global motion
  // clock, so it costs nothing per card beyond the existing render path.
  const time = useTime()
  const phase = (index * 0.61) % Math.PI
  const bobAmp = isLive ? 2.2 : 0.8
  const bobY = useTransform(time, (t) => Math.sin(t / 1800 + phase) * bobAmp)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1 }}
      style={{
        minWidth: '19rem',
        maxWidth: '22rem',
        minHeight: '9.5rem',
        background: 'color-mix(in srgb, var(--theme-card) 92%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderColor: ring,
        y: bobY,
      }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: 'easeOut' }}
      className="flex shrink-0 flex-col rounded-2xl border px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-block size-2 rounded-full',
            isLive && 'animate-pulse',
          )}
          style={{
            background: lifecycleStyle?.dot ?? SOURCE_COLOR[source],
            boxShadow: isLive
              ? `0 0 8px ${lifecycleStyle?.dot ?? SOURCE_COLOR[source]}`
              : 'none',
          }}
        />
        <span
          className="text-[9px] uppercase tracking-[0.16em]"
          style={{ color: SOURCE_COLOR[source] }}
        >
          {source}
        </span>
        <span
          className="ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
          style={{
            background: 'color-mix(in srgb, var(--theme-text) 6%, transparent)',
            color: 'var(--theme-muted-2)',
          }}
        >
          {state}
        </span>
        <AutonomyDot agentId={agentId} />
      </div>
      <div
        className="mt-2 truncate text-sm font-semibold leading-tight"
        style={{ color: 'var(--theme-text)' }}
        title={title}
      >
        {title}
      </div>
      {subtitle && (
        <div
          className="mt-0.5 truncate text-[11px]"
          style={{ color: 'var(--theme-muted)' }}
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
      {meta && (
        <div
          className="mt-1.5 text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--theme-muted-2)' }}
        >
          {meta}
        </div>
      )}
      <AnimatePresence>
        {activeTool && (
          <motion.div
            key={activeTool.tool || activeTool.runtimeState}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px]"
            style={{
              background:
                'color-mix(in srgb, var(--theme-accent) 14%, transparent)',
              color: 'var(--theme-accent-strong)',
              maxWidth: '100%',
            }}
            title={`Runtime state: ${activeTool.runtimeState}`}
          >
            <span
              className="inline-block size-1.5 animate-ping rounded-full"
              style={{ background: 'var(--theme-accent)' }}
            />
            <span className="uppercase tracking-wider">▸</span>
            <span className="truncate font-mono font-semibold">
              {activeTool.tool || activeTool.runtimeState}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-auto pt-3">
        <AutonomyControl agentId={agentId} variant="compact" />
      </div>
    </motion.div>
  )
}

function LiveAgentsRow({
  octogentAgents,
  gatewaySessions,
  cronJobs,
  activeTools,
}: {
  octogentAgents: Array<Agent>
  gatewaySessions: Array<GatewaySession>
  cronJobs: Array<CronJob>
  activeTools: Record<
    string,
    { tool?: string; runtimeState: string; untilTs: number }
  >
}) {
  const totalLive =
    octogentAgents.length + gatewaySessions.length + cronJobs.length
  if (totalLive === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed p-6 text-center"
        style={{ borderColor: 'var(--theme-border2)' }}
      >
        <div
          className="text-sm font-semibold"
          style={{ color: 'var(--theme-text)' }}
        >
          No live agents from any source yet.
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--theme-muted)' }}>
          Spawn an Octogent terminal, open a Conductor session, or schedule a
          cron job — they'll show up here in real time.
        </div>
      </div>
    )
  }
  let i = 0
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {octogentAgents.map((a) => (
        <LiveAgentCard
          key={`og-${a.id}`}
          agentId={`octogent:${a.id}`}
          source="octogent"
          title={a.displayName || a.id}
          subtitle={a.tentacleId ? `Scope: ${a.tentacleId}` : 'unscoped'}
          state={a.lifecycleState ?? 'registered'}
          meta={a.workspaceMode === 'worktree' ? 'worktree' : 'shared'}
          index={i++}
          activeTool={activeTools[a.id] ?? null}
        />
      ))}
      {gatewaySessions.map((s) => (
        <LiveAgentCard
          key={`gw-${s.id}`}
          agentId={`gateway:${s.id}`}
          source="gateway"
          title={s.id}
          subtitle={s.cwd}
          state="running"
          meta={[s.model, s.modelProvider].filter(Boolean).join(' · ')}
          index={i++}
        />
      ))}
      {cronJobs.map((j) => (
        <LiveAgentCard
          key={`cron-${j.id}`}
          agentId={`cron:${j.id}`}
          source="cron"
          title={j.name || j.id}
          subtitle={j.cron}
          state={j.enabled === false ? 'disabled' : 'enabled'}
          meta={
            j.nextRunAt
              ? `next ${relativeAge(j.nextRunAt)}`
              : j.lastRunAt
                ? `last ${relativeAge(j.lastRunAt)}`
                : undefined
          }
          index={i++}
        />
      ))}
    </div>
  )
}

function AgentChip({ agent }: { agent: Agent }) {
  const state = agent.lifecycleState ?? 'registered'
  const style = LIFECYCLE_STYLE[state] ?? LIFECYCLE_STYLE.registered
  const label = agent.displayName || agent.id
  const isLive = state === 'running'
  return (
    <motion.div
      layout
      whileHover={{ y: -1 }}
      className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
      style={{
        background: isLive
          ? 'color-mix(in srgb, var(--theme-success) 8%, var(--theme-card))'
          : 'var(--theme-card2)',
        borderColor: style.ring,
        color: 'var(--theme-text)',
      }}
    >
      <span
        className={cn(
          'inline-block size-2 rounded-full',
          isLive && 'animate-pulse',
        )}
        style={{
          background: style.dot,
          boxShadow: isLive ? `0 0 8px ${style.dot}` : 'none',
        }}
      />
      <span className="font-medium" title={agent.id}>
        {label}
      </span>
      <span
        className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
        style={{
          background: 'color-mix(in srgb, var(--theme-text) 6%, transparent)',
          color: 'var(--theme-muted-2)',
        }}
      >
        {style.label}
      </span>
      {agent.workspaceMode === 'worktree' && (
        <span className="text-[10px]" style={{ color: 'var(--theme-muted)' }}>
          worktree
        </span>
      )}
    </motion.div>
  )
}

function ScopeCard({
  scope,
  agents,
  index,
}: {
  scope: Scope
  agents: Array<Agent>
  index: number
}) {
  const attached = agents.filter((a) => a.tentacleId === scope.id)
  const remaining = scope.todoCount - scope.completedTodoCount
  const progressPct =
    scope.todoCount > 0
      ? Math.round((scope.completedTodoCount / scope.todoCount) * 100)
      : 0
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-2xl border p-5"
      style={{
        background: 'color-mix(in srgb, var(--theme-card) 92%, transparent)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        borderColor: 'var(--theme-border)',
        boxShadow:
          '0 1px 0 var(--theme-shadow), 0 24px 60px -36px var(--theme-shadow)',
      }}
    >
      <div
        className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(closest-side, var(--theme-accent-glow), transparent 70%)',
        }}
      />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="truncate text-base font-semibold"
            style={{ color: 'var(--theme-text)' }}
            title={scope.id}
          >
            {scope.name}
          </h3>
          {scope.description && (
            <p
              className="mt-1 line-clamp-2 text-xs"
              style={{ color: 'var(--theme-muted)' }}
            >
              {scope.description}
            </p>
          )}
        </div>
        <div
          className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium uppercase tracking-wider tabular-nums"
          style={{
            background: 'var(--theme-accent-soft)',
            color: 'var(--theme-accent-strong)',
          }}
        >
          {scope.completedTodoCount}/{scope.todoCount}
        </div>
      </header>

      <div className="mt-4">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--theme-card2)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: 'var(--theme-accent)',
              width: `${progressPct}%`,
              transition: 'width 0.6s ease-out',
            }}
          />
        </div>
        <div
          className="mt-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--theme-muted-2)' }}
        >
          <span>{progressPct}% complete</span>
          <span>{remaining} open</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {attached.length === 0 ? (
          <span
            className="text-xs italic"
            style={{ color: 'var(--theme-muted-2)' }}
          >
            No agents attached yet
          </span>
        ) : (
          attached.slice(0, 8).map((a) => <AgentChip key={a.id} agent={a} />)
        )}
        {attached.length > 8 && (
          <span className="text-xs" style={{ color: 'var(--theme-muted-2)' }}>
            +{attached.length - 8} more
          </span>
        )}
      </div>

      {scope.todos.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {scope.todos.slice(0, 4).map((t) => (
            <li
              key={t.index}
              className="flex items-start gap-2 text-xs"
              style={{ color: 'var(--theme-muted)' }}
            >
              <span
                className="mt-0.5 inline-block size-3 shrink-0 rounded-sm border"
                style={{
                  background: t.done ? 'var(--theme-accent)' : 'transparent',
                  borderColor: t.done
                    ? 'var(--theme-accent)'
                    : 'var(--theme-border2)',
                }}
              />
              <span className={cn(t.done && 'line-through opacity-60')}>
                {t.text}
              </span>
            </li>
          ))}
          {scope.todos.length > 4 && (
            <li
              className="text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--theme-muted-2)' }}
            >
              +{scope.todos.length - 4} more tasks
            </li>
          )}
        </ul>
      )}
    </motion.article>
  )
}

type UnifiedTask = {
  key: string
  source: 'octogent' | 'cron'
  title: string
  scopeOrJobId?: string
  done?: boolean
  meta?: string
}

function UnifiedTaskFeed({
  scopes,
  cronJobs,
}: {
  scopes: Array<Scope>
  cronJobs: Array<CronJob>
}) {
  const tasks: Array<UnifiedTask> = useMemo(() => {
    const out: Array<UnifiedTask> = []
    for (const s of scopes) {
      for (const t of s.todos) {
        out.push({
          key: `og-${s.id}-${t.index}`,
          source: 'octogent',
          title: t.text,
          scopeOrJobId: s.name,
          done: t.done,
        })
      }
    }
    for (const j of cronJobs) {
      out.push({
        key: `cron-${j.id}`,
        source: 'cron',
        title: j.name || j.id,
        scopeOrJobId: j.cron,
        meta: j.nextRunAt
          ? `next ${relativeAge(j.nextRunAt)}`
          : j.lastRunAt
            ? `last ${relativeAge(j.lastRunAt)}`
            : undefined,
      })
    }
    // Sort: open Octogent todos first, then enabled cron, then completed
    out.sort((a, b) => {
      const ad = a.done ? 1 : 0
      const bd = b.done ? 1 : 0
      if (ad !== bd) return ad - bd
      return a.source.localeCompare(b.source)
    })
    return out
  }, [scopes, cronJobs])

  if (tasks.length === 0) return null
  return (
    <section className="mt-10">
      <h3
        className="mb-3 text-xs uppercase tracking-[0.18em]"
        style={{ color: 'var(--theme-muted-2)' }}
      >
        Unified task feed
      </h3>
      <ul
        className="divide-y rounded-2xl border"
        style={{
          background: 'color-mix(in srgb, var(--theme-card) 92%, transparent)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          borderColor: 'var(--theme-border)',
        }}
      >
        {tasks.slice(0, 14).map((t) => (
          <li
            key={t.key}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                background:
                  t.source === 'octogent'
                    ? 'var(--theme-accent)'
                    : 'var(--theme-warning)',
              }}
            />
            <span
              className="w-16 shrink-0 text-[9px] uppercase tracking-[0.16em]"
              style={{
                color:
                  t.source === 'octogent'
                    ? 'var(--theme-accent-strong)'
                    : 'var(--theme-warning)',
              }}
            >
              {t.source}
            </span>
            <span
              className={cn(
                'flex-1 truncate',
                t.done && 'opacity-60 line-through',
              )}
              style={{ color: 'var(--theme-text)' }}
              title={t.title}
            >
              {t.title}
            </span>
            <span
              className="shrink-0 text-[10px]"
              style={{ color: 'var(--theme-muted-2)' }}
            >
              {t.scopeOrJobId}
            </span>
            {t.meta && (
              <span
                className="shrink-0 text-[10px]"
                style={{ color: 'var(--theme-muted-2)' }}
              >
                {t.meta}
              </span>
            )}
          </li>
        ))}
      </ul>
      {tasks.length > 14 && (
        <div
          className="mt-2 text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--theme-muted-2)' }}
        >
          +{tasks.length - 14} more
        </div>
      )}
    </section>
  )
}

export function OctogentStage() {
  const snap = useOctogentSnapshot()
  const gateway = useGatewaySessions()
  const cron = useCronJobs()
  // ActiveTool: per-terminal { tool, runtimeState, untilTs } captured from
  // terminal-state-changed WS events. Used by LiveAgentCard to display a
  // pulsing "▸ using <tool>" line; entries auto-expire after 8 s so the
  // indicator isn't sticky if the agent finishes the call between events.
  const [activeTools, setActiveTools] = useState<
    Record<string, { tool?: string; runtimeState: string; untilTs: number }>
  >({})
  // Latest event is fed to <EngineFloor> so it can spawn a spark along the
  // appropriate track when an agent uses a tool. Holding the most recent event
  // (not the full log) keeps the canvas reactive without re-rendering on every
  // unrelated invalidation.
  const [latestEvent, setLatestEvent] = useState<OctogentEvent | null>(null)

  const handleOctogentEvent = useCallback((event: OctogentEvent) => {
    setLatestEvent(event)
    if (event.type !== 'terminal-state-changed') return
    const ttl = 8_000
    setActiveTools((prev) => ({
      ...prev,
      [event.terminalId]: {
        tool: event.toolName,
        runtimeState: event.agentRuntimeState,
        untilTs: Date.now() + ttl,
      },
    }))
  }, [])

  // Sweep expired activeTool entries every 1s so the indicator fades on idle.
  useEffect(() => {
    const t = window.setInterval(() => {
      setActiveTools((prev) => {
        const now = Date.now()
        let didChange = false
        const next: typeof prev = {}
        for (const [k, v] of Object.entries(prev)) {
          if (v.untilTs > now) next[k] = v
          else didChange = true
        }
        return didChange ? next : prev
      })
    }, 1_000)
    return () => window.clearInterval(t)
  }, [])

  // Subscribe to the upstream terminal-events WS — push updates invalidate
  // React Query so Live Agents row + Scope cards reflect changes immediately
  // instead of waiting for the 60s safety-net poll. The callback also feeds
  // the activeTools state above so cards can show what each agent is doing.
  const { connected: liveStreamConnected } = useOctogentEvents({
    onEvent: handleOctogentEvent,
  })
  // KG status — agents reach the knowledge graph via the lightrag MCP server
  // configured in ~/.claude.json. The pill flips red if /lightrag/health stops
  // responding so we see KG outages immediately.
  const lightrag = useLightragStatus()

  const scopes = snap.scopes.data ?? []
  const agents = snap.agents.data ?? []
  const gatewaySessions = gateway.data ?? []
  const cronJobs = cron.data ?? []

  const totalLive = snap.counts.activeAgents + gatewaySessions.length

  // Collect autonomy ids across every source the stage manages.
  const autonomyIds = useMemo(() => {
    const ids: Array<string> = []
    for (const a of agents) ids.push(`octogent:${a.id}`)
    for (const s of gatewaySessions) ids.push(`gateway:${s.id}`)
    for (const j of cronJobs) ids.push(`cron:${j.id}`)
    for (const h of HELPER_PERSONAS) ids.push(`helper:${h.id}`)
    return ids
  }, [agents, gatewaySessions, cronJobs])
  const autonomy = useAutonomyCounts(autonomyIds)

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        ...THEME_STYLE,
        background:
          'radial-gradient(1200px 600px at 80% -10%, var(--theme-accent-soft), transparent 60%), var(--theme-bg)',
        color: 'var(--theme-text)',
      }}
    >
      <div className="relative mx-auto max-w-[1400px] px-6 py-10">
        <header className="mb-8">
          <div
            className="text-[10px] uppercase tracking-[0.32em]"
            style={{ color: 'var(--theme-muted-2)' }}
          >
            Conductor · Octogent
          </div>
          <h1
            className="mt-1 text-4xl font-semibold tracking-tight"
            style={{
              backgroundImage:
                'linear-gradient(90deg, var(--theme-text), var(--theme-accent-strong))',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Multi-agent stage
          </h1>
          <p
            className="mt-2 max-w-2xl text-sm"
            style={{ color: 'var(--theme-muted)' }}
          >
            Every running agent on this platform — Octogent terminals, OpenClaw
            gateway sessions, scheduled cron workers — plus a curated library of
            helper subagents the Conductor can dispatch on demand. The engine
            diagram behind shows the real services they ride on.
          </p>
        </header>

        <section
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          }}
        >
          <CountPill
            label="Octogent"
            value={snap.counts.agents}
            tone="accent"
          />
          <CountPill
            label="Gateway sessions"
            value={gatewaySessions.length}
            tone="neutral"
          />
          <CountPill label="Cron jobs" value={cronJobs.length} tone="warning" />
          <CountPill label="Live" value={totalLive} tone="success" />
          <CountPill
            label="Stale"
            value={snap.counts.staleAgents}
            tone="warning"
          />
          <CountPill
            label="Open tasks"
            value={snap.counts.openTasks}
            tone="accent"
          />
        </section>

        {/* Autonomy strip: master switch + per-mode counts + live-stream pill */}
        <section className="mt-6 flex flex-wrap items-end gap-6">
          <MasterAutonomyControl />
          <div
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
            title={
              liveStreamConnected
                ? 'Subscribed to octogent terminal-events WebSocket — updates push in real time.'
                : 'Live event stream disconnected — falling back to 60s polling. Auto-reconnects with exponential backoff.'
            }
            style={{
              background: liveStreamConnected
                ? 'color-mix(in srgb, var(--theme-success) 10%, var(--theme-card))'
                : 'color-mix(in srgb, var(--theme-warning) 8%, var(--theme-card))',
              borderColor: liveStreamConnected
                ? 'color-mix(in srgb, var(--theme-success) 45%, var(--theme-border))'
                : 'color-mix(in srgb, var(--theme-warning) 45%, var(--theme-border))',
              color: 'var(--theme-text)',
            }}
          >
            <span
              className={cn(
                'inline-block size-2 rounded-full',
                liveStreamConnected && 'animate-pulse',
              )}
              style={{
                background: liveStreamConnected
                  ? 'var(--theme-success)'
                  : 'var(--theme-warning)',
                boxShadow: liveStreamConnected
                  ? '0 0 6px var(--theme-success)'
                  : undefined,
              }}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{
                color: liveStreamConnected
                  ? 'var(--theme-success)'
                  : 'var(--theme-warning)',
              }}
            >
              {liveStreamConnected ? 'Live stream' : 'Reconnecting'}
            </span>
          </div>

          {/* KG status — every agent's memory tool routes through here. */}
          <div
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
            title={
              lightrag.healthy
                ? `Knowledge graph reachable · ${lightrag.payload?.working_directory ?? 'default working dir'}${lightrag.payload?.pipeline_busy ? ' · ingesting' : ''}`
                : lightrag.isLoading
                  ? 'Probing lightrag /health…'
                  : 'LightRAG unavailable — agents fall back to file-only context'
            }
            style={{
              background: lightrag.healthy
                ? 'color-mix(in srgb, var(--theme-accent) 10%, var(--theme-card))'
                : 'color-mix(in srgb, var(--theme-danger) 8%, var(--theme-card))',
              borderColor: lightrag.healthy
                ? 'color-mix(in srgb, var(--theme-accent) 45%, var(--theme-border))'
                : 'color-mix(in srgb, var(--theme-danger) 45%, var(--theme-border))',
              color: 'var(--theme-text)',
            }}
          >
            <span
              className={cn(
                'inline-block size-2 rounded-full',
                lightrag.healthy && 'animate-pulse',
                lightrag.payload?.pipeline_busy && 'animate-ping',
              )}
              style={{
                background: lightrag.healthy
                  ? 'var(--theme-accent)'
                  : 'var(--theme-danger)',
                boxShadow: lightrag.healthy
                  ? '0 0 6px var(--theme-accent)'
                  : undefined,
              }}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{
                color: lightrag.healthy
                  ? 'var(--theme-accent-strong)'
                  : 'var(--theme-danger)',
              }}
            >
              {lightrag.healthy
                ? lightrag.payload?.pipeline_busy
                  ? 'KG ingesting'
                  : 'KG wired'
                : 'KG down'}
            </span>
          </div>
          <div
            className="flex items-center gap-2 text-xs"
            style={{ color: 'var(--theme-muted)' }}
          >
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: 'var(--theme-muted-2)' }}
            />
            <span
              className="tabular-nums"
              style={{ color: 'var(--theme-text)' }}
            >
              {autonomy.off}
            </span>
            <span className="uppercase tracking-wider">off</span>
            <span
              className="ml-3 inline-block size-2 rounded-full"
              style={{ background: 'var(--theme-warning)' }}
            />
            <span
              className="tabular-nums"
              style={{ color: 'var(--theme-text)' }}
            >
              {autonomy.approval}
            </span>
            <span className="uppercase tracking-wider">ask first</span>
            <span
              className="ml-3 inline-block size-2 rounded-full"
              style={{
                background: 'var(--theme-success)',
                boxShadow: '0 0 6px var(--theme-success)',
              }}
            />
            <span
              className="tabular-nums"
              style={{ color: 'var(--theme-text)' }}
            >
              {autonomy.auto}
            </span>
            <span className="uppercase tracking-wider">autonomous</span>
            <span
              className="ml-2 text-[10px] uppercase tracking-[0.16em]"
              style={{ color: 'var(--theme-muted-2)' }}
            >
              of {autonomy.total} agents
            </span>
          </div>
        </section>

        {snap.isError ? (
          <div
            className="mt-8 rounded-2xl border p-5 text-sm"
            style={{
              background:
                'color-mix(in srgb, var(--theme-danger) 8%, var(--theme-card))',
              borderColor:
                'color-mix(in srgb, var(--theme-danger) 35%, var(--theme-border))',
              color: 'var(--theme-text)',
            }}
          >
            <strong>Couldn't reach Octogent.</strong>
            <div
              className="mt-1 text-xs"
              style={{ color: 'var(--theme-muted)' }}
            >
              Confirm <code>pulseos-octogent</code> is online and the
              <code> /octogent</code> proxy is wired.
            </div>
          </div>
        ) : null}

        {/* ENGINE FLOOR — hero canvas: every agent perched on its real
            service node, live data packets streaming through glass tubes,
            event-driven sparks fire on every WS terminal-state-changed.
            Smaller agent badges → all fit; tall canvas → no overlap. */}
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h3
              className="text-xs uppercase tracking-[0.18em]"
              style={{ color: 'var(--theme-muted-2)' }}
            >
              Live engine
            </h3>
            <p className="text-[10px]" style={{ color: 'var(--theme-muted)' }}>
              Glass tubes carry live data packets · agents perch at their home
              service · sparks fly on every tool call
            </p>
          </div>
          <EngineFloor
            octogentAgents={agents}
            gatewaySessions={gatewaySessions}
            cronJobs={cronJobs}
            activeTools={activeTools}
            latestEvent={latestEvent}
          />
        </section>

        {/* LIVE AGENTS row — same data, card view for inspection */}
        <section className="mt-8">
          <h3
            className="mb-3 text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--theme-muted-2)' }}
          >
            Agent inspector
          </h3>
          <LiveAgentsRow
            octogentAgents={agents}
            gatewaySessions={gatewaySessions}
            cronJobs={cronJobs}
            activeTools={activeTools}
          />
        </section>

        {/* SCOPES grid */}
        <section className="mt-2">
          <h3
            className="mb-3 text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--theme-muted-2)' }}
          >
            Scopes
          </h3>
          {scopes.length === 0 && !snap.isLoading ? (
            <div
              className="rounded-2xl border border-dashed p-10 text-center"
              style={{ borderColor: 'var(--theme-border2)' }}
            >
              <div
                className="text-sm font-semibold"
                style={{ color: 'var(--theme-text)' }}
              >
                No Scopes yet.
              </div>
              <div
                className="mt-1 text-xs"
                style={{ color: 'var(--theme-muted)' }}
              >
                Create one from a Claude-CLI session or via{' '}
                <code>octogent tentacle create &lt;name&gt;</code>.
              </div>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.div
                layout
                className="grid gap-4"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                }}
              >
                {scopes.map((s, i) => (
                  <ScopeCard key={s.id} scope={s} agents={agents} index={i} />
                ))}
              </motion.div>
            </AnimatePresence>
          )}
        </section>

        <UnifiedTaskFeed scopes={scopes} cronJobs={cronJobs} />

        <footer
          className="mt-12 border-t pt-4 text-[11px]"
          style={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-muted-2)',
          }}
        >
          WebSocket push updates from /octogent/api/terminal-events · safety-
          net poll every 30–60s · LightRAG knowledge graph wired via mcp · every
          agent badge on the live engine is the real service it rides on.
        </footer>
      </div>
    </div>
  )
}
