// Gateway Logs — Mission Control palette pass (2026-05-19)
//
// Visual harmonization with /conductor + /ops:
//   - MC_STYLE tokens inherited from operations-screen.tsx
//   - LogsStatusBar : MetricStrip-style header (Phase / Total / Errors / Last)
//   - SeverityChip  : filter chips by severity
//   - LogEventRow   : monospace dense rows (mirrors StreamEventRow density)
//
// Behavior preserved: same `/api/gateway/logs` poll, same auto-follow, same
// filtering + export.

import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowTurnBackwardIcon,
  Cancel01Icon,
  Copy01Icon,
  CpuIcon,
  Download01Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

type LogEntry = {
  id: string
  timestamp: number | null
  level: LogLevel
  source: string
  message: string
  raw: string
}

type GatewayLogsData = {
  entries: Array<LogEntry>
  filePath: string | null
  method: string
}

const LOG_LEVELS: Array<LogLevel> = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]

// MC palette mapping per severity. Color is the --mc-* CSS token name so
// the row tag, dot, and ring share the same accent variable.
const LEVEL_ACCENT: Record<
  LogLevel,
  'cyan' | 'amber' | 'rose' | 'magenta' | 'emerald'
> = {
  trace: 'emerald',
  debug: 'emerald',
  info: 'cyan',
  warn: 'amber',
  error: 'rose',
  fatal: 'magenta',
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
  fatal: 'FATAL',
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function formatFullTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'Unknown timestamp'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function formatRelativeShort(timestamp: number | null): string {
  if (!timestamp) return '—'
  const delta = Date.now() - timestamp
  if (delta < 0) return 'just now'
  const sec = Math.floor(delta / 1000)
  if (sec < 5) return 'now'
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.floor(hr / 24)
  return `${d}d`
}

async function fetchGatewayLogs(): Promise<
  | { unavailable: true; message: string }
  | { unavailable: false; data: GatewayLogsData }
> {
  const response = await fetch('/api/gateway/logs?limit=500')
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    unavailable?: boolean
    error?: string
    data?: GatewayLogsData
  }

  if (response.status === 501 || payload.unavailable) {
    return {
      unavailable: true,
      message:
        payload.error ||
        'Gateway logs not available via RPC — check gateway.logs config',
    }
  }

  if (!response.ok || payload.ok === false || !payload.data) {
    throw new Error(payload.error || `HTTP ${response.status}`)
  }

  return {
    unavailable: false,
    data: payload.data,
  }
}

// ─── small UI helpers (mirror operations-screen) ───────────────────────────

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

function LogsStatusBar({
  totalToday,
  errorRate,
  lastEvent,
  isLoading,
  hasError,
  isUnavailable,
  isFollowing,
}: {
  totalToday: number
  errorRate: number | null
  lastEvent: number | null
  isLoading: boolean
  hasError: boolean
  isUnavailable: boolean
  isFollowing: boolean
}) {
  const phaseLabel = hasError
    ? 'ERROR'
    : isUnavailable
      ? 'OFFLINE'
      : isLoading
        ? 'LOADING'
        : isFollowing
          ? 'TAIL'
          : 'PAUSED'
  const phaseAccent: 'cyan' | 'emerald' | 'amber' | 'magenta' | 'rose' =
    hasError
      ? 'magenta'
      : isUnavailable
        ? 'rose'
        : isLoading
          ? 'amber'
          : isFollowing
            ? 'emerald'
            : 'cyan'

  const errorAccent: 'emerald' | 'amber' | 'rose' =
    errorRate === null || errorRate === 0
      ? 'emerald'
      : errorRate < 0.05
        ? 'amber'
        : 'rose'

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
            Gateway · /gateway/logs
          </p>
          <p className="text-[12px]" style={{ color: 'var(--mc-text)' }}>
            Live log telemetry
          </p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <MetricChip label="Phase" value={phaseLabel} accent={phaseAccent} />
        <MetricChip
          label="Today"
          value={isLoading || isUnavailable ? '—' : totalToday || '—'}
          accent="cyan"
        />
        <MetricChip
          label="Err Rate"
          value={
            isLoading || isUnavailable || errorRate === null
              ? '—'
              : `${(errorRate * 100).toFixed(1)}%`
          }
          accent={errorAccent}
        />
        <MetricChip
          label="Last"
          value={
            isLoading || isUnavailable ? '—' : formatRelativeShort(lastEvent)
          }
          accent="emerald"
        />
      </div>
    </div>
  )
}

function SeverityChip({
  level,
  active,
  count,
  onClick,
}: {
  level: LogLevel | 'all'
  active: boolean
  count: number
  onClick: () => void
}) {
  const accent = level === 'all' ? 'cyan' : LEVEL_ACCENT[level]
  const accentVar = `var(--mc-${accent})`
  const softVar = `var(--mc-${accent}-soft)`
  const label = level === 'all' ? 'ALL' : LEVEL_LABEL[level].trim()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
      )}
      style={{
        borderColor: active ? accentVar : 'var(--mc-border)',
        background: active ? softVar : 'var(--mc-surface)',
        color: active ? accentVar : 'var(--mc-text-dim)',
      }}
    >
      <span>{label}</span>
      <span
        className="rounded px-1.5 py-px text-[10px] tabular-nums"
        style={{
          background: active ? 'rgba(0,0,0,0.25)' : 'var(--mc-surface-2)',
          color: active ? accentVar : 'var(--mc-text-dimmer)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

function LogEventRow({
  entry,
  idx,
  onCopy,
}: {
  entry: LogEntry
  idx: number
  onCopy: (entry: LogEntry) => void
}) {
  const accent = LEVEL_ACCENT[entry.level]
  const accentVar = `var(--mc-${accent})`
  const softVar = `var(--mc-${accent}-soft)`
  const label = LEVEL_LABEL[entry.level]
  return (
    <div
      className="group grid grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-start gap-3 rounded border px-2.5 py-1.5 font-mono motion-reduce:[animation:none]"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface-2)',
        animation: 'mc-event-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        animationDelay: `${Math.min(idx, 20) * 8}ms`,
      }}
    >
      {/* severity tag with dot */}
      <span
        className="mt-[3px] inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
        style={{
          borderColor: accentVar,
          background: softVar,
          color: accentVar,
          border: '1px solid',
        }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: accentVar,
            boxShadow: `0 0 6px 0 ${accentVar}`,
          }}
          aria-hidden
        />
        {label}
      </span>
      {/* index */}
      <span
        className="mt-[3px] shrink-0 text-[10px] tabular-nums"
        style={{ color: 'var(--mc-text-dimmer)' }}
      >
        #{String(idx + 1).padStart(4, '0')}
      </span>
      {/* timestamp + relative */}
      <span
        className="mt-[3px] flex shrink-0 flex-col text-[10px] leading-tight"
        title={formatFullTimestamp(entry.timestamp)}
      >
        <span style={{ color: 'var(--mc-text-dim)' }} className="tabular-nums">
          {formatTime(entry.timestamp)}
        </span>
        <span style={{ color: 'var(--mc-text-dimmer)' }}>
          {formatRelativeShort(entry.timestamp)} ago
        </span>
      </span>
      {/* source + message */}
      <div className="min-w-0">
        <p
          className="text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--mc-text-dimmer)' }}
        >
          {entry.source || 'gateway'}
        </p>
        <pre
          className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-[12px] leading-snug"
          style={{ color: 'var(--mc-text)' }}
        >
          {entry.message}
        </pre>
      </div>
      {/* action — copy */}
      <button
        type="button"
        onClick={() => onCopy(entry)}
        title="Copy raw entry"
        className="mt-[2px] inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
        style={{
          borderColor: 'var(--mc-border)',
          background: 'var(--mc-surface)',
          color: 'var(--mc-text-dim)',
        }}
      >
        <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.6} />
      </button>
    </div>
  )
}

// ─── screen ────────────────────────────────────────────────────────────────

export function GatewayLogsScreen() {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [searchText, setSearchText] = useState('')
  const [selectedLevels, setSelectedLevels] =
    useState<Array<LogLevel>>(LOG_LEVELS)
  const [autoFollow, setAutoFollow] = useState(true)

  const query = useQuery({
    queryKey: ['gateway', 'logs'],
    queryFn: fetchGatewayLogs,
    refetchInterval: autoFollow ? 5000 : false,
    retry: false,
  })

  const data = query.data && !query.data.unavailable ? query.data.data : null
  const unavailableMessage =
    query.data && query.data.unavailable ? query.data.message : null
  const entries = data?.entries ?? []
  const selectedLevelSet = useMemo(
    () => new Set(selectedLevels),
    [selectedLevels],
  )

  // Counts per level — for chip badges. Computed off the *unfiltered* entries
  // so the operator can see "16 errors, 3 fatal" before flipping chips.
  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = {
      trace: 0,
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
    }
    for (const entry of entries) counts[entry.level] += 1
    return counts
  }, [entries])

  // Header metrics — computed once per entries change.
  const headerMetrics = useMemo(() => {
    if (entries.length === 0) {
      return {
        totalToday: 0,
        errorRate: null as number | null,
        lastEvent: null as number | null,
      }
    }
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const startMs = startOfDay.getTime()
    let totalToday = 0
    let errorsToday = 0
    let lastEvent: number | null = null
    for (const entry of entries) {
      if (entry.timestamp && entry.timestamp >= startMs) {
        totalToday += 1
        if (entry.level === 'error' || entry.level === 'fatal') errorsToday += 1
      }
      if (
        entry.timestamp &&
        (lastEvent === null || entry.timestamp > lastEvent)
      ) {
        lastEvent = entry.timestamp
      }
    }
    return {
      totalToday,
      errorRate: totalToday > 0 ? errorsToday / totalToday : null,
      lastEvent,
    }
  }, [entries])

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()
    return entries.filter((entry) => {
      if (!selectedLevelSet.has(entry.level)) return false
      if (!normalizedSearch) return true
      return `${entry.message}\n${entry.source}\n${entry.raw}`
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [entries, searchText, selectedLevelSet])

  useEffect(() => {
    if (!autoFollow || !viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [autoFollow, filteredEntries.length, query.dataUpdatedAt])

  function toggleLevel(level: LogLevel) {
    setSelectedLevels((current) => {
      if (current.includes(level)) {
        if (current.length === 1) return current
        return current.filter((entry) => entry !== level)
      }
      return [...current, level]
    })
  }

  function toggleAll() {
    setSelectedLevels((current) =>
      current.length === LOG_LEVELS.length ? ['info'] : [...LOG_LEVELS],
    )
  }

  function exportVisibleLogs() {
    const lines = filteredEntries.map((entry) => {
      const timestamp = entry.timestamp
        ? new Date(entry.timestamp).toISOString()
        : 'unknown-time'
      return `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`
    })
    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `gateway-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function copyEntry(entry: LogEntry) {
    const timestamp = entry.timestamp
      ? new Date(entry.timestamp).toISOString()
      : 'unknown-time'
    const text = `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`
    void navigator.clipboard?.writeText(text).catch(() => {
      // Clipboard can fail under iframe/HTTP — silent. The row click already
      // signals to the operator; no toast pipeline here.
    })
  }

  const lastUpdated = query.dataUpdatedAt
    ? new Date(query.dataUpdatedAt).toLocaleTimeString(undefined, {
        hour12: false,
      })
    : null
  const allLevelsSelected = selectedLevels.length === LOG_LEVELS.length

  const containerStyle: CSSProperties = {
    background: 'var(--mc-bg)',
    color: 'var(--mc-text)',
  }

  return (
    <main
      className="min-h-full px-4 pb-24 pt-5 md:px-6 md:pt-6"
      style={containerStyle}
    >
      <section className="mx-auto w-full max-w-[1480px] space-y-4">
        <LogsStatusBar
          totalToday={headerMetrics.totalToday}
          errorRate={headerMetrics.errorRate}
          lastEvent={headerMetrics.lastEvent}
          isLoading={query.isPending}
          hasError={query.isError}
          isUnavailable={Boolean(unavailableMessage)}
          isFollowing={autoFollow}
        />

        {/* Filter + search bar */}
        <section
          className="rounded-lg border p-3"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface)',
          }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-1 flex-col gap-2">
              <SectionLabel>Severity</SectionLabel>
              <div className="flex flex-wrap items-center gap-1.5">
                <SeverityChip
                  level="all"
                  active={allLevelsSelected}
                  count={entries.length}
                  onClick={toggleAll}
                />
                {LOG_LEVELS.map((level) => (
                  <SeverityChip
                    key={level}
                    level={level}
                    active={selectedLevelSet.has(level)}
                    count={levelCounts[level]}
                    onClick={() => toggleLevel(level)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 lg:min-w-[420px]">
              <SectionLabel>Search · Control</SectionLabel>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-[var(--mc-cyan)]"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                    minWidth: '240px',
                  }}
                >
                  <HugeiconsIcon
                    icon={Search01Icon}
                    size={14}
                    strokeWidth={1.5}
                    style={{ color: 'var(--mc-text-dimmer)' }}
                  />
                  <input
                    type="search"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="grep visible logs…"
                    aria-label="Search gateway logs"
                    className="w-full bg-transparent font-mono text-[12px] outline-none placeholder:text-[var(--mc-text-dimmer)]"
                    style={{ color: 'var(--mc-text)' }}
                  />
                  {searchText ? (
                    <button
                      type="button"
                      onClick={() => setSearchText('')}
                      title="Clear search"
                      className="inline-flex h-5 w-5 items-center justify-center rounded"
                      style={{ color: 'var(--mc-text-dimmer)' }}
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={12}
                        strokeWidth={1.8}
                      />
                    </button>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => setAutoFollow((v) => !v)}
                  aria-pressed={autoFollow}
                  title={autoFollow ? 'Pause tail' : 'Resume tail'}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider"
                  style={{
                    borderColor: autoFollow
                      ? 'var(--mc-emerald)'
                      : 'var(--mc-border)',
                    background: autoFollow
                      ? 'var(--mc-emerald-soft)'
                      : 'var(--mc-surface-2)',
                    color: autoFollow
                      ? 'var(--mc-emerald)'
                      : 'var(--mc-text-dim)',
                  }}
                >
                  <HugeiconsIcon
                    icon={autoFollow ? PauseIcon : PlayIcon}
                    size={12}
                    strokeWidth={1.8}
                  />
                  {autoFollow ? 'Tail' : 'Paused'}
                </button>

                <button
                  type="button"
                  onClick={() => query.refetch()}
                  disabled={query.isFetching}
                  title="Refresh now"
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider disabled:opacity-50"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                    color: 'var(--mc-text-dim)',
                  }}
                >
                  <HugeiconsIcon
                    icon={ArrowTurnBackwardIcon}
                    size={12}
                    strokeWidth={1.8}
                  />
                  Refresh
                </button>

                <button
                  type="button"
                  onClick={exportVisibleLogs}
                  disabled={filteredEntries.length === 0}
                  title="Export visible to .txt"
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider disabled:opacity-50"
                  style={{
                    borderColor: 'var(--mc-border)',
                    background: 'var(--mc-surface-2)',
                    color: 'var(--mc-text-dim)',
                  }}
                >
                  <HugeiconsIcon
                    icon={Download01Icon}
                    size={12}
                    strokeWidth={1.8}
                  />
                  Export
                </button>
              </div>
            </div>
          </div>

          <div
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 font-mono text-[10px] uppercase tracking-wider"
            style={{
              borderColor: 'var(--mc-border)',
              color: 'var(--mc-text-dimmer)',
            }}
          >
            <span>
              file ·{' '}
              <span style={{ color: 'var(--mc-text-dim)' }}>
                {data?.filePath || '—'}
              </span>
            </span>
            <span>
              rpc ·{' '}
              <span style={{ color: 'var(--mc-text-dim)' }}>
                {data?.method || '—'}
              </span>
            </span>
            <span>
              visible ·{' '}
              <span style={{ color: 'var(--mc-text-dim)' }}>
                {filteredEntries.length}/{entries.length || '—'}
              </span>
            </span>
            <span>
              poll ·{' '}
              <span style={{ color: 'var(--mc-text-dim)' }}>
                {autoFollow ? '5s' : 'paused'}
              </span>
            </span>
            {lastUpdated ? (
              <span>
                sync ·{' '}
                <span style={{ color: 'var(--mc-text-dim)' }}>
                  {lastUpdated}
                </span>
              </span>
            ) : null}
            {query.isFetching && !query.isPending ? (
              <span style={{ color: 'var(--mc-cyan)' }}>refreshing…</span>
            ) : null}
          </div>
        </section>

        {/* Stream surface */}
        <section
          className="rounded-lg border"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface)',
            backgroundImage:
              'linear-gradient(to bottom, rgba(0, 229, 255, 0.025), transparent 30%)',
          }}
        >
          <div
            className="flex items-center justify-between border-b px-3 py-2"
            style={{ borderColor: 'var(--mc-border)' }}
          >
            <SectionLabel>Event Stream</SectionLabel>
            <span
              className="font-mono text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              {autoFollow ? 'tail · live' : 'scroll · paused'}
            </span>
          </div>

          {query.isPending ? (
            <div
              className="px-5 py-12 text-center font-mono text-[12px]"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              Loading gateway logs…
            </div>
          ) : unavailableMessage ? (
            <div className="px-5 py-12 text-center font-mono">
              <p className="text-[12px]" style={{ color: 'var(--mc-rose)' }}>
                {unavailableMessage}
              </p>
              <p
                className="mt-2 text-[11px]"
                style={{ color: 'var(--mc-text-dimmer)' }}
              >
                The gateway did not expose a supported logs RPC method.
              </p>
            </div>
          ) : query.isError ? (
            <div className="px-5 py-12 text-center font-mono">
              <p className="text-[12px]" style={{ color: 'var(--mc-rose)' }}>
                {query.error instanceof Error
                  ? query.error.message
                  : 'Failed to load gateway logs'}
              </p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div
              className="px-5 py-12 text-center font-mono"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              <p className="text-[28px] leading-none">—</p>
              <p className="mt-3 text-[11px] uppercase tracking-wider">
                no entries match current filters
              </p>
            </div>
          ) : (
            <div
              ref={viewportRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-atomic="false"
              aria-label="Gateway log stream"
              className="max-h-[68vh] space-y-1 overflow-y-auto p-3"
            >
              {filteredEntries.map((entry, idx) => (
                <LogEventRow
                  key={entry.id}
                  entry={entry}
                  idx={idx}
                  onCopy={copyEntry}
                />
              ))}
              {autoFollow ? (
                <span
                  className="ml-1 inline-block h-3 w-[7px] animate-[mc-caret_1s_steps(1)_infinite]"
                  style={{ backgroundColor: 'var(--mc-cyan)' }}
                  aria-hidden
                />
              ) : null}
            </div>
          )}
        </section>

        {autoFollow && filteredEntries.length > 0 ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (!viewportRef.current) return
                viewportRef.current.scrollTop = viewportRef.current.scrollHeight
              }}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider"
              style={{
                borderColor: 'var(--mc-border)',
                background: 'var(--mc-surface)',
                color: 'var(--mc-text-dim)',
              }}
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={12}
                strokeWidth={1.8}
              />
              Jump to latest
            </button>
          </div>
        ) : null}
      </section>

      {/* Local keyframes — mirror conductor-mission-control.tsx names so the
          existing global ones (when conductor is mounted) also work; this
          duplicate keeps the route self-contained when conductor isn't. */}
      <style>{`
        @keyframes mc-event-in {
          0% { opacity: 0; transform: translateY(6px); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes mc-caret {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </main>
  )
}
