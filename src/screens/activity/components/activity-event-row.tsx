import { memo } from 'react'
import {
  Activity01Icon,
  AiBookIcon,
  ChartLineData02Icon,
  Clock01Icon,
  Notification03Icon,
  Task01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ActivityEvent } from '@/types/activity-event'
import { cn } from '@/lib/utils'

function getEventIcon(eventType: ActivityEvent['type']) {
  if (eventType === 'gateway') return Activity01Icon
  if (eventType === 'model') return AiBookIcon
  if (eventType === 'usage') return ChartLineData02Icon
  if (eventType === 'cron') return Clock01Icon
  if (eventType === 'tool') return Task01Icon
  if (eventType === 'error') return Notification03Icon
  return UserGroupIcon
}

function getLevelDotClass(level: ActivityEvent['level']): string {
  if (level === 'debug') return 'bg-primary-400'
  if (level === 'info') return 'bg-blue-500'
  if (level === 'warn') return 'bg-amber-500'
  return 'bg-red-500'
}

function getLevelBorderClass(level: ActivityEvent['level']): string {
  if (level === 'error') return 'border-l-red-500'
  if (level === 'warn') return 'border-l-amber-500'
  if (level === 'info') return 'border-l-blue-500'
  return 'border-l-primary-400'
}

function getTypeLabel(eventType: ActivityEvent['type']): string {
  if (eventType === 'gateway') return 'Gateway'
  if (eventType === 'model') return 'Model'
  if (eventType === 'usage') return 'Usage'
  if (eventType === 'cron') return 'Cron'
  if (eventType === 'tool') return 'Tool'
  if (eventType === 'error') return 'Error'
  return 'Session'
}

export function formatRelativeTimestamp(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp)
  const seconds = Math.floor(diffMs / 1000)

  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export const ActivityEventRow = memo(function ActivityEventRow({
  event,
}: {
  event: ActivityEvent
}) {
  return (
    <article
      className={cn(
        'rounded-md border-l-2 px-3 py-1.5 transition-colors hover:bg-[rgba(255,255,255,0.04)]',
        getLevelBorderClass(event.level),
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            'inline-flex size-1.5 shrink-0 rounded-full',
            getLevelDotClass(event.level),
          )}
        />
        <HugeiconsIcon
          icon={getEventIcon(event.type)}
          size={14}
          strokeWidth={1.75}
          className="shrink-0 opacity-70"
        />
        <span className="shrink-0 rounded-sm border border-[rgba(192,192,192,0.25)] bg-[rgba(255,255,255,0.03)] px-1.5 py-px text-[10px] uppercase tracking-wider tabular-nums opacity-80">
          {getTypeLabel(event.type)}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums opacity-60">
          {formatRelativeTimestamp(event.timestamp)}
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {event.title}
        </p>
        {event.detail ? (
          <details className="shrink-0">
            <summary className="cursor-pointer text-[10px] uppercase tracking-wider tabular-nums opacity-60 hover:opacity-100">
              Detail
            </summary>
            <p className="mt-1.5 rounded-md border border-[rgba(192,192,192,0.25)] bg-[rgba(255,255,255,0.03)] px-2 py-1.5 text-xs text-pretty">
              {event.detail}
            </p>
          </details>
        ) : null}
      </div>
    </article>
  )
})
