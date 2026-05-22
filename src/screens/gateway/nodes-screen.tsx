// Nodes — Mission Control palette pass (2026-05-19)
//
// Visual harmonization with /ops, /linkedin, /postiz. Same `useQuery` data
// hook against /api/gateway/nodes, same NodeEntry shape. Adds:
//   - NodesStatusBar : monospace header with phase + metric chips
//   - KpiTile row    : Online / Idle / Errored / Total
//   - FilterChip row : All / Online / Idle / Errored
//   - NodeCard       : status pulse + name + last-seen + platform/version chips
//
// Real-data-or-`—`-only: every metric falls back to '—' when unknown.
// No CPU/mem/load is fabricated — only fields actually returned by the API.

import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertDiamondIcon,
  ArrowTurnBackwardIcon,
  ServerStack01Icon,
  Activity01Icon,
} from '@hugeicons/core-free-icons'

type NodeEntry = {
  id?: string
  name?: string
  platform?: string
  status?: string
  lastSeen?: number
  version?: string
}

type NodesData = {
  nodes?: NodeEntry[]
}

type NodeFilter = 'all' | 'online' | 'idle' | 'errored'
type KpiAccent = 'emerald' | 'amber' | 'rose' | 'cyan'

function timeAgo(ts?: number) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── status taxonomy ────────────────────────────────────────────────────────
//
// Real API can return: 'online' | 'offline' | 'idle' | 'error' | undefined.
// We collapse to three buckets so the UI stays consistent regardless of
// upstream label drift.

type StatusBucket = 'online' | 'idle' | 'errored'

function bucketFor(status?: string): StatusBucket {
  const s = (status || '').toLowerCase()
  if (s === 'error' || s === 'errored' || s === 'failed') return 'errored'
  if (s === 'online' || s === 'active' || s === 'connected') return 'online'
  return 'idle'
}

function statusTokens(bucket: StatusBucket) {
  if (bucket === 'errored') {
    return {
      dot: 'var(--mc-rose)',
      dotSoft: 'var(--mc-rose-soft)',
      label: 'Errored',
      pulse: false,
    }
  }
  if (bucket === 'online') {
    return {
      dot: 'var(--mc-cyan)',
      dotSoft: 'var(--mc-cyan-soft)',
      label: 'Online',
      pulse: true,
    }
  }
  return {
    dot: 'var(--mc-amber)',
    dotSoft: 'var(--mc-amber-soft)',
    label: 'Idle',
    pulse: false,
  }
}

// ─── small UI helpers (mirror operations-screen patterns) ───────────────────

function MetricChip({
  label,
  value,
  accent = 'cyan',
}: {
  label: string
  value: ReactNode
  accent?: 'cyan' | 'emerald' | 'amber' | 'magenta' | 'rose'
}) {
  const accentVar =
    accent === 'emerald'
      ? 'var(--mc-emerald)'
      : accent === 'amber'
        ? 'var(--mc-amber)'
        : accent === 'magenta'
          ? 'var(--mc-magenta)'
          : accent === 'rose'
            ? 'var(--mc-rose)'
            : 'var(--mc-cyan)'
  return (
    <div
      className="flex items-baseline gap-2 rounded-md border px-3 py-1.5 font-mono text-[11px] tracking-wide"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
        color: 'var(--mc-text-dim)',
      }}
    >
      <span className="uppercase">{label}</span>
      <span
        style={{ color: accentVar }}
        className="text-[13px] font-semibold tabular-nums"
      >
        {value}
      </span>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="font-mono text-[11px] uppercase tracking-[0.18em]"
      style={{ color: 'var(--mc-text-dimmer)' }}
    >
      {children}
    </p>
  )
}

function NodesStatusBar({
  total,
  online,
  errored,
  isLoading,
  error,
}: {
  total: number
  online: number
  errored: number
  isLoading: boolean
  error: string | null
}) {
  const phaseLabel = error
    ? 'ERROR'
    : isLoading
      ? 'LOADING'
      : errored > 0
        ? 'DEGRADED'
        : total === 0
          ? 'IDLE'
          : 'NOMINAL'
  const phaseAccent: 'cyan' | 'emerald' | 'amber' | 'magenta' | 'rose' = error
    ? 'magenta'
    : isLoading
      ? 'amber'
      : errored > 0
        ? 'rose'
        : total === 0
          ? 'amber'
          : 'emerald'
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 font-mono"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
      }}
    >
      <div className="flex items-center gap-2 pr-3">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 items-center justify-center rounded border"
          style={{
            borderColor: 'var(--mc-border-bright)',
            background: 'var(--mc-cyan-soft)',
            color: 'var(--mc-cyan)',
          }}
        >
          <HugeiconsIcon icon={ServerStack01Icon} size={14} strokeWidth={1.8} />
        </span>
        <div className="leading-tight">
          <p
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--mc-text-dimmer)' }}
          >
            Nodes · /nodes
          </p>
          <p className="text-[12px]" style={{ color: 'var(--mc-text)' }}>
            Paired devices · gateway fleet
          </p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <MetricChip label="Phase" value={phaseLabel} accent={phaseAccent} />
        <MetricChip
          label="Total"
          value={isLoading ? '—' : total || '—'}
          accent="cyan"
        />
        <MetricChip
          label="Online"
          value={isLoading ? '—' : online || '—'}
          accent="emerald"
        />
        <MetricChip
          label="Errored"
          value={isLoading ? '—' : errored || '—'}
          accent={errored > 0 ? 'rose' : 'cyan'}
        />
      </div>
    </div>
  )
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent: KpiAccent
}) {
  const accentVar =
    accent === 'emerald'
      ? 'var(--mc-emerald)'
      : accent === 'amber'
        ? 'var(--mc-amber)'
        : accent === 'rose'
          ? 'var(--mc-rose)'
          : 'var(--mc-cyan)'
  const accentSoft =
    accent === 'emerald'
      ? 'var(--mc-emerald-soft)'
      : accent === 'amber'
        ? 'var(--mc-amber-soft)'
        : accent === 'rose'
          ? 'var(--mc-rose-soft)'
          : 'var(--mc-cyan-soft)'
  return (
    <div
      className="relative overflow-hidden rounded-lg border px-4 py-3"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accentVar }}
      />
      <div className="flex items-baseline justify-between gap-2">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: 'var(--mc-text-dimmer)' }}
        >
          {label}
        </p>
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: accentVar, boxShadow: `0 0 6px ${accentSoft}` }}
        />
      </div>
      <p
        className="mt-1 font-mono text-2xl font-semibold tabular-nums"
        style={{ color: accentVar }}
      >
        {value}
      </p>
      {sub ? (
        <p
          className="mt-0.5 truncate text-[11px]"
          style={{ color: 'var(--mc-text-dim)' }}
        >
          {sub}
        </p>
      ) : null}
    </div>
  )
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  accent = 'cyan',
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  accent?: KpiAccent
}) {
  const accentVar =
    accent === 'emerald'
      ? 'var(--mc-emerald)'
      : accent === 'amber'
        ? 'var(--mc-amber)'
        : accent === 'rose'
          ? 'var(--mc-rose)'
          : 'var(--mc-cyan)'
  const accentSoft =
    accent === 'emerald'
      ? 'var(--mc-emerald-soft)'
      : accent === 'amber'
        ? 'var(--mc-amber-soft)'
        : accent === 'rose'
          ? 'var(--mc-rose-soft)'
          : 'var(--mc-cyan-soft)'
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background: active ? accentSoft : 'transparent',
        color: active ? accentVar : 'var(--mc-text-dim)',
        ['--tw-ring-color' as string]: accentVar,
        ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
      }}
      aria-pressed={active}
    >
      {label}
      <span
        className="inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-1 text-[10px] tabular-nums"
        style={{
          background: active ? 'var(--mc-surface)' : 'var(--mc-surface-2)',
          color: active ? accentVar : 'var(--mc-text-dimmer)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

function NodeCard({ node, index }: { node: NodeEntry; index: number }) {
  const bucket = bucketFor(node.status)
  const tokens = statusTokens(bucket)
  const displayName = node.name || node.id || `Node ${index + 1}`
  return (
    <article
      className="motion-reduce:[animation:none] relative flex flex-col rounded-lg border p-4 transition-colors"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
        animation: 'mc-event-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both',
        animationDelay: `${Math.min(index * 30, 240)}ms`,
      }}
    >
      {/* status accent rail */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg"
        style={{ background: tokens.dot }}
      />

      {/* header: status pulse + name + bucket label */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="relative inline-flex h-2.5 w-2.5 shrink-0"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background: tokens.dot,
                boxShadow: `0 0 8px ${tokens.dotSoft}`,
              }}
            />
            {tokens.pulse ? (
              <span
                className="absolute inset-0 inline-block rounded-full motion-reduce:[animation:none]"
                style={{
                  background: tokens.dot,
                  animation: 'mc-pulse 1.8s ease-in-out infinite',
                  opacity: 0.6,
                }}
              />
            ) : null}
          </span>
          <div className="min-w-0">
            <p
              className="truncate text-sm font-semibold"
              style={{ color: 'var(--mc-text)' }}
              title={displayName}
            >
              {displayName}
            </p>
            {node.id && node.id !== displayName ? (
              <p
                className="truncate font-mono text-[11px]"
                style={{ color: 'var(--mc-text-dimmer)' }}
                title={node.id}
              >
                {node.id}
              </p>
            ) : null}
          </div>
        </div>
        <span
          className="shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
          style={{
            borderColor: tokens.dot,
            background: tokens.dotSoft,
            color: tokens.dot,
          }}
        >
          {tokens.label}
        </span>
      </div>

      {/* metric chips — only real fields */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span
          className="inline-flex items-baseline gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text-dim)',
          }}
        >
          <span>Platform</span>
          <span
            className="text-[11px] normal-case"
            style={{ color: 'var(--mc-text)' }}
          >
            {node.platform || '—'}
          </span>
        </span>
        <span
          className="inline-flex items-baseline gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text-dim)',
          }}
        >
          <span>Version</span>
          <span
            className="text-[11px] normal-case"
            style={{ color: 'var(--mc-text)' }}
          >
            {node.version || '—'}
          </span>
        </span>
      </div>

      {/* footer: last-seen timestamp */}
      <div
        className="mt-3 flex items-center justify-between gap-2 border-t pt-2 font-mono text-[10px] uppercase tracking-wider"
        style={{
          borderColor: 'var(--mc-border)',
          color: 'var(--mc-text-dimmer)',
        }}
      >
        <span>Last seen</span>
        <span style={{ color: 'var(--mc-text-dim)' }} className="normal-case">
          {timeAgo(node.lastSeen)}
        </span>
      </div>
    </article>
  )
}

// ─── screen ────────────────────────────────────────────────────────────────

export function NodesScreen() {
  const query = useQuery({
    queryKey: ['gateway', 'nodes'],
    queryFn: async () => {
      const res = await fetch('/api/gateway/nodes')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Gateway error')
      return json.data as NodesData
    },
    refetchInterval: 15_000,
    retry: 1,
  })

  const nodes = query.data?.nodes || []
  const lastUpdated = query.dataUpdatedAt
    ? new Date(query.dataUpdatedAt).toLocaleTimeString()
    : null

  const totalCount = nodes.length
  const onlineCount = nodes.filter(
    (n) => bucketFor(n.status) === 'online',
  ).length
  const erroredCount = nodes.filter(
    (n) => bucketFor(n.status) === 'errored',
  ).length
  const idleCount = Math.max(0, totalCount - onlineCount - erroredCount)

  const [filter, setFilter] = useState<NodeFilter>('all')
  const filteredNodes = nodes.filter((n) => {
    if (filter === 'all') return true
    return bucketFor(n.status) === filter
  })

  const isLoading = query.isLoading
  const error = query.isError
    ? query.error instanceof Error
      ? query.error.message
      : 'Failed to fetch'
    : null

  return (
    <main
      className="relative min-h-full px-3 pb-24 pt-5 md:px-5 md:pt-8"
      style={{
        background:
          'radial-gradient(ellipse at top, rgba(0,229,255,0.05) 0%, transparent 60%), var(--mc-bg)',
        color: 'var(--mc-text)',
      }}
    >
      {/* keyframes (reused from conductor-mission-control) */}
      <style>{`
        @keyframes mc-event-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes mc-breathe {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @keyframes mc-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>

      <section className="mx-auto w-full max-w-[1560px] space-y-4">
        {/* status bar */}
        <NodesStatusBar
          total={totalCount}
          online={onlineCount}
          errored={erroredCount}
          isLoading={isLoading}
          error={error}
        />

        {/* sync hint */}
        {(query.isFetching && !isLoading) || lastUpdated ? (
          <div
            className="flex items-center justify-end gap-3 font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: 'var(--mc-text-dimmer)' }}
          >
            {query.isFetching && !isLoading ? (
              <span
                style={{ animation: 'mc-breathe 1.6s ease-in-out infinite' }}
              >
                Syncing…
              </span>
            ) : null}
            {lastUpdated ? <span>Updated {lastUpdated}</span> : null}
          </div>
        ) : null}

        {isLoading ? (
          <section
            className="rounded-lg border px-6 py-12 text-center font-mono text-xs uppercase tracking-wider"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-surface)',
              color: 'var(--mc-text-dim)',
            }}
          >
            <span style={{ animation: 'mc-breathe 1.6s ease-in-out infinite' }}>
              Connecting to gateway…
            </span>
          </section>
        ) : error ? (
          <section
            className="flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center text-sm"
            style={{
              borderColor: 'var(--mc-rose)',
              background: 'var(--mc-rose-soft)',
              color: 'var(--mc-text)',
            }}
          >
            <HugeiconsIcon
              icon={AlertDiamondIcon}
              size={22}
              strokeWidth={1.5}
              style={{ color: 'var(--mc-rose)' }}
            />
            <span
              className="font-mono text-[11px] uppercase tracking-[0.2em]"
              style={{ color: 'var(--mc-rose)' }}
            >
              ERROR · {error}
            </span>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                borderColor: 'var(--mc-border-bright)',
                background: 'var(--mc-surface)',
                color: 'var(--mc-cyan)',
                ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
              }}
            >
              <HugeiconsIcon
                icon={ArrowTurnBackwardIcon}
                size={12}
                strokeWidth={1.8}
              />
              Retry
            </button>
          </section>
        ) : (
          <>
            {/* KPI tiles */}
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <KpiTile
                label="Online"
                value={isLoading ? '—' : onlineCount || '—'}
                sub={
                  onlineCount === 0
                    ? 'no live nodes'
                    : `of ${totalCount} paired`
                }
                accent="emerald"
              />
              <KpiTile
                label="Idle"
                value={isLoading ? '—' : idleCount || '—'}
                sub={idleCount === 0 ? 'all engaged' : 'standby pool'}
                accent="amber"
              />
              <KpiTile
                label="Errored"
                value={isLoading ? '—' : erroredCount || '—'}
                sub={erroredCount === 0 ? 'clean' : 'needs attention'}
                accent="rose"
              />
              <KpiTile
                label="Total"
                value={isLoading ? '—' : totalCount || '—'}
                sub={totalCount === 0 ? 'no roster yet' : 'paired devices'}
                accent="cyan"
              />
            </section>

            {/* roster header + filter row */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionLabel>
                  <HugeiconsIcon
                    icon={Activity01Icon}
                    size={11}
                    strokeWidth={2}
                    className="mr-1.5 inline-block align-[-1px]"
                  />
                  Roster · {filteredNodes.length}
                  {filter !== 'all' ? `/${totalCount || '—'}` : ''}
                </SectionLabel>
                <div
                  className="inline-flex flex-wrap items-center gap-1 rounded-md border p-0.5"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                  }}
                  role="toolbar"
                  aria-label="Node filter"
                >
                  <FilterChip
                    label="All"
                    count={totalCount}
                    active={filter === 'all'}
                    onClick={() => setFilter('all')}
                  />
                  <FilterChip
                    label="Online"
                    count={onlineCount}
                    active={filter === 'online'}
                    onClick={() => setFilter('online')}
                    accent="emerald"
                  />
                  <FilterChip
                    label="Idle"
                    count={idleCount}
                    active={filter === 'idle'}
                    onClick={() => setFilter('idle')}
                    accent="amber"
                  />
                  <FilterChip
                    label="Errored"
                    count={erroredCount}
                    active={filter === 'errored'}
                    onClick={() => setFilter('errored')}
                    accent="rose"
                  />
                </div>
              </div>

              {/* roster grid / empty states */}
              {totalCount === 0 ? (
                <div
                  className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border"
                    style={{
                      borderColor: 'var(--mc-border-bright)',
                      background: 'var(--mc-cyan-soft)',
                      color: 'var(--mc-cyan)',
                    }}
                  >
                    <HugeiconsIcon
                      icon={ServerStack01Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                  </span>
                  <p
                    className="font-mono text-[11px] uppercase tracking-[0.2em]"
                    style={{ color: 'var(--mc-text)' }}
                  >
                    No nodes paired
                  </p>
                  <p
                    className="max-w-sm text-xs"
                    style={{ color: 'var(--mc-text-dim)' }}
                  >
                    Pair a device to extend your AI capabilities. — — —
                  </p>
                </div>
              ) : filteredNodes.length === 0 ? (
                <div
                  className="rounded-md border border-dashed px-4 py-8 text-center font-mono text-[11px] uppercase tracking-wider"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                    color: 'var(--mc-text-dimmer)',
                  }}
                >
                  No nodes match this filter
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredNodes.map((node, i) => (
                    <NodeCard
                      key={node.id || `${i}-${node.name || 'node'}`}
                      node={node}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
