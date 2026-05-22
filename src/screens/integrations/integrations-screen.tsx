import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ConnectIcon,
  Search01Icon,
  RefreshIcon,
  Clock01Icon,
  ArrowRight01Icon,
  Notification03Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

// ── Types (mirror src/server/integrations/store.ts) ─────────────────────────
interface ConnectionView {
  connectionId: string
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
interface CatalogEntry {
  integrationId: string
  name: string
  vendor: string | null
  category: string | null
  authType: string | null
  description: string | null
  logoUrl: string | null
  documentationUrl: string | null
  supportsWebhooks: boolean | null
  supportsRealTime: boolean | null
  setupComplexity: string | null
  typicalSyncFrequency: string | null
  isEnterpriseOnly: boolean | null
}
interface CategoryCount {
  category: string
  count: number
}
interface HubStats {
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
interface OverviewResponse {
  ok: boolean
  error?: string
  stats: HubStats
  connections: ConnectionView[]
  categories: CategoryCount[]
}
interface CatalogResponse {
  ok: boolean
  error?: string
  items: CatalogEntry[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const DAY = 86_400_000

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return 'unknown'
  if (diff < -60_000) return 'scheduled'
  const m = Math.floor(Math.abs(diff) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}
function isStale(iso: string | null): boolean {
  if (!iso) return false
  const diff = Date.now() - new Date(iso).getTime()
  return !Number.isNaN(diff) && diff > 2 * DAY
}
function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

type StatusStyle = { dot: string; pill: string; label: string }
function statusStyle(status: string): StatusStyle {
  switch (status) {
    case 'active':
      return {
        dot: 'bg-emerald-500',
        pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        label: 'Active',
      }
    case 'error':
      return {
        dot: 'bg-red-500',
        pill: 'bg-red-500/10 text-red-700 dark:text-red-400',
        label: 'Error',
      }
    case 'paused':
      return {
        dot: 'bg-amber-500',
        pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        label: 'Paused',
      }
    default:
      return {
        dot: 'bg-primary-400',
        pill: 'bg-primary-500/10 text-primary-500',
        label: titleCase(status),
      }
  }
}

// Deterministic accent hue per category (visual grouping without a palette table).
function categoryHue(category: string | null): number {
  const s = category ?? 'other'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

// ── Logo / glyph ────────────────────────────────────────────────────────────
function Glyph({
  name,
  logoUrl,
  category,
  size = 40,
}: {
  name: string
  logoUrl: string | null
  category: string | null
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const hue = categoryHue(category)
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-xl object-contain bg-white"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-xl font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))`,
        fontSize: size * 0.36,
      }}
    >
      {initials(name)}
    </div>
  )
}

function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'good' | 'warn'
}) {
  const tones: Record<string, string> = {
    neutral:
      'border-primary-200 text-primary-600 dark:border-gray-700 dark:text-primary-400',
    accent:
      'border-accent-500/30 text-accent-600 dark:text-accent-400 bg-accent-500/5',
    good: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5',
    warn: 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

// ── KPI card ────────────────────────────────────────────────────────────────
function Kpi({
  label,
  value,
  sub,
  tone = 'accent',
  icon,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'accent' | 'good' | 'warn' | 'danger'
  icon?: unknown
}) {
  const bar: Record<string, string> = {
    accent: 'from-accent-500 to-amber-400',
    good: 'from-emerald-500 to-teal-400',
    warn: 'from-amber-500 to-yellow-400',
    danger: 'from-red-500 to-rose-400',
  }
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-1 bg-gradient-to-r',
          bar[tone],
        )}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">
          {label}
        </span>
        {icon ? (
          <HugeiconsIcon
            icon={icon as never}
            size={16}
            strokeWidth={1.6}
            className="text-primary-400"
          />
        ) : null}
      </div>
      <div className="mt-1.5 font-display text-3xl font-bold leading-none text-ink tabular-nums">
        {value}
      </div>
      {sub ? <p className="mt-1.5 text-xs text-primary-500">{sub}</p> : null}
    </div>
  )
}

// ── Connection card ─────────────────────────────────────────────────────────
function ConnectionCard({ c }: { c: ConnectionView }) {
  const st = statusStyle(c.status)
  const stale = isStale(c.lastSyncAt)
  return (
    <article className="group relative flex flex-col gap-3 rounded-2xl border border-primary-200 bg-white p-4 transition-shadow hover:shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start gap-3">
        <Glyph
          name={c.integrationName ?? c.name}
          logoUrl={c.logoUrl}
          category={c.category}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{c.name}</h2>
          <p className="truncate text-xs text-primary-500">
            {c.vendorName ?? c.integrationName ?? '—'}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium',
            st.pill,
          )}
        >
          <span className={cn('size-1.5 rounded-full', st.dot)} />
          {st.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {c.category ? <Chip tone="accent">{titleCase(c.category)}</Chip> : null}
        {c.supportsRealTime ? <Chip tone="good">real-time</Chip> : null}
        {c.supportsWebhooks ? <Chip>webhooks</Chip> : null}
        {c.authType ? <Chip>{c.authType}</Chip> : null}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-primary-100 pt-2.5 text-xs dark:border-gray-800">
        <span
          className={cn(
            'inline-flex items-center gap-1',
            stale ? 'text-amber-600 dark:text-amber-400' : 'text-primary-500',
          )}
          title={c.lastSyncAt ?? 'never synced'}
        >
          <HugeiconsIcon icon={Clock01Icon} size={13} strokeWidth={1.6} />
          {relTime(c.lastSyncAt)}
          {stale ? ' · stale' : ''}
        </span>
        {c.errorCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
            <HugeiconsIcon
              icon={Notification03Icon}
              size={13}
              strokeWidth={1.6}
            />
            {c.errorCount} error{c.errorCount > 1 ? 's' : ''}
          </span>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              c.syncEnabled
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-primary-400',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                c.syncEnabled ? 'bg-emerald-500' : 'bg-primary-300',
              )}
            />
            {c.syncEnabled ? 'auto-sync' : 'manual'}
          </span>
        )}
      </div>
    </article>
  )
}

// ── Catalog card ────────────────────────────────────────────────────────────
function CatalogCard({ e }: { e: CatalogEntry }) {
  return (
    <article className="group flex flex-col gap-2.5 rounded-2xl border border-primary-200 bg-white p-4 transition-all hover:border-accent-500/40 hover:shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start gap-3">
        <Glyph
          name={e.name}
          logoUrl={e.logoUrl}
          category={e.category}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{e.name}</h2>
          <p className="truncate text-xs text-primary-500">{e.vendor ?? '—'}</p>
        </div>
        {e.isEnterpriseOnly ? <Chip tone="warn">enterprise</Chip> : null}
      </div>
      {e.description ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-primary-500">
          {e.description}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {e.category ? <Chip tone="accent">{titleCase(e.category)}</Chip> : null}
        {e.authType ? <Chip>{e.authType}</Chip> : null}
        {e.setupComplexity ? <Chip>{e.setupComplexity} setup</Chip> : null}
        {e.supportsRealTime ? <Chip tone="good">real-time</Chip> : null}
      </div>
      <div className="mt-auto pt-1">
        {e.documentationUrl ? (
          <a
            href={e.documentationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded text-xs font-semibold text-accent-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 dark:text-accent-400"
          >
            Connect
            <span className="sr-only"> (opens in new tab)</span>
            <HugeiconsIcon icon={ArrowRight01Icon} size={13} strokeWidth={2} />
          </a>
        ) : (
          <span className="text-xs text-primary-400">Setup guide pending</span>
        )}
      </div>
    </article>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────
export function IntegrationsScreen() {
  const [tab, setTab] = useState<'connected' | 'catalog'>('connected')
  const [category, setCategory] = useState<string>('all')
  const [search, setSearch] = useState('')

  const overview = useQuery({
    queryKey: ['integrations', 'overview'],
    queryFn: async (): Promise<OverviewResponse> => {
      const r = await fetch('/api/integrations')
      const d = (await r.json()) as OverviewResponse
      if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`)
      return d
    },
    refetchInterval: 60_000,
  })

  const catalog = useQuery({
    queryKey: ['integrations', 'catalog', category],
    queryFn: async (): Promise<CatalogResponse> => {
      const params = new URLSearchParams({ limit: '200' })
      if (category !== 'all') params.set('category', category)
      const r = await fetch(`/api/integrations/catalog?${params.toString()}`)
      const d = (await r.json()) as CatalogResponse
      if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`)
      return d
    },
    enabled: tab === 'catalog',
  })

  const stats = overview.data?.stats
  const connections = overview.data?.connections ?? []
  const categories = overview.data?.categories ?? []

  const healthPct =
    stats && stats.connectedTotal > 0
      ? Math.round((stats.connectedActive / stats.connectedTotal) * 100)
      : 0

  const catalogItems = useMemo(() => {
    const items = catalog.data?.items ?? []
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.vendor ?? '').toLowerCase().includes(q),
    )
  }, [catalog.data, search])

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-primary-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/90">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-amber-400 text-white">
              <HugeiconsIcon icon={ConnectIcon} size={20} strokeWidth={1.8} />
            </span>
            <div>
              <h1 className="text-base font-bold text-ink">Integration Hub</h1>
              <p className="text-xs text-primary-500">
                {stats
                  ? `${stats.connectedTotal} connected · ${stats.catalogTotal} available across ${stats.categoriesTotal} categories`
                  : 'Loading integrations…'}
              </p>
            </div>
          </div>
          <div className="inline-flex rounded-xl border border-primary-200 bg-primary-50 p-1 dark:border-gray-700 dark:bg-gray-800">
            {(['connected', 'catalog'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900',
                  tab === t
                    ? 'bg-accent-500 text-white shadow-sm'
                    : 'text-primary-600 hover:text-ink',
                )}
              >
                {t === 'connected' ? 'Connected' : 'Browse Catalog'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="space-y-5 p-4">
        {/* KPI row */}
        <section
          aria-label="Key metrics"
          className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
        >
          <Kpi
            label="Connected"
            value={stats?.connectedTotal ?? '—'}
            sub={
              stats
                ? `${stats.connectedActive} active · ${stats.connectedError} with errors`
                : undefined
            }
            tone="accent"
            icon={ConnectIcon}
          />
          <Kpi
            label="Health"
            value={stats ? `${healthPct}%` : '—'}
            sub={stats ? `${stats.totalErrors} total errors` : undefined}
            tone={
              !stats
                ? 'accent'
                : healthPct >= 90
                  ? 'good'
                  : healthPct >= 60
                    ? 'warn'
                    : 'danger'
            }
          />
          <Kpi
            label="Freshness"
            value={stats ? relTime(stats.lastSyncAt) : '—'}
            sub={
              stats
                ? `${stats.syncedLast24h} synced in 24h · ${stats.staleCount} stale`
                : undefined
            }
            tone={stats && stats.staleCount > 0 ? 'warn' : 'good'}
            icon={Clock01Icon}
          />
          <Kpi
            label="Catalog"
            value={stats?.catalogTotal ?? '—'}
            sub={stats ? `${stats.categoriesTotal} categories` : undefined}
            tone="accent"
          />
          <Kpi
            label="Source Systems"
            value={stats?.sourceSystemsTotal ?? '—'}
            sub={
              stats
                ? `${stats.sourceSystemsPending} pending first sync`
                : undefined
            }
            tone={stats && stats.sourceSystemsPending > 0 ? 'warn' : 'good'}
          />
        </section>

        {/* Error banner */}
        {overview.isError ? (
          <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            <span>
              Failed to load integrations:{' '}
              {overview.error instanceof Error
                ? overview.error.message
                : 'unknown'}
            </span>
            <button
              type="button"
              onClick={() => void overview.refetch()}
              className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-xs hover:bg-red-500/10"
            >
              <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.6} />
              Retry
            </button>
          </div>
        ) : null}

        {/* Connected tab */}
        {tab === 'connected' ? (
          overview.isLoading ? (
            <p className="py-12 text-center text-sm text-primary-400">
              Loading connections…
            </p>
          ) : connections.length === 0 ? (
            <EmptyState
              title="No connections yet"
              body="Browse the catalog to connect your first integration."
              cta={() => setTab('catalog')}
            />
          ) : (
            <section
              aria-label="Connected integrations"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {connections.map((c) => (
                <ConnectionCard key={c.connectionId} c={c} />
              ))}
            </section>
          )
        ) : (
          /* Catalog tab */
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] max-w-sm flex-1">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={15}
                  strokeWidth={1.6}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary-400"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search 500+ integrations…"
                  aria-label="Search integrations"
                  className="w-full rounded-xl border border-primary-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
            </div>

            {/* Category chips */}
            <div className="flex flex-wrap gap-1.5">
              <CatChip
                label="All"
                count={stats?.catalogTotal}
                active={category === 'all'}
                onClick={() => setCategory('all')}
              />
              {categories.map((c) => (
                <CatChip
                  key={c.category}
                  label={titleCase(c.category)}
                  count={c.count}
                  active={category === c.category}
                  onClick={() => setCategory(c.category)}
                />
              ))}
            </div>

            {catalog.isError ? (
              <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                <span>
                  Failed to load catalog:{' '}
                  {catalog.error instanceof Error
                    ? catalog.error.message
                    : 'unknown'}
                </span>
                <button
                  type="button"
                  onClick={() => void catalog.refetch()}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-xs hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    size={13}
                    strokeWidth={1.6}
                  />
                  Retry
                </button>
              </div>
            ) : catalog.isLoading ? (
              <p className="py-12 text-center text-sm text-primary-400">
                Loading catalog…
              </p>
            ) : catalogItems.length === 0 ? (
              <EmptyState
                title="No matches"
                body="Try a different category or search term."
              />
            ) : (
              <section
                aria-label="Integration catalog"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              >
                {catalogItems.map((e) => (
                  <CatalogCard key={e.integrationId} e={e} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CatChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900',
        active
          ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
          : 'border-primary-200 text-primary-600 hover:border-primary-300 hover:text-ink dark:border-gray-700 dark:text-primary-400',
      )}
    >
      {label}
      {typeof count === 'number' ? (
        <span
          className={cn(
            'tabular-nums',
            active
              ? 'text-accent-600 dark:text-accent-400'
              : 'text-primary-400',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string
  body: string
  cta?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary-200 py-16 text-center dark:border-gray-700">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary-100 text-primary-400 dark:bg-gray-800">
        <HugeiconsIcon icon={ConnectIcon} size={24} strokeWidth={1.5} />
      </span>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="max-w-xs text-xs text-primary-500">{body}</p>
      {cta ? (
        <button
          type="button"
          onClick={cta}
          className="mt-1 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-600"
        >
          Browse catalog
        </button>
      ) : null}
    </div>
  )
}
