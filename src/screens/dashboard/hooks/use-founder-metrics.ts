import { useQuery } from '@tanstack/react-query'

export type FounderMetrics = {
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

export type FounderPipelineHealth = {
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

export type FounderDqAlerts = { open_total?: number }

type FounderMetricsResponse = {
  ok: boolean
  founder_metrics?: FounderMetrics
  founder_pipeline_health?: FounderPipelineHealth
  founder_dq_alerts?: FounderDqAlerts
  founder_venue_results?: Array<unknown>
  error?: string
}

async function fetchFounderMetrics(): Promise<FounderMetricsResponse> {
  const res = await fetch('/api/founder-metrics')
  if (res.status === 401) {
    return { ok: false, error: 'Not authorized — sign in to view founder metrics.' }
  }
  const data = (await res.json()) as FounderMetricsResponse
  return data
}

export function useFounderMetrics() {
  return useQuery({
    queryKey: ['dashboard', 'founder-metrics'],
    queryFn: fetchFounderMetrics,
    retry: false,
    refetchInterval: 60_000,
  })
}
