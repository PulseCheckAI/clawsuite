import { DollarCircleIcon } from '@hugeicons/core-free-icons'
import { WidgetShell } from './widget-shell'
import { useFounderMetrics } from '../hooks/use-founder-metrics'

type FounderMetricsWidgetProps = {
  onRemove?: () => void
}

const usd = (cents?: number): string =>
  cents == null
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

const num = (n?: number): string => (n == null ? '—' : n.toLocaleString('en-US'))

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-primary-200 dark:border-neutral-800 bg-primary-50 dark:bg-neutral-950 px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-primary-900 dark:text-neutral-100">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-[10px] text-neutral-500 dark:text-neutral-400">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function FounderMetricsWidget({ onRemove }: FounderMetricsWidgetProps) {
  const { data, isLoading, error: queryError } = useFounderMetrics()

  const notAuthorized = data?.ok === false
  const errorMessage = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : notAuthorized
      ? data?.error
      : undefined

  const m = data?.founder_metrics ?? {}
  const p = data?.founder_pipeline_health ?? {}
  const dq = data?.founder_dq_alerts ?? {}
  const venues = data?.founder_venue_results ?? []
  const failed = p.failed ?? 0

  return (
    <WidgetShell
      size="large"
      title="Founder Metrics"
      icon={DollarCircleIcon}
      onRemove={onRemove}
      loading={isLoading && !data}
      error={errorMessage}
      className="h-full rounded-xl border border-neutral-200 dark:border-neutral-700 border-l-4 border-l-emerald-500 bg-white dark:bg-neutral-900 p-4 sm:p-5 shadow-[0_6px_20px_rgba(0,0,0,0.25)] [&_svg]:text-emerald-500"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="MRR"
          value={usd(m.mrr_cents)}
          hint={`${usd(m.arr_cents)} ARR · ${num(m.paying_orgs)} orgs`}
        />
        <Stat
          label="Trials"
          value={num(m.trials)}
          hint={`${num(m.onboarding_in_progress)} onboarding · ${num(m.customers_at_risk)} at risk`}
        />
        <Stat
          label="Prospects"
          value={num(m.prospects_scored)}
          hint={`${num(m.prospects_warm)} warm · ${num(m.prospects_in_outreach)} in outreach`}
        />
        <Stat
          label="Pipeline 24h"
          value={p.success_pct != null ? `${Math.round(p.success_pct)}%` : '—'}
          hint={`${num(failed)} failed · ${num(dq.open_total)} DQ open`}
        />
      </div>
      <p className="mt-2 text-[10px] text-neutral-500 dark:text-neutral-400">
        {venues.length} venue result rows
        {p.last_run_at ? ` · last pipeline run ${new Date(p.last_run_at).toLocaleString()}` : ''}
      </p>
    </WidgetShell>
  )
}
