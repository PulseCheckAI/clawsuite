import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SparkArea } from './spark-area'

// Mission Control KPI tile — direct visual port of artifacts-panel/11-mission-control.html.
// Composition: 2px pulse-gradient top bar, tiny label (uppercase, letter-spaced),
// big display number (Bricolage Grotesque via font-display), optional delta chip,
// optional sparkline slot, optional context line.
export function KpiCard({
  label,
  value,
  delta,
  deltaTone = 'positive',
  spark,
  context,
  icon,
  className,
}: {
  label: string
  value: ReactNode
  delta?: string
  deltaTone?: 'positive' | 'negative' | 'neutral'
  spark?: Array<number>
  context?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  const deltaClass =
    deltaTone === 'positive'
      ? 'text-emerald-400'
      : deltaTone === 'negative'
        ? 'text-red-400'
        : 'text-amber-400'

  return (
    <div className={cn('glass-tile relative p-5 overflow-hidden', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary-700 dark:text-primary-800">
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <span className="text-[11px] font-semibold tracking-[0.12em] uppercase font-mono">
            {label}
          </span>
        </div>
        {delta ? (
          <span
            className={cn(
              'text-[11px] font-semibold flex items-center gap-1',
              deltaClass,
            )}
          >
            {delta}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <div className="font-display text-4xl font-extrabold tracking-tight">
          {value}
        </div>
      </div>

      {spark && spark.length > 1 ? (
        <div className="mt-2 -mx-1">
          <SparkArea data={spark} color="#FF6B35" height={36} />
        </div>
      ) : null}

      {context ? (
        <div className="mt-2 text-xs text-primary-700 dark:text-primary-800">
          {context}
        </div>
      ) : null}
    </div>
  )
}
