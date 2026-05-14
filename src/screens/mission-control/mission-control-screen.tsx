import { useEffect, useState } from 'react'
import {
  KpiCard,
  StatusDot,
  BadgeDelta,
  Tracker,
  BarList,
  Callout,
  PulseLogo,
  type TrackerCell,
  type BarListItem,
} from '@/components/mission-control'
import { getSupabaseClient } from '@/lib/supabase-client'

type Todo = {
  id: string
  title: string
  status: string
  priority: string
  category: string
  assignee: string
  track_status: string | null
  created_at: string
}

type AgentLog = {
  id: string
  agent_name: string
  status: string
  model_used: string | null
  created_at: string
}

const SUPABASE_URL = 'https://zcjgjfersccwwhjmaflw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_krMU4pMkUZQNQT9bbO68jw_IahpZoEd'

async function supabaseGet<T>(path: string): Promise<Array<T>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Accept-Profile': 'command_center',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

type Integration = {
  id: string
  name: string
  role: string
  state: 'online' | 'configured' | 'not-configured' | 'unknown'
  detail: string
  color: string
}

type AutonomyState = {
  enabled: boolean
  lastTickAt: number
  lastTickResult:
    | null
    | { ok: true; picked: null; reason: string }
    | {
        ok: true
        picked: {
          id: string
          title: string
          category: string
          agent: string
          status: string
        }
      }
    | { ok: false; error: string }
  totalTicks: number
  totalDispatched: number
  totalFailed: number
  inflightCount: number
}

export function MissionControlScreen() {
  const [todos, setTodos] = useState<Array<Todo>>([])
  const [logs, setLogs] = useState<Array<AgentLog>>([])
  const [integrations, setIntegrations] = useState<Array<Integration>>([])
  const [autonomy, setAutonomy] = useState<AutonomyState | null>(null)
  const [tickPending, setTickPending] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(tick)
  }, [])

  // Initial cold-start fetch (REST) + Realtime postgres_changes subscription
  // for todos + agent_logs. The REST fetch hydrates state on mount; the
  // realtime channel keeps it live afterward — INSERT prepends, UPDATE
  // replaces by id, DELETE filters by id. No more 30s polling.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabaseGet<Todo>('todos?select=*&order=created_at.desc&limit=200'),
      supabaseGet<AgentLog>(
        'agent_logs?select=*&order=created_at.desc&limit=200',
      ),
    ])
      .then(([t, l]) => {
        if (cancelled) return
        setTodos(t)
        setLogs(l)
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e.message)
      })

    const supabase = getSupabaseClient()
    const channel = supabase
      .channel('mission-control-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'command_center', table: 'todos' },
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'INSERT') {
            setTodos((prev) => [payload.new as Todo, ...prev].slice(0, 200))
          } else if (payload.eventType === 'UPDATE') {
            setTodos((prev) =>
              prev.map((t) =>
                t.id === (payload.new as Todo).id ? (payload.new as Todo) : t,
              ),
            )
          } else if (payload.eventType === 'DELETE') {
            setTodos((prev) =>
              prev.filter((t) => t.id !== (payload.old as Todo).id),
            )
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'command_center', table: 'agent_logs' },
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'INSERT') {
            setLogs((prev) => [payload.new as AgentLog, ...prev].slice(0, 200))
          } else if (payload.eventType === 'UPDATE') {
            setLogs((prev) =>
              prev.map((l) =>
                l.id === (payload.new as AgentLog).id
                  ? (payload.new as AgentLog)
                  : l,
              ),
            )
          } else if (payload.eventType === 'DELETE') {
            setLogs((prev) =>
              prev.filter((l) => l.id !== (payload.old as AgentLog).id),
            )
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/system-integrations')
        const body = (await res.json()) as {
          ok: boolean
          integrations: Array<Integration>
        }
        if (!cancelled && body.ok) setIntegrations(body.integrations)
      } catch {
        // Probe is best-effort; failures = no panel, no fabrication.
      }
    }
    void load()
    const refresh = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(refresh)
    }
  }, [])

  // Autonomy loop status — polls /api/autonomy-status every 10s.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/autonomy-status')
        const body = (await res.json()) as { ok: boolean; state: AutonomyState }
        if (!cancelled && body.ok) setAutonomy(body.state)
      } catch {
        // best-effort; failures = no panel update
      }
    }
    void load()
    const refresh = setInterval(load, 10_000)
    return () => {
      cancelled = true
      clearInterval(refresh)
    }
  }, [])

  async function handleManualTick() {
    if (tickPending) return
    setTickPending(true)
    try {
      await fetch('/api/autonomy-tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      // Force-refresh state immediately after tick
      try {
        const res = await fetch('/api/autonomy-status')
        const body = (await res.json()) as { ok: boolean; state: AutonomyState }
        if (body.ok) setAutonomy(body.state)
      } catch {
        // ignore
      }
    } catch {
      // ignore
    } finally {
      setTickPending(false)
    }
  }

  const totalTasks = todos.length
  const inProgress = todos.filter((t) => t.status === 'in_progress').length
  const todoCount = todos.filter((t) => t.status === 'todo').length
  const done = todos.filter((t) => t.status === 'done').length
  const claudeTasks = todos.filter((t) => t.assignee === 'Claude').length
  const thiagoTasks = todos.filter((t) => t.assignee === 'Thiago').length
  const completionPct = totalTasks > 0 ? (done / totalTasks) * 100 : 0

  const today = now.toISOString().slice(0, 10)
  const agentRunsToday = logs.filter(
    (l) => l.created_at.slice(0, 10) === today,
  ).length
  const successfulRuns = logs.filter((l) => l.status === 'completed').length
  const failedRuns = logs.filter((l) => l.status === 'failed').length
  const successRate =
    successfulRuns + failedRuns > 0
      ? (successfulRuns / (successfulRuns + failedRuns)) * 100
      : 0

  const buckets = Array.from({ length: 7 }, () => 0)
  todos.forEach((t) => {
    const ageDays = Math.floor(
      (now.getTime() - new Date(t.created_at).getTime()) / (24 * 3600 * 1000),
    )
    if (ageDays >= 0 && ageDays < 7) buckets[6 - ageDays]++
  })

  const runsSpark = Array.from({ length: 14 }, () => 0)
  logs.forEach((l) => {
    const ageDays = Math.floor(
      (now.getTime() - new Date(l.created_at).getTime()) / (24 * 3600 * 1000),
    )
    if (ageDays >= 0 && ageDays < 14) runsSpark[13 - ageDays]++
  })

  const trackerCells: Array<TrackerCell> = Array.from(
    { length: 30 },
    (_, i) => {
      const dayOffset = 29 - i
      const dayStr = new Date(now.getTime() - dayOffset * 86400000)
        .toISOString()
        .slice(0, 10)
      const tasksThatDay = todos.filter(
        (t) => t.created_at.slice(0, 10) === dayStr,
      ).length
      const logsThatDay = logs.filter(
        (l) => l.created_at.slice(0, 10) === dayStr,
      ).length
      const total = tasksThatDay + logsThatDay
      return {
        tone:
          total === 0
            ? 'unknown'
            : total > 5
              ? 'ok'
              : total > 2
                ? 'warn'
                : 'unknown',
        tooltip: `${dayStr} · ${tasksThatDay} task${tasksThatDay !== 1 ? 's' : ''}, ${logsThatDay} run${logsThatDay !== 1 ? 's' : ''}`,
      }
    },
  )

  const agentCounts: Record<string, number> = {}
  logs.forEach((l) => {
    agentCounts[l.agent_name] = (agentCounts[l.agent_name] || 0) + 1
  })
  const topAgents: Array<BarListItem> = Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({
      label,
      value,
      formattedValue: String(value),
    }))

  // ── Agent Roster ──────────────────────────────────────────────────────────
  // Tutorial Phase 9 mapping: 5 named agents (Alex/Maya/Jordan/Dev/Sam) with
  // role labels and signature glow colors. Stats come from command_center.
  // agent_logs — last task description, last active timestamp, today's count,
  // last model used. Empty-state cells show "No data yet" honestly (per the
  // feedback_no_mock_data memory).
  const AGENT_ROSTER = [
    { key: 'Alex', emoji: '🔎', role: 'Research Analyst', color: '#3B82F6' },
    { key: 'Maya', emoji: '✍️', role: 'Content Writer', color: '#7C3AED' },
    {
      key: 'Jordan',
      emoji: '📈',
      role: 'Marketing Strategist',
      color: '#F59E0B',
    },
    { key: 'Dev', emoji: '💻', role: 'Full-Stack Developer', color: '#10B981' },
    { key: 'Sam', emoji: '📱', role: 'Social Media Manager', color: '#EC4899' },
  ] as const
  const agentRosterStats = AGENT_ROSTER.map((a) => {
    const agentLogs = logs
      .filter((l) => l.agent_name === a.key)
      .sort(
        (x, y) =>
          new Date(y.created_at).getTime() - new Date(x.created_at).getTime(),
      )
    const last = agentLogs[0] ?? null
    const tasksToday = agentLogs.filter(
      (l) => l.created_at.slice(0, 10) === today,
    ).length
    return { ...a, last, tasksToday, total: agentLogs.length }
  })

  const catCounts: Record<string, number> = {}
  todos.forEach((t) => {
    catCounts[t.category] = (catCounts[t.category] || 0) + 1
  })
  const topCategories: Array<BarListItem> = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value,
      formattedValue: String(value),
    }))

  const recentActivity = logs.slice(0, 8)

  // ── Operator-question framing ────────────────────────────────────────────
  // Health: thresholds on success rate. <80% red, 80-95% amber, ≥95% green.
  const healthTone: 'positive' | 'neutral' | 'negative' =
    successfulRuns + failedRuns === 0
      ? 'neutral'
      : successRate >= 95
        ? 'positive'
        : successRate >= 80
          ? 'neutral'
          : 'negative'

  // Action Required: in_progress tasks that haven't moved in >24h + off-track
  const staleThresholdMs = 24 * 3600 * 1000
  const staleInProgress = todos.filter(
    (t) =>
      t.status === 'in_progress' &&
      now.getTime() - new Date(t.created_at).getTime() > staleThresholdMs,
  )
  const offTrack = todos.filter(
    (t) => t.track_status === 'Off Track' || t.track_status === 'At Risk',
  )
  const recentFailures = logs.filter((l) => l.status === 'failed').slice(0, 5)
  const actionItems = [
    ...staleInProgress.map((t) => ({
      kind: 'stale' as const,
      title: t.title,
      detail: `${t.assignee} · in_progress for ${Math.floor((now.getTime() - new Date(t.created_at).getTime()) / 3600000)}h`,
    })),
    ...offTrack
      .filter((t) => !staleInProgress.some((s) => s.id === t.id))
      .map((t) => ({
        kind: 'track' as const,
        title: t.title,
        detail: `${t.assignee} · ${t.track_status}`,
      })),
    ...recentFailures.map((l) => ({
      kind: 'fail' as const,
      title: `Agent run failed: ${l.agent_name}`,
      detail: `${l.model_used ?? 'unknown'} · ${new Date(l.created_at).toLocaleString()}`,
    })),
  ].slice(0, 6)

  return (
    <div className="min-h-screen bg-primary-50 dark:bg-primary-100 text-primary-950 dark:text-primary-950">
      {/* Flat page header — no card, no sticky bar. Logo + title sit
          directly on the page; status pills float on the right. */}
      <header className="px-6 md:px-8 pt-6 md:pt-8 pb-2 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <PulseLogo size={56} variant="gradient" glow={false} />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Command Center
            </h1>
            <p className="text-xs text-primary-700 dark:text-primary-800 mt-1 font-mono">
              PulseCheck AI <span className="mx-1">›</span> Command Center
              <span className="mx-2">·</span>
              <span className="pulse-text font-semibold">Live</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-2">
            <StatusDot tone="live" />
            <span className="font-mono">Supabase command_center</span>
          </div>
          <div className="font-mono">{now.toLocaleTimeString()}</div>
        </div>
      </header>

      <div className="px-6 md:px-8 py-6 space-y-6 max-w-[1500px]">
        {loadErr ? (
          <Callout tone="critical" title="Data load failed">
            {loadErr}
          </Callout>
        ) : null}

        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            label="Total Tasks"
            value={totalTasks}
            delta={`${inProgress} in flight`}
            deltaTone="neutral"
            spark={buckets}
            context={`${claudeTasks} Claude · ${thiagoTasks} Thiago`}
          />
          <KpiCard
            label="Completion"
            value={`${Math.round(completionPct)}%`}
            delta={`${done}/${totalTasks}`}
            deltaTone={completionPct > 50 ? 'positive' : 'neutral'}
            context={`${todoCount} todo, ${inProgress} in_progress, ${done} done`}
          />
          <KpiCard
            label="Agent Runs · Today"
            value={agentRunsToday}
            delta={`${logs.length} total`}
            deltaTone="neutral"
            spark={runsSpark}
            context="Across all sessions · 14-day series"
          />
          <KpiCard
            label="Success Rate"
            value={successRate > 0 ? `${Math.round(successRate)}%` : '—'}
            delta={
              successfulRuns + failedRuns === 0
                ? 'no runs yet'
                : healthTone === 'positive'
                  ? 'healthy'
                  : healthTone === 'negative'
                    ? `${failedRuns} failed`
                    : `${Math.round(100 - successRate)}% drift`
            }
            deltaTone={healthTone}
            context={`${successfulRuns} completed · ${failedRuns} failed · target ≥95%`}
          />
        </section>

        {/* ── Action Required ── highest-priority panel: what needs attention now */}
        {actionItems.length > 0 ? (
          <section className="glass-pulse rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="pulse-status-dot inline-block w-2 h-2 rounded-full bg-amber-500" />
                <h2 className="text-base font-semibold">Action Required</h2>
                <span className="label-mc">
                  {actionItems.length} item{actionItems.length !== 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-[11px] font-mono text-primary-700 dark:text-primary-800">
                stale &gt;24h · off-track · recent failures
              </span>
            </div>
            <ul className="space-y-2">
              {actionItems.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 px-3 py-2 rounded-md bg-[rgba(255,255,255,0.04)]"
                >
                  <StatusDot
                    tone={
                      item.kind === 'fail'
                        ? 'down'
                        : item.kind === 'stale'
                          ? 'warn'
                          : 'idle'
                    }
                    pulse={item.kind === 'fail'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {item.title}
                    </div>
                    <div className="text-[11px] font-mono text-primary-700 dark:text-primary-800 truncate">
                      {item.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <Callout tone="success" title="No action required">
            No stale in_progress tasks (&gt;24h), no off-track items, no recent
            failures. Command Center is clear.
          </Callout>
        )}

        {/* ── Activity tracker — what changed over 30 days ── */}
        <section className="glass-card p-5 rounded-xl border">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold">Activity · 30 days</h2>
              <p className="text-[11px] mt-0.5 font-mono opacity-60">
                task + agent_log creation per day
              </p>
            </div>
            <BadgeDelta
              value={`${totalTasks + logs.length} total`}
              tone="neutral"
            />
          </div>
          <Tracker cells={trackerCells} cellWidth={14} cellHeight={42} />
          <div className="mt-4 pt-3 border-t border-[rgba(170,178,195,0.2)] flex items-center justify-between text-[10px] uppercase tracking-wider font-mono opacity-50">
            <span>30 days ago</span>
            <span>today</span>
          </div>
        </section>

        {/* ── Agent Roster — 5 named agents with role + glow + live stats ── */}
        <section className="rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Agent Roster</h2>
              <p className="text-[11px] mt-0.5 font-mono opacity-60">
                Alex · Maya · Jordan · Dev · Sam — reading from{' '}
                command_center.agent_logs
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-wider font-mono opacity-60">
              {agentRosterStats.reduce((n, a) => n + a.tasksToday, 0)} tasks
              today
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {agentRosterStats.map((a) => (
              <article
                key={a.key}
                className="relative rounded-xl border p-3 overflow-hidden"
                style={{
                  boxShadow: `inset 0 0 0 1px ${a.color}40, 0 8px 20px -10px ${a.color}55`,
                }}
              >
                <span
                  className="absolute inset-x-0 top-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${a.color}, transparent)`,
                  }}
                />
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg leading-none">{a.emoji}</span>
                  <div className="min-w-0">
                    <div
                      className="font-display text-sm font-bold leading-tight"
                      style={{ color: a.color }}
                    >
                      {a.key}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-wider opacity-60 truncate">
                      {a.role}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mb-2 text-[10px] font-mono">
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ background: a.color }}
                  />
                  <span className="opacity-80">
                    {a.total > 0 ? 'Active' : 'Idle'}
                  </span>
                  <span className="opacity-30">·</span>
                  <span className="opacity-60">
                    {a.tasksToday} today · {a.total} total
                  </span>
                </div>
                <div className="text-[10px] uppercase tracking-wider opacity-50 font-mono mb-0.5">
                  Last task
                </div>
                <div className="text-xs leading-snug line-clamp-2 mb-1.5">
                  {a.last?.agent_name ? (
                    <>
                      <span className="opacity-90">
                        {(a.last as any).task_description ||
                          (a.last as any).agent_name ||
                          'Task'}
                      </span>
                    </>
                  ) : (
                    <span className="opacity-40 italic">No data yet</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono opacity-60">
                  <span>{a.last?.model_used ?? 'N/A'}</span>
                  <span>
                    {a.last
                      ? new Date(a.last.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── System Integrations — probed against filesystem + gateway ── */}
        {integrations.length > 0 ? (
          <section className="rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold">System Integrations</h2>
                <p className="text-[11px] mt-0.5 font-mono opacity-60">
                  Live state from /api/system-integrations · filesystem +
                  gateway probes · refreshes every 60s
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-mono opacity-60">
                {
                  integrations.filter(
                    (i) => i.state === 'online' || i.state === 'configured',
                  ).length
                }
                /{integrations.length} ready
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {integrations.map((i) => {
                const toneClass =
                  i.state === 'online'
                    ? 'text-emerald-400'
                    : i.state === 'configured'
                      ? 'text-emerald-400'
                      : i.state === 'not-configured'
                        ? 'text-amber-400'
                        : 'text-white/50'
                const dotColor =
                  i.state === 'online' || i.state === 'configured'
                    ? '#10b981'
                    : i.state === 'not-configured'
                      ? '#f59e0b'
                      : '#9ca3af'
                return (
                  <article
                    key={i.id}
                    className="relative rounded-xl border p-3 overflow-hidden"
                    style={{
                      boxShadow: `inset 0 0 0 1px ${i.color}30, 0 8px 20px -10px ${i.color}40`,
                    }}
                  >
                    <span
                      className="absolute inset-x-0 top-0 h-px"
                      style={{
                        background: `linear-gradient(90deg, transparent, ${i.color}, transparent)`,
                      }}
                    />
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div
                        className="font-display text-sm font-bold leading-tight"
                        style={{ color: i.color }}
                      >
                        {i.name}
                      </div>
                      <span
                        className="inline-block size-1.5 rounded-full shrink-0"
                        style={{ background: dotColor }}
                      />
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-wider opacity-60 mb-2">
                      {i.role}
                    </div>
                    <div
                      className={`text-[10px] font-mono uppercase tracking-wider mb-1.5 ${toneClass}`}
                    >
                      {i.state === 'not-configured'
                        ? 'Not configured'
                        : i.state}
                    </div>
                    <div className="text-[11px] leading-snug opacity-80 line-clamp-2">
                      {i.detail}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* ── Autonomy Loop control plane ─────────────────────────────── */}
        {autonomy ? (
          <section className="rounded-xl border p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold">
                  Autonomy Loop · Tier 1
                </h2>
                <p className="text-[11px] mt-0.5 font-mono opacity-60">
                  Picks command_center.todos → routes by category → dispatches
                  to OpenClaw agent · server-side 60s + CronCreate 10m heartbeat
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleManualTick()}
                disabled={tickPending}
                className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-md border border-[rgba(255,107,53,0.55)] bg-[rgba(255,107,53,0.18)] text-white hover:bg-[rgba(255,107,53,0.3)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {tickPending ? 'Ticking…' : 'Tick now'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="rounded-md border border-[rgba(170,178,195,0.25)] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
                  Status
                </div>
                <div
                  className={`text-sm font-display font-bold ${
                    autonomy.enabled ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {autonomy.enabled ? 'Auto · 60s' : 'Manual'}
                </div>
                <div className="text-[10px] font-mono opacity-50 mt-0.5">
                  {autonomy.enabled
                    ? 'setInterval active'
                    : 'cron heartbeat only'}
                </div>
              </div>
              <div className="rounded-md border border-[rgba(170,178,195,0.25)] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
                  Ticks
                </div>
                <div className="text-sm font-display font-bold">
                  {autonomy.totalTicks}
                </div>
                <div className="text-[10px] font-mono opacity-50 mt-0.5">
                  {autonomy.inflightCount} in-flight
                </div>
              </div>
              <div className="rounded-md border border-[rgba(170,178,195,0.25)] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
                  Dispatched
                </div>
                <div className="text-sm font-display font-bold text-emerald-400">
                  {autonomy.totalDispatched}
                </div>
                <div className="text-[10px] font-mono opacity-50 mt-0.5">
                  successes
                </div>
              </div>
              <div className="rounded-md border border-[rgba(170,178,195,0.25)] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
                  Failed
                </div>
                <div
                  className={`text-sm font-display font-bold ${
                    autonomy.totalFailed > 0
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {autonomy.totalFailed}
                </div>
                <div className="text-[10px] font-mono opacity-50 mt-0.5">
                  errors
                </div>
              </div>
            </div>
            <div className="text-[10px] uppercase tracking-wider opacity-50 mb-1 font-mono">
              Last tick
            </div>
            <div className="text-xs opacity-90">
              {autonomy.lastTickAt === 0 ? (
                <span className="italic opacity-50">
                  Never — press Tick now or wait for the next cron fire
                </span>
              ) : (
                <>
                  <span className="font-mono opacity-60">
                    {new Date(autonomy.lastTickAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="mx-2 opacity-30">·</span>
                  {autonomy.lastTickResult &&
                  'picked' in autonomy.lastTickResult &&
                  autonomy.lastTickResult.picked ? (
                    <>
                      <span
                        className={
                          autonomy.lastTickResult.picked.status === 'completed'
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }
                      >
                        {autonomy.lastTickResult.picked.status}
                      </span>
                      <span className="mx-2 opacity-30">·</span>
                      <span className="opacity-80">
                        {autonomy.lastTickResult.picked.title}
                      </span>
                      <span className="opacity-40">
                        {' '}
                        →{' '}
                        <code className="font-mono">
                          {autonomy.lastTickResult.picked.agent}
                        </code>
                      </span>
                    </>
                  ) : autonomy.lastTickResult &&
                    'reason' in autonomy.lastTickResult ? (
                    <span className="opacity-50 italic">queue empty</span>
                  ) : autonomy.lastTickResult &&
                    'error' in autonomy.lastTickResult ? (
                    <span className="text-red-400">
                      error: {autonomy.lastTickResult.error}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Top Agents · all-time</h2>
              <span className="text-[11px] font-mono text-primary-700 dark:text-primary-800">
                {Object.keys(agentCounts).length} unique
              </span>
            </div>
            {topAgents.length > 0 ? (
              <BarList items={topAgents} />
            ) : (
              <div className="text-sm text-primary-700 dark:text-primary-800 italic py-4">
                No agent runs logged yet.
              </div>
            )}
          </div>

          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Tasks by Category</h2>
              <span className="text-[11px] font-mono text-primary-700 dark:text-primary-800">
                4-way split
              </span>
            </div>
            {topCategories.length > 0 ? (
              <BarList items={topCategories} color="#FF9F1C" />
            ) : (
              <div className="text-sm text-primary-700 dark:text-primary-800 italic py-4">
                No tasks yet.
              </div>
            )}
          </div>
        </section>

        <section className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Recent Agent Activity</h2>
            <span className="text-[11px] font-mono text-primary-700 dark:text-primary-800">
              last 8 events
            </span>
          </div>
          {recentActivity.length > 0 ? (
            <ul className="space-y-2">
              {recentActivity.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
                >
                  <StatusDot
                    tone={
                      l.status === 'completed'
                        ? 'live'
                        : l.status === 'failed'
                          ? 'down'
                          : l.status === 'in_progress'
                            ? 'warn'
                            : 'idle'
                    }
                    pulse={l.status === 'in_progress'}
                  />
                  <span className="text-sm font-medium font-mono shrink-0 w-20 truncate">
                    {l.agent_name}
                  </span>
                  <span className="text-xs text-primary-700 dark:text-primary-800 truncate flex-1">
                    {l.model_used ?? 'unknown model'}
                  </span>
                  <span className="text-[10px] font-mono text-primary-700 dark:text-primary-800 shrink-0">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-primary-700 dark:text-primary-800 italic py-4">
              No recent activity. Agent runs will surface here as they happen.
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Callout tone="pulse" title="What this surface shows">
            Live data from{' '}
            <span className="font-mono text-accent-400">
              command_center.todos
            </span>{' '}
            and{' '}
            <span className="font-mono text-accent-400">
              command_center.agent_logs
            </span>
            . All metrics derived from real Supabase rows — no mock data, honest
            emptiness when a series has no entries.
          </Callout>
          <Callout tone="success" title="Command Center kit installed">
            8 vendored components live: KpiCard, SparkArea, StatusDot,
            BadgeDelta, Tracker, BarList, Callout, DonutGauge. Drop them into
            any PulseOS widget for the Command Center look. Bricolage Grotesque
            + Inter + JetBrains Mono self-hosted via @fontsource-variable.
          </Callout>
        </section>

        <footer className="pt-2 pb-6 text-[11px] text-primary-700 dark:text-primary-800 flex items-center justify-between font-mono">
          <span>
            PulseCheck AI · Command Center · v1.0.0 · Source:{' '}
            <span className="text-accent-400">command_center</span> (Supabase)
          </span>
          <span>build 2026-05-14 · {now.toISOString().slice(0, 10)}</span>
        </footer>
      </div>
    </div>
  )
}
