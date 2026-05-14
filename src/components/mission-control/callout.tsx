import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type CalloutTone = 'info' | 'success' | 'warn' | 'critical' | 'pulse'

const TONES = {
  info: {
    border: 'border-blue-500/40',
    bg: 'bg-blue-500/5',
    accent: 'text-blue-400',
  },
  success: {
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/5',
    accent: 'text-emerald-400',
  },
  warn: {
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/5',
    accent: 'text-amber-400',
  },
  critical: {
    border: 'border-red-500/40',
    bg: 'bg-red-500/5',
    accent: 'text-red-400',
  },
  pulse: {
    border: 'border-accent-500/40',
    bg: 'bg-accent-500/5',
    accent: 'text-accent-400',
  },
}

// Mission Control alert / callout banner. Mirrors Tremor Raw's <Callout> with
// an additional 'pulse' tone bound to the brand accent.
export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  className,
}: {
  tone?: CalloutTone
  title?: string
  children?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  const t = TONES[tone]
  return (
    <div
      role="status"
      className={cn(
        'rounded-lg border p-4 flex items-start gap-3',
        t.border,
        t.bg,
        className,
      )}
    >
      {icon ? (
        <span className={cn('mt-0.5 shrink-0', t.accent)}>{icon}</span>
      ) : null}
      <div className="flex-1 min-w-0">
        {title ? (
          <div className={cn('font-semibold text-sm mb-1', t.accent)}>
            {title}
          </div>
        ) : null}
        {children ? (
          <div className="text-xs text-primary-700 dark:text-primary-800 leading-relaxed">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  )
}
