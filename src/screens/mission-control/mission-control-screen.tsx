import { useEffect, useState } from 'react'
import {
  KpiCard,
  StatusDot,
  BadgeDelta,
  Tracker,
  BarList,
  Callout,
  DonutGauge,
  PulseLogo,
  type TrackerCell,
  type BarListItem,
} from '@/components/mission-control'

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

export function MissionControlScreen() {
  const [todos, setTodos] = useState<Array<Todo>>([])
  const [logs, setLogs] = useState<Array<AgentLog>>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    Promise.all([
      supabaseGet<Todo>('todos?select=*&order=created_at.desc&limit=200'),
      supabaseGet<AgentLog>(
        'agent_logs?select=*&order=created_at.desc&limit=200',
      ),
    ])
      .then(([t, l]) => {
        setTodos(t)
        setLogs(l)
      })
      .catch((e) => setLoadErr(e.message))
  }, [])

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
      <header className="glass-bar sticky top-0 z-30 px-8 pt-6 pb-4 flex items-center justify-between gap-6 border-b border-primary-200 dark:border-primary-400">
        <div className="flex items-center gap-3">
          <PulseLogo size={40} variant="gradient" glow />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Mission Control
            </h1>
            <p className="text-xs text-primary-700 dark:text-primary-800 mt-1 font-mono">
              PulseCheck AI <span className="mx-1">›</span> Mission Control
              <span className="mx-2">·</span>
              <span className="pulse-text font-semibold">Live</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary-100 dark:bg-primary-200 border border-primary-300">
            <StatusDot tone="live" />
            <span className="font-mono">Supabase command_center</span>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary-100 dark:bg-primary-200 border border-primary-300 font-mono">
            {now.toLocaleTimeString()}
          </div>
        </div>
      </header>

      <div className="px-8 py-6 space-y-6 max-w-[1500px]">
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
                  className="flex items-start gap-3 px-3 py-2 rounded-md bg-primary-100/40 dark:bg-primary-200/40"
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
            failures. Mission Control is clear.
          </Callout>
        )}

        {/* ── Activity tracker — what changed over 30 days ── */}
        <section className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Activity · 30 days</h2>
              <p className="text-xs text-primary-700 dark:text-primary-800 mt-0.5 font-mono">
                task + agent_log creation per day
              </p>
            </div>
            <BadgeDelta
              value={`${totalTasks + logs.length} total`}
              tone="neutral"
            />
          </div>
          <Tracker cells={trackerCells} cellWidth={12} cellHeight={36} />
          <div className="mt-4 pt-4 border-t border-primary-200 dark:border-primary-600 flex items-center justify-between text-[11px] font-mono text-primary-700 dark:text-primary-800">
            <span>30 days ago</span>
            <span>today</span>
          </div>
        </section>

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
                  className="flex items-center gap-3 px-3 py-2 rounded-md bg-primary-100 dark:bg-primary-200 hover:bg-primary-200 dark:hover:bg-primary-300 transition-colors"
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
          <Callout tone="success" title="Mission Control kit installed">
            8 vendored components live: KpiCard, SparkArea, StatusDot,
            BadgeDelta, Tracker, BarList, Callout, DonutGauge. Drop them into
            any ClawSuite widget for the Mission Control look. Bricolage
            Grotesque + Inter + JetBrains Mono self-hosted via
            @fontsource-variable.
          </Callout>
        </section>

        <footer className="pt-2 pb-6 text-[11px] text-primary-700 dark:text-primary-800 flex items-center justify-between font-mono">
          <span>
            PulseCheck AI · Mission Control · v1.0.0 · Source:{' '}
            <span className="text-accent-400">command_center</span> (Supabase)
          </span>
          <span>build 2026-05-14 · {now.toISOString().slice(0, 10)}</span>
        </footer>
      </div>
    </div>
  )
}
