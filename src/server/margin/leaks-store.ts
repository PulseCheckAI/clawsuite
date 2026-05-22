// MarginOps leak reads — wraps platinum.margin_leak_daily, tenant-scoped.
// Mirrors marginops-mcp.margin_leaks_top, but every query REQUIRES an
// organizationId (the tenant scope) — there are no cross-tenant reads here.

import { getMarginDb } from './db'

export interface MarginLeak {
  id: string
  organization_id: string
  location_id: string | null
  leak_date: string // 'YYYY-MM-DD'
  domain: string
  sub_category: string | null
  severity: string
  confidence: number | null
  leak_amount_cents: number | null
  annualized_cents: number | null
  estimated_recovery_cents: number | null
  difficulty: string | null
  time_to_impact: string | null
  description: string | null
  prescription: string | null
}

export interface ListLeaksOpts {
  organizationId: string // REQUIRED — tenant scope, never optional
  locationId?: string
  days?: number
  severity?: string
  domain?: string
  limit?: number
}

const LEAK_COLUMNS =
  'id, organization_id, location_id, leak_date, domain, sub_category, severity, ' +
  'confidence, leak_amount_cents, annualized_cents, estimated_recovery_cents, ' +
  'difficulty, time_to_impact, description, prescription'

// Top margin leaks by annualized impact for ONE org. Ordered by annualized_cents
// desc (biggest bleed first), windowed to the last `days`.
export async function listMarginLeaks(
  opts: ListLeaksOpts,
): Promise<MarginLeak[]> {
  const days = Math.min(Math.max(opts.days ?? 7, 1), 90)
  const sinceIso = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200)

  const db = await getMarginDb('platinum')
  let q = db
    .from('margin_leak_daily')
    .select(LEAK_COLUMNS)
    .eq('organization_id', opts.organizationId)
    .gte('leak_date', sinceIso)
    .order('annualized_cents', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (opts.locationId) q = q.eq('location_id', opts.locationId)
  if (opts.severity) q = q.eq('severity', opts.severity)
  if (opts.domain) q = q.eq('domain', opts.domain)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MarginLeak[]
}
