// Operations — Mission Control palette pass (2026-05-19)
//
// Visual harmonization with /conductor (conductor-mission-control.tsx).
// Same `useOperations` data hook, same modals, same OrchestratorCard +
// OperationsAgentCard children. The screen swaps THEME_STYLE → MC_STYLE
// and additionally SHIMS the legacy --theme-* tokens to MC palette values
// so sibling components inherit the new look without per-file edits.
//
// New surface elements written here:
//   - OpsStatusBar  : MetricStrip-style header with real counts (— when empty)
//   - MetricChip    : single chip used by the bar
//   - SectionLabel  : monospace section title
//   - ActivityRow   : ActivityStream-style recent-activity row
//
// No mock data: every metric falls back to '—' or honest empty-state.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Activity01Icon,
  AiBrain03Icon,
  Clock01Icon,
  CommandLineIcon,
  CpuIcon,
  PlusSignIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/screens/dashboard/lib/formatters'
import { seedAgentPresets } from './agent-presets'
import { OrchestratorCard } from './components/orchestrator-card'
import { OperationsAgentCard } from './components/operations-agent-card'
import { OperationsAgentDetail } from './components/operations-agent-detail'
import { OperationsNewAgentModal } from './components/operations-new-agent-modal'
import { OperationsSettingsModal } from './components/operations-settings-modal'
import { FullOutputsView } from './components/full-outputs-view'
import { useOperations } from './hooks/use-operations'

// ─── tokens ────────────────────────────────────────────────────────────────
//
// Native MC tokens (--mc-*) are used by new JSX in this file. Legacy
// --theme-* tokens are remapped to MC values so existing sibling
// components (OrchestratorCard, OperationsAgentCard, modals, etc.) inherit
// the new palette without requiring per-file edits.

export const MC_STYLE: CSSProperties = {
  // Native MC tokens (mirror conductor-mission-control.tsx)
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
  // Legacy --theme-* shim → MC values (children inherit, no per-file edits)
  ['--theme-bg' as string]: '#070A11',
  ['--theme-card' as string]: '#0D131D',
  ['--theme-card2' as string]: 'rgba(18, 25, 38, 0.5)',
  ['--theme-border' as string]: 'rgba(0, 229, 255, 0.10)',
  ['--theme-border2' as string]: 'rgba(0, 229, 255, 0.32)',
  ['--theme-text' as string]: '#E6F1FF',
  ['--theme-muted' as string]: '#8FA3BF',
  ['--theme-muted-2' as string]: '#7A8FA8',
  ['--theme-accent' as string]: '#00E5FF',
  ['--theme-accent-strong' as string]: '#3DF5A1',
  ['--theme-accent-soft' as string]: 'rgba(0, 229, 255, 0.12)',
  ['--theme-accent-soft-strong' as string]: 'rgba(0, 229, 255, 0.18)',
  ['--theme-shadow' as string]: 'rgba(0, 0, 0, 0.5)',
  ['--theme-danger' as string]: '#FF6B8B',
  ['--theme-danger-soft' as string]: 'rgba(255, 107, 139, 0.14)',
  ['--theme-danger-soft-strong' as string]: 'rgba(255, 107, 139, 0.22)',
  ['--theme-danger-border' as string]: 'rgba(255, 107, 139, 0.35)',
  ['--theme-warning' as string]: '#FFB547',
  ['--theme-warning-soft' as string]: 'rgba(255, 181, 71, 0.14)',
  ['--theme-warning-soft-strong' as string]: 'rgba(255, 181, 71, 0.22)',
  ['--theme-warning-border' as string]: 'rgba(255, 181, 71, 0.35)',
}

// Back-compat alias — anything still importing THEME_STYLE keeps working.
export const THEME_STYLE = MC_STYLE

// ─── small UI helpers ──────────────────────────────────────────────────────

function MetricChip({
  label,
  value,
  accent = 'cyan',
}: {
  label: string
  value: ReactNode
  accent?: 'cyan' | 'emerald' | 'amber' | 'magenta'
}) {
  const accentVar =
    accent === 'emerald'
      ? 'var(--mc-emerald)'
      : accent === 'amber'
        ? 'var(--mc-amber)'
        : accent === 'magenta'
          ? 'var(--mc-magenta)'
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

function ActivityRow({
  emoji,
  agentName,
  summary,
  timestamp,
  delayMs,
}: {
  emoji: string
  agentName: string
  summary: string
  timestamp: number
  delayMs: number
}) {
  return (
    <div
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2 font-mono text-xs motion-reduce:[animation:none]"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface-2)',
        animation: 'mc-event-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        animationDelay: `${delayMs}ms`,
      }}
    >
      <span
        className="inline-flex h-6 min-w-[44px] items-center justify-center rounded border px-1.5 text-[10px] uppercase tracking-wider"
        style={{
          borderColor: 'var(--mc-border)',
          color: 'var(--mc-cyan)',
          background: 'var(--mc-cyan-soft)',
        }}
        aria-hidden="true"
      >
        <span aria-hidden="true">{emoji}</span>
      </span>
      <p className="min-w-0 truncate" style={{ color: 'var(--mc-text)' }}>
        <span style={{ color: 'var(--mc-cyan)' }} className="font-semibold">
          {agentName}
        </span>
        <span style={{ color: 'var(--mc-text-dim)' }}> · {summary}</span>
      </p>
      <span
        style={{ color: 'var(--mc-text-dimmer)' }}
        className="shrink-0 text-[11px]"
      >
        {formatRelativeTime(timestamp)}
      </span>
    </div>
  )
}

function OpsStatusBar({
  activeCount,
  totalCount,
  recentCount,
  isLoading,
  error,
}: {
  activeCount: number
  totalCount: number
  recentCount: number
  isLoading: boolean
  error: string | null
}) {
  const phaseLabel = error ? 'ERROR' : isLoading ? 'LOADING' : 'NOMINAL'
  const phaseAccent: 'cyan' | 'emerald' | 'amber' | 'magenta' = error
    ? 'magenta'
    : isLoading
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
          <HugeiconsIcon icon={CpuIcon} size={14} strokeWidth={1.8} />
        </span>
        <div className="leading-tight">
          <p
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--mc-text-dimmer)' }}
          >
            Operations · /ops
          </p>
          <p className="text-[12px]" style={{ color: 'var(--mc-text)' }}>
            Persistent agent team
          </p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <MetricChip label="Phase" value={phaseLabel} accent={phaseAccent} />
        <MetricChip
          label="Active"
          value={isLoading ? '—' : `${activeCount}/${totalCount || '—'}`}
          accent="emerald"
        />
        <MetricChip
          label="Activity"
          value={isLoading ? '—' : recentCount || '—'}
          accent="cyan"
        />
      </div>
    </div>
  )
}

type AgentFilter = 'all' | 'active' | 'idle' | 'errors'
type KpiAccent = 'emerald' | 'amber' | 'rose' | 'cyan'

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

// ─── screen ────────────────────────────────────────────────────────────────

export function OperationsScreen() {
  useEffect(() => {
    seedAgentPresets()
  }, [])

  const [newAgentOpen, setNewAgentOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null)
  const [view, setView] = useState<'overview' | 'outputs'>('overview')

  const {
    agents,
    recentActivity,
    configQuery,
    sessionsQuery,
    cronJobsQuery,
    settings,
    saveSettings,
    defaultModel,
    createAgent,
    isCreatingAgent,
    saveAgent,
    isSavingAgent,
    deleteAgent,
    isDeletingAgent,
  } = useOperations()

  const isLoading =
    configQuery.isPending || sessionsQuery.isPending || cronJobsQuery.isPending
  const error =
    (configQuery.error instanceof Error && configQuery.error.message) ||
    (sessionsQuery.error instanceof Error && sessionsQuery.error.message) ||
    (cronJobsQuery.error instanceof Error && cronJobsQuery.error.message) ||
    null
  const settingsAgent =
    agents.find((agent) => agent.id === settingsAgentId) ?? null

  const activeCount = agents.filter((a) => a.status === 'active').length
  const errorCount = agents.filter((a) => a.status === 'error').length
  const totalCount = agents.length
  const idleCount = Math.max(0, totalCount - activeCount - errorCount)
  const cronCount = agents.reduce((acc, a) => acc + a.jobs.length, 0)
  const recentCount = recentActivity.length

  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const filteredAgents = agents.filter((a) => {
    if (agentFilter === 'all') return true
    if (agentFilter === 'active') return a.status === 'active'
    if (agentFilter === 'errors') return a.status === 'error'
    return a.status !== 'active' && a.status !== 'error'
  })

  return (
    <main
      className="relative min-h-full px-3 pb-24 pt-5 md:px-5 md:pt-8"
      style={{
        ...MC_STYLE,
        background:
          'radial-gradient(ellipse at top, rgba(0,229,255,0.05) 0%, transparent 60%), var(--mc-bg)',
        color: 'var(--mc-text)',
      }}
    >
      {/* keyframes — reused from conductor-mission-control */}
      <style>{`
        @keyframes mc-event-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes mc-breathe {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>

      <section className="mx-auto w-full max-w-[1560px] space-y-4">
        {/* status bar */}
        <OpsStatusBar
          activeCount={activeCount}
          totalCount={totalCount}
          recentCount={recentCount}
          isLoading={isLoading}
          error={error}
        />

        {/* action row */}
        <header
          className="flex flex-col gap-3 rounded-lg border px-4 py-3 md:flex-row md:items-center md:justify-between"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface)',
          }}
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border"
              style={{
                borderColor: 'var(--mc-border-bright)',
                background: 'var(--mc-magenta-soft)',
                color: 'var(--mc-magenta)',
              }}
            >
              <HugeiconsIcon icon={AiBrain03Icon} size={18} strokeWidth={1.8} />
            </span>
            <div>
              <h1
                className="font-mono text-sm font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--mc-text)' }}
              >
                Operations
              </h1>
              <p className="text-xs" style={{ color: 'var(--mc-text-dim)' }}>
                Persistent agent team · live roster
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-md border p-0.5"
              style={{
                borderColor: 'var(--mc-border)',
                background: 'var(--mc-surface-2)',
              }}
            >
              <button
                type="button"
                onClick={() => setView('overview')}
                className={cn(
                  'rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                )}
                style={{
                  background:
                    view === 'overview' ? 'var(--mc-cyan-soft)' : 'transparent',
                  color:
                    view === 'overview'
                      ? 'var(--mc-cyan)'
                      : 'var(--mc-text-dim)',
                  ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                  ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
                }}
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => setView('outputs')}
                className={cn(
                  'rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                )}
                style={{
                  background:
                    view === 'outputs' ? 'var(--mc-cyan-soft)' : 'transparent',
                  color:
                    view === 'outputs'
                      ? 'var(--mc-cyan)'
                      : 'var(--mc-text-dim)',
                  ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                  ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
                }}
              >
                Outputs
              </button>
            </div>
            <Button
              className="font-mono text-[11px] uppercase tracking-wider"
              onClick={() => setNewAgentOpen(true)}
              style={{
                background: 'var(--mc-cyan)',
                color: 'var(--mc-bg)',
                border: '1px solid var(--mc-cyan)',
              }}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.8} />
              New Agent
            </Button>
            <Button
              variant="secondary"
              className="font-mono text-[11px] uppercase tracking-wider"
              onClick={() => setSettingsOpen(true)}
              style={{
                background: 'var(--mc-surface)',
                color: 'var(--mc-text)',
                border: '1px solid var(--mc-border)',
              }}
            >
              <HugeiconsIcon
                icon={Settings01Icon}
                size={14}
                strokeWidth={1.8}
              />
              Settings
            </Button>
          </div>
        </header>

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
              Loading Operations roster…
            </span>
          </section>
        ) : error ? (
          <section
            className="rounded-lg border px-6 py-12 text-center text-sm"
            style={{
              borderColor: 'var(--mc-rose)',
              background: 'var(--mc-rose-soft)',
              color: 'var(--mc-text)',
            }}
          >
            <span
              className="font-mono text-[11px] uppercase tracking-[0.2em]"
              style={{ color: 'var(--mc-rose)' }}
            >
              ERROR ·{' '}
            </span>
            {error}
          </section>
        ) : view === 'outputs' ? (
          <FullOutputsView />
        ) : (
          <>
            {/* hero — orchestrator card (legacy --theme-* shimmed via MC_STYLE) */}
            <OrchestratorCard totalAgents={totalCount} />

            {/* KPI tiles — high-level fleet readout */}
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <KpiTile
                label="Active"
                value={isLoading ? '—' : activeCount}
                sub={
                  totalCount > 0
                    ? `of ${totalCount} agent${totalCount === 1 ? '' : 's'}`
                    : 'no roster yet'
                }
                accent="emerald"
              />
              <KpiTile
                label="Idle"
                value={isLoading ? '—' : idleCount}
                sub={idleCount === 0 ? 'all engaged' : 'standby pool'}
                accent="amber"
              />
              <KpiTile
                label="Errors"
                value={isLoading ? '—' : errorCount}
                sub={errorCount === 0 ? 'clean' : 'needs attention'}
                accent="rose"
              />
              <KpiTile
                label="Cron Jobs"
                value={isLoading ? '—' : cronCount}
                sub={
                  cronCount === 0
                    ? 'no schedules'
                    : `across ${
                        agents.filter((a) => a.jobs.length > 0).length
                      } agent${
                        agents.filter((a) => a.jobs.length > 0).length === 1
                          ? ''
                          : 's'
                      }`
                }
                accent="cyan"
              />
            </section>

            {/* agent grid */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionLabel>
                  <HugeiconsIcon
                    icon={Activity01Icon}
                    size={11}
                    strokeWidth={2}
                    className="mr-1.5 inline-block align-[-1px]"
                  />
                  Roster · {filteredAgents.length}
                  {agentFilter !== 'all' ? `/${totalCount || '—'}` : ''}
                </SectionLabel>
                <div
                  className="inline-flex flex-wrap items-center gap-1 rounded-md border p-0.5"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                  }}
                  role="toolbar"
                  aria-label="Agent filter"
                >
                  <FilterChip
                    label="All"
                    count={totalCount}
                    active={agentFilter === 'all'}
                    onClick={() => setAgentFilter('all')}
                  />
                  <FilterChip
                    label="Active"
                    count={activeCount}
                    active={agentFilter === 'active'}
                    onClick={() => setAgentFilter('active')}
                    accent="emerald"
                  />
                  <FilterChip
                    label="Idle"
                    count={idleCount}
                    active={agentFilter === 'idle'}
                    onClick={() => setAgentFilter('idle')}
                    accent="amber"
                  />
                  <FilterChip
                    label="Errors"
                    count={errorCount}
                    active={agentFilter === 'errors'}
                    onClick={() => setAgentFilter('errors')}
                    accent="rose"
                  />
                </div>
              </div>
              {filteredAgents.length === 0 && agentFilter !== 'all' ? (
                <div
                  className="rounded-md border border-dashed px-4 py-8 text-center font-mono text-[11px] uppercase tracking-wider"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                    color: 'var(--mc-text-dimmer)',
                  }}
                >
                  No agents match this filter
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredAgents.map((agent) => (
                    <div
                      key={agent.id}
                      style={{
                        animation:
                          'mc-event-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both',
                      }}
                      className="motion-reduce:[animation:none]"
                    >
                      <OperationsAgentCard
                        agent={agent}
                        onOpenSettings={(agentId) =>
                          setSettingsAgentId(agentId)
                        }
                      />
                    </div>
                  ))}
                  {agentFilter === 'all' ? (
                    <button
                      type="button"
                      onClick={() => setNewAgentOpen(true)}
                      className="flex min-h-[19rem] flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      style={{
                        borderColor: 'var(--mc-border)',
                        background: 'var(--mc-surface-2)',
                        color: 'var(--mc-text-dim)',
                        ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                        ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
                      }}
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        size={28}
                        strokeWidth={1.6}
                        style={{ color: 'var(--mc-cyan)' }}
                      />
                      <span className="mt-2">Add Agent</span>
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            {/* recent activity — ActivityStream-style */}
            <section
              className="rounded-lg border p-4"
              style={{
                borderColor: 'var(--mc-border)',
                background: 'var(--mc-surface)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <SectionLabel>
                  <HugeiconsIcon
                    icon={CommandLineIcon}
                    size={11}
                    strokeWidth={2}
                    className="mr-1.5 inline-block align-[-1px]"
                  />
                  Activity Stream · live tail
                </SectionLabel>
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--mc-text-dimmer)' }}
                >
                  <HugeiconsIcon icon={Clock01Icon} size={10} strokeWidth={2} />
                  {recentCount || '—'} events
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {recentActivity.length > 0 ? (
                  recentActivity.map((activity, index) => {
                    const agent = agents.find(
                      (entry) => entry.id === activity.agentId,
                    )
                    return (
                      <ActivityRow
                        key={activity.id}
                        emoji={agent?.meta.emoji ?? '·'}
                        agentName={agent?.name ?? activity.agentId}
                        summary={activity.summary}
                        timestamp={activity.timestamp}
                        delayMs={index * 35}
                      />
                    )
                  })
                ) : (
                  <div
                    className="rounded-md border border-dashed px-4 py-6 text-center font-mono text-[11px] uppercase tracking-wider"
                    style={{
                      borderColor: 'var(--mc-border)',
                      background: 'var(--mc-surface-2)',
                      color: 'var(--mc-text-dimmer)',
                    }}
                  >
                    No recent activity yet
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </section>

      <OperationsNewAgentModal
        open={newAgentOpen}
        defaultModel={defaultModel}
        onClose={() => setNewAgentOpen(false)}
        onCreate={createAgent}
        isSaving={isCreatingAgent}
      />

      <OperationsSettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
      />

      <OperationsAgentDetail
        open={Boolean(settingsAgent)}
        agent={settingsAgent}
        onClose={() => setSettingsAgentId(null)}
        onSave={saveAgent}
        onDelete={async (agentId) => {
          await deleteAgent(agentId)
          setSettingsAgentId((current) =>
            current === agentId ? null : current,
          )
        }}
        isSaving={isSavingAgent}
        isDeleting={isDeletingAgent}
      />
    </main>
  )
}
