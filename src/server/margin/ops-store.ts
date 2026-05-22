// MarginOps daily snapshots — wraps gold.v_margin_ops, tenant-scoped.
// Mirrors marginops-mcp.margin_ops_summary; every query REQUIRES organizationId.

import { getMarginDb } from './db'

export interface MarginSnapshot {
  organization_id: string
  location_id: string | null
  metric_date: string // 'YYYY-MM-DD'
  net_sales_cents: number | null
  cogs_cents: number | null
  labor_cost_cents: number | null
  food_cost_pct: number | null
  labor_cost_pct: number | null
  prime_cost_pct: number | null
  food_cost_grade: string | null
  labor_cost_grade: string | null
  prime_cost_grade: string | null
  margin_health_score: number | null
  est_net_margin_pct: number | null
  operating_profit_cents: number | null
  transaction_count: number | null
  guest_count: number | null
}

export interface ListOpsOpts {
  organizationId: string // REQUIRED — tenant scope
  locationId?: string
  days?: number
  limit?: number
}

const OPS_COLUMNS =
  'organization_id, location_id, metric_date, net_sales_cents, cogs_cents, ' +
  'labor_cost_cents, food_cost_pct, labor_cost_pct, prime_cost_pct, ' +
  'food_cost_grade, labor_cost_grade, prime_cost_grade, margin_health_score, ' +
  'est_net_margin_pct, operating_profit_cents, transaction_count, guest_count'

// Most recent N days of per-location margin snapshots for ONE org.
export async function listMarginOps(
  opts: ListOpsOpts,
): Promise<MarginSnapshot[]> {
  const days = Math.min(Math.max(opts.days ?? 7, 1), 90)
  const sinceIso = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)

  const db = await getMarginDb('gold')
  let q = db
    .from('v_margin_ops')
    .select(OPS_COLUMNS)
    .eq('organization_id', opts.organizationId)
    .gte('metric_date', sinceIso)
    .order('metric_date', { ascending: false })
    .limit(limit)
  if (opts.locationId) q = q.eq('location_id', opts.locationId)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MarginSnapshot[]
}
