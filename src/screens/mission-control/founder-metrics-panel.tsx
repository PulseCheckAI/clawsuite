import { useEffect, useState } from 'react'
import { KpiCard, Callout, StatusDot } from '@/components/mission-control'

// ── FounderMetricsPanel ───────────────────────────────────────────────────────
// Renders the founder business metrics via the authenticated server route
// /api/founder-metrics (service-role behind isAuthenticated; the SECURITY DEFINER
// founder_* RPCs are no longer anon-callable — see auth fix 2026-06-12). Money is
// stored as BIGINT cents, so divide by 100 for display. Null-safe throughout:
// any missing field renders "—" rather than crashing the Command Center.

type FounderMetrics = {
  paying_orgs?: number
  paying_venues?: number
  trials?: number
  mrr_cents?: number
  arr_cents?: number
  customers_churned?: number
  customers_at_risk?: number
  onboarding_in_progress?: number
  outcomes_delivered?: number
  prospects_scored?: number
  prospects_warm?: number
  prospects_enriched?: number
  prospects_in_outreach?: number
}

type PipelineHealth = {
  window_hours?: number
  total?: number
  completed?: number
  failed?: number
  running?: number
  success_pct?: number
  rows_processed?: number
  rows_quarantined?: number
  last_run_at?: string
}

type DqAlerts = { open_total?: number }

type FounderResponse = {
  ok: boolean
  founder_metrics?: FounderMetrics
  founder_pipeline_health?: PipelineHealth
  founder_dq_alerts?: DqAlerts
  founder_venue_results?: Array<unknown>
  error?: string
}

const usd = (cents?: number): string =>
  cents == null
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

const num = (n?: number): string =>
  n == null ? '—' : n.toLocaleString('en-US')

export function FounderMetricsPanel() {
  const [data, setData] = useState<FounderResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await fetch('/api/founder-metrics')
        if (res.status === 401) {
          if (active)
            setErr('Not authorized — sign in to view founder metrics.')
          return
        }
        const json = (await res.json()) as FounderResponse
        if (!active) return
        if (!json.ok) {
          setErr(json.error || 'Failed to load founder metrics.')
          return
        }
        setData(json)
        setErr(null)
      } catch (e) {
        if (active) setErr(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  if (err) {
    return (
      <Callout tone="critical" title="Founder metrics unavailable">
        {err}
      </Callout>
    )
  }

  const m = data?.founder_metrics ?? {}
  const p = data?.founder_pipeline_health ?? {}
  const dq = data?.founder_dq_alerts ?? {}
  const venues = data?.founder_venue_results ?? []

  const failed = p.failed ?? 0

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusDot tone="live" />
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Founder Metrics
        </h2>
        <span className="text-xs text-primary-700 dark:text-primary-800 font-mono">
          /api/founder-metrics · service-role, authed
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="MRR"
          value={usd(m.mrr_cents)}
          delta={`${usd(m.arr_cents)} ARR`}
          deltaTone={(m.mrr_cents ?? 0) > 0 ? 'positive' : 'neutral'}
          context={`${num(m.paying_orgs)} paying orgs · ${num(m.paying_venues)} venues`}
        />
        <KpiCard
          label="Trials / Onboarding"
          value={num(m.trials)}
          delta={`${num(m.onboarding_in_progress)} onboarding`}
          deltaTone="neutral"
          context={`${num(m.customers_at_risk)} at risk · ${num(m.customers_churned)} churned`}
        />
        <KpiCard
          label="Prospect Funnel"
          value={num(m.prospects_scored)}
          delta={`${num(m.prospects_warm)} warm`}
          deltaTone="neutral"
          context={`${num(m.prospects_enriched)} enriched · ${num(m.prospects_in_outreach)} in outreach`}
        />
        <KpiCard
          label="Pipeline · 24h"
          value={p.success_pct != null ? `${Math.round(p.success_pct)}%` : '—'}
          delta={`${num(failed)} failed`}
          deltaTone={
            failed === 0 ? 'positive' : failed > 5 ? 'negative' : 'neutral'
          }
          context={`${num(p.total)} jobs · ${num(p.rows_processed)} rows · ${num(dq.open_total)} DQ open`}
        />
      </div>
      <p className="text-xs text-primary-700 dark:text-primary-800 font-mono">
        {venues.length} venue result rows
        {p.last_run_at
          ? ` · last pipeline run ${new Date(p.last_run_at).toLocaleString()}`
          : ''}
      </p>
    </section>
  )
}
