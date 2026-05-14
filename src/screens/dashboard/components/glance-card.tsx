import { cn } from '@/lib/utils'

// ─── SVG Ring ────────────────────────────────────────────
type RingProps = {
  percent: number
  size?: number
  stroke?: number
  className?: string
}

function getRingColor(percent: number): string {
  if (percent >= 90) return 'stroke-red-500'
  if (percent >= 70) return 'stroke-amber-500'
  if (percent >= 40) return 'stroke-cyan-500'
  return 'stroke-emerald-500'
}

function getRingBg(percent: number): string {
  if (percent >= 90) return 'stroke-red-500/15'
  if (percent >= 70) return 'stroke-amber-500/15'
  if (percent >= 40) return 'stroke-cyan-500/15'
  return 'stroke-emerald-500/15'
}

export function PercentRing({
  percent,
  size = 64,
  stroke = 5,
  className,
}: RingProps) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={getRingBg(clamped)}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn('transition-all duration-700 ease-out', getRingColor(clamped))}
        />
      </svg>
      <span className="absolute text-sm font-bold tabular-nums text-primary-900 dark:text-primary-50">
        {Math.round(clamped)}%
      </span>
    </div>
  )
}

// ─── Health Badge ────────────────────────────────────────
type HealthStatus = 'healthy' | 'warning' | 'critical' | 'offline'

const HEALTH_STYLES: Record<HealthStatus, string> = {
  healthy: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  critical: 'bg-red-500/15 text-red-400 dark:text-red-400 border-red-500/30',
  offline: 'bg-primary-500/15 text-primary-500 border-primary-500/30',
}

const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: 'HEALTHY',
  warning: 'WARNING',
  critical: 'CRITICAL',
  offline: 'OFFLINE',
}

export function HealthBadge({ status, syncing }: { status: HealthStatus; syncing?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wider',
        HEALTH_STYLES[status],
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'healthy' && 'bg-emerald-500 animate-pulse',
          status === 'warning' && 'bg-amber-500',
          status === 'critical' && 'bg-red-500 animate-pulse',
          status === 'offline' && 'bg-primary-400',
        )}
      />
      {syncing ? 'Syncing' : HEALTH_LABELS[status]}
    </span>
  )
}

// ─── Provider Pill ───────────────────────────────────────
type ProviderPillProps = {
  name: string
  active?: boolean
  onClick?: () => void
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '🟣',
  openrouter: '🟢',
  openclaw: '🔵',
  openai: '⚡',
  google: '🔴',
}

export function ProviderPill({ name, active, onClick }: ProviderPillProps) {
  const icon = PROVIDER_ICONS[name.toLowerCase()] ?? '●'
  const label = name.charAt(0).toUpperCase() + name.slice(1)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all',
        active
          ? 'border-primary-700 bg-primary-800 text-white dark:border-primary-500 dark:bg-primary-700'
          : 'border-primary-200 bg-white/60 text-primary-600 hover:bg-primary-100 dark:hover:bg-white/10 dark:border-primary-700 dark:bg-primary-800/60 dark:text-primary-400 dark:hover:bg-primary-700',
      )}
    >
      <span className="text-[9px]">{icon}</span>
      {label}
    </button>
  )
}

// ─── Stat Block (SESSION / WEEKLY style) ─────────────────
type StatBlockProps = {
  label: string
  value: string | number
  percent?: number
  badge?: HealthStatus
  sublabel?: string
}

export function StatBlock({ label, value, percent, badge, sublabel }: StatBlockProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-primary-400 dark:text-primary-500">
          {label}
        </span>
        {badge && <HealthBadge status={badge} />}
      </div>
      {typeof percent === 'number' ? (
        <PercentRing percent={percent} size={56} stroke={4} />
      ) : (
        <p className="text-2xl font-bold tabular-nums text-primary-900 dark:text-primary-50">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      )}
      {sublabel && (
        <p className="max-w-[100px] truncate text-[9px] text-primary-400 dark:text-primary-500">
          {sublabel}
        </p>
      )}
    </div>
  )
}

// ─── Glance Card Container ───────────────────────────────
type GlanceCardProps = {
  children: React.ReactNode
  className?: string
}

export function GlanceCard({ children, className }: GlanceCardProps) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-primary-200 bg-primary-50/95 p-4 shadow-sm dark:border-primary-800 dark:bg-[var(--theme-panel)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
