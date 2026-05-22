// Integration Hub data layer — reads integrations.* (tenant_connections +
// integration_catalog + source_systems). Read-only. Credential/token columns
// are deliberately NEVER selected — only metadata + status + sync telemetry.
//
// The 504-row integration_catalog IS the registry: adding a future integration
// = a catalog row, and the Hub's catalog browser exposes it as a "Connect" card.

import { getIntegrationsDb } from './db'

export interface ConnectionView {
  connectionId: string
  organizationId: string | null
  name: string
  status: string
  errorCount: number
  lastError: string | null
  lastSyncAt: string | null
  nextSyncAt: string | null
  syncEnabled: boolean
  syncFrequencyMinutes: number | null
  integrationName: string | null
  vendorName: string | null
  category: string | null
  logoUrl: string | null
  authType: string | null
  supportsWebhooks: boolean | null
  supportsRealTime: boolean | null
}

export interface CatalogEntry {
  integrationId: string
  code: string | null
  name: string
  vendor: string | null
  category: string | null
  subcategory: string | null
  authType: string | null
  description: string | null
  logoUrl: string | null
  documentationUrl: string | null
  supportsWebhooks: boolean | null
  supportsRealTime: boolean | null
  supportsIncrementalSync: boolean | null
  setupComplexity: string | null
  typicalSyncFrequency: string | null
  isEnterpriseOnly: boolean | null
  tags: string[] | null
}

export interface CategoryCount {
  category: string
  count: number
}

export interface HubStats {
  connectedTotal: number
  connectedActive: number
  connectedError: number
  totalErrors: number
  lastSyncAt: string | null
  syncedLast24h: number
  staleCount: number
  catalogTotal: number
  categoriesTotal: number
  sourceSystemsTotal: number
  sourceSystemsPending: number
}

interface RawConnection {
  connection_id: string
  organization_id: string | null
  integration_id: string | null
  connection_name: string | null
  status: string | null
  error_count: number | null
  last_error: string | null
  last_sync_at: string | null
  next_sync_at: string | null
  sync_enabled: boolean | null
  sync_frequency_minutes: number | null
}

interface RawCatalog {
  integration_id: string
  integration_code: string | null
  integration_name: string | null
  vendor_name: string | null
  category: string | null
  subcategory: string | null
  auth_type: string | null
  description: string | null
  logo_url: string | null
  documentation_url: string | null
  supports_webhooks: boolean | null
  supports_real_time: boolean | null
  supports_incremental_sync: boolean | null
  setup_complexity: string | null
  typical_sync_frequency: string | null
  is_enterprise_only: boolean | null
  tags: string[] | null
}

const DAY_MS = 86_400_000

// Only allow http(s) doc URLs through to the client — guards against a catalog
// row carrying a javascript:/data: URI that the UI renders as <a href>.
function safeHttpUrl(u: string | null): string | null {
  if (!u) return null
  try {
    const proto = new URL(u).protocol
    return proto === 'http:' || proto === 'https:' ? u : null
  } catch {
    return null
  }
}

function mapCatalog(c: RawCatalog): CatalogEntry {
  return {
    integrationId: c.integration_id,
    code: c.integration_code ?? null,
    name: c.integration_name ?? 'Untitled',
    vendor: c.vendor_name ?? null,
    category: c.category ?? null,
    subcategory: c.subcategory ?? null,
    authType: c.auth_type ?? null,
    description: c.description ?? null,
    logoUrl: c.logo_url ?? null,
    documentationUrl: safeHttpUrl(c.documentation_url),
    supportsWebhooks: c.supports_webhooks ?? null,
    supportsRealTime: c.supports_real_time ?? null,
    supportsIncrementalSync: c.supports_incremental_sync ?? null,
    setupComplexity: c.setup_complexity ?? null,
    typicalSyncFrequency: c.typical_sync_frequency ?? null,
    isEnterpriseOnly: c.is_enterprise_only ?? null,
    tags: Array.isArray(c.tags) ? c.tags : null,
  }
}

// Only the 8 columns the connection-enrichment query actually selects.
interface PartialCatalog {
  integration_id: string
  integration_name: string | null
  vendor_name: string | null
  category: string | null
  logo_url: string | null
  auth_type: string | null
  supports_webhooks: boolean | null
  supports_real_time: boolean | null
}

/** All tenant connections, enriched with catalog metadata (joined in JS — no FK assumption). */
export async function listConnections(): Promise<ConnectionView[]> {
  const db = await getIntegrationsDb()
  const { data, error } = await db
    .from('tenant_connections')
    .select(
      'connection_id, organization_id, integration_id, connection_name, status, error_count, last_error, last_sync_at, next_sync_at, sync_enabled, sync_frequency_minutes',
    )
    .order('last_sync_at', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as RawConnection[]

  const ids = [
    ...new Set(
      rows.map((r) => r.integration_id).filter((x): x is string => !!x),
    ),
  ]
  const catMap = new Map<string, PartialCatalog>()
  if (ids.length > 0) {
    const { data: cat, error: cErr } = await db
      .from('integration_catalog')
      .select(
        'integration_id, integration_name, vendor_name, category, logo_url, auth_type, supports_webhooks, supports_real_time',
      )
      .in('integration_id', ids)
    if (cErr) throw new Error(cErr.message)
    for (const c of (cat ?? []) as unknown as PartialCatalog[]) {
      catMap.set(c.integration_id, c)
    }
  }

  return rows.map((r) => {
    const c = r.integration_id ? catMap.get(r.integration_id) : undefined
    return {
      connectionId: r.connection_id,
      organizationId: r.organization_id ?? null,
      name: r.connection_name ?? c?.integration_name ?? 'Connection',
      status: r.status ?? 'unknown',
      errorCount: r.error_count ?? 0,
      lastError: r.last_error ? r.last_error.slice(0, 200) : null,
      lastSyncAt: r.last_sync_at ?? null,
      nextSyncAt: r.next_sync_at ?? null,
      syncEnabled: r.sync_enabled ?? false,
      syncFrequencyMinutes: r.sync_frequency_minutes ?? null,
      integrationName: c?.integration_name ?? null,
      vendorName: c?.vendor_name ?? null,
      category: c?.category ?? null,
      logoUrl: c?.logo_url ?? null,
      authType: c?.auth_type ?? null,
      supportsWebhooks: c?.supports_webhooks ?? null,
      supportsRealTime: c?.supports_real_time ?? null,
    }
  })
}

/** Catalog grouped by category with counts (drives the marketplace filter chips). */
export async function getCategoryCounts(): Promise<CategoryCount[]> {
  const db = await getIntegrationsDb()
  const { data, error } = await db
    .from('integration_catalog')
    .select('category')
    .limit(1000)
  if (error) throw new Error(error.message)
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ category: string | null }>) {
    const cat = row.category ?? 'uncategorized'
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}

/** Hub KPIs computed from live connection + catalog + source-system state. */
export async function getHubStats(
  connsIn?: ConnectionView[],
  categoriesIn?: CategoryCount[],
): Promise<HubStats> {
  const db = await getIntegrationsDb()
  const conns = connsIn ?? (await listConnections())
  const now = Date.now()

  const connectedActive = conns.filter((c) => c.status === 'active').length
  const connectedError = conns.filter(
    (c) => c.status === 'error' || c.errorCount > 0,
  ).length
  const totalErrors = conns.reduce((s, c) => s + (c.errorCount || 0), 0)
  const syncedLast24h = conns.filter(
    (c) => c.lastSyncAt && now - new Date(c.lastSyncAt).getTime() < DAY_MS,
  ).length
  const staleCount = conns.filter(
    (c) => c.lastSyncAt && now - new Date(c.lastSyncAt).getTime() > 2 * DAY_MS,
  ).length
  const lastSyncAt = conns.reduce<string | null>((m, c) => {
    if (!c.lastSyncAt) return m
    if (!m || new Date(c.lastSyncAt) > new Date(m)) return c.lastSyncAt
    return m
  }, null)

  const categories = categoriesIn ?? (await getCategoryCounts())
  const catalogTotal = categories.reduce((s, c) => s + c.count, 0)

  const [totalRes, pendingRes] = await Promise.all([
    db
      .from('source_systems')
      .select('source_system_id', { count: 'exact', head: true }),
    db
      .from('source_systems')
      .select('source_system_id', { count: 'exact', head: true })
      .eq('connection_status', 'pending'),
  ])
  if (totalRes.error) throw new Error(totalRes.error.message)
  if (pendingRes.error) throw new Error(pendingRes.error.message)
  const sourceSystemsTotal = totalRes.count
  const sourceSystemsPending = pendingRes.count

  return {
    connectedTotal: conns.length,
    connectedActive,
    connectedError,
    totalErrors,
    lastSyncAt,
    syncedLast24h,
    staleCount,
    catalogTotal,
    categoriesTotal: categories.length,
    sourceSystemsTotal: sourceSystemsTotal ?? 0,
    sourceSystemsPending: sourceSystemsPending ?? 0,
  }
}

export interface CatalogQuery {
  category?: string
  q?: string
  limit?: number
}

/** Browse the integration catalog (the "add any future one" surface). */
export async function listCatalog(
  opts: CatalogQuery = {},
): Promise<CatalogEntry[]> {
  const db = await getIntegrationsDb()
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200)
  let q = db
    .from('integration_catalog')
    .select(
      'integration_id, integration_code, integration_name, vendor_name, category, subcategory, auth_type, description, logo_url, documentation_url, supports_webhooks, supports_real_time, supports_incremental_sync, setup_complexity, typical_sync_frequency, is_enterprise_only, tags',
    )
    .order('integration_name', { ascending: true })
    .limit(limit)
  if (opts.category && opts.category !== 'all') {
    q = q.eq('category', opts.category)
  }
  if (opts.q && opts.q.trim()) {
    // Whitelist to alphanumerics + space + hyphen. This drops PostgREST
    // or()-breaking chars (,()%*) AND the SQL LIKE wildcard `_` (which would
    // otherwise match everything) and quotes/dots that could alter filter
    // semantics — the safe, allowlist approach.
    const term = opts.q
      .trim()
      .replace(/[^A-Za-z0-9 -]/g, ' ')
      .trim()
    if (term) {
      q = q.or(`integration_name.ilike.%${term}%,vendor_name.ilike.%${term}%`)
    }
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as RawCatalog[]).map(mapCatalog)
}
