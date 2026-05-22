// Postiz module — main screen with Compose | Scheduled | Insights | Accounts
// tabs. Uses the mission-control palette (--mc-* tokens) inline so the screen
// works whether or not src/lib/mc-tokens.ts has been extracted yet.
//
// LinkedIn is excluded everywhere — the LinkedIn module has its own dedicated
// screen at src/screens/linkedin/linkedin-screen.tsx.
//
// Called from: src/routes/postiz.tsx.

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type CSSProperties } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CalendarAdd02Icon,
  ChartLineData02Icon,
  Edit02Icon,
  PlugSocketIcon,
  Share01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { AnalyticsAccount } from '@/routes/api/postiz/analytics'
import { isForbiddenPlatform } from '@/shared/postiz-platforms'
import { PostizAccounts } from './postiz-accounts'
import { PostizComposer } from './postiz-composer'
import { PostizScheduledList } from './postiz-scheduled-list'
import { PostizConnectCard } from './components/postiz-connect-card'

// Postiz screen reads visually identical to the rest of the mission-control
// surface. When src/lib/mc-tokens.ts ships, swap this for an import.
const MC_STYLE: CSSProperties = {
  ['--mc-bg' as string]: '#070A11',
  ['--mc-surface' as string]: '#0D131D',
  ['--mc-surface-2' as string]: '#12192680',
  ['--mc-border' as string]: 'rgba(0, 229, 255, 0.10)',
  ['--mc-border-bright' as string]: 'rgba(0, 229, 255, 0.32)',
  ['--mc-text' as string]: '#E6F1FF',
  ['--mc-text-dim' as string]: '#8FA3BF',
  ['--mc-text-dimmer' as string]: '#7A8FA8',
  ['--mc-cyan' as string]: '#00E5FF',
  ['--mc-cyan-soft' as string]: 'rgba(0, 229, 255, 0.12)',
  ['--mc-magenta' as string]: '#FF4FD8',
  ['--mc-magenta-soft' as string]: 'rgba(255, 79, 216, 0.14)',
  ['--mc-amber' as string]: '#FFB547',
  ['--mc-amber-soft' as string]: 'rgba(255, 181, 71, 0.14)',
  ['--mc-emerald' as string]: '#3DF5A1',
  ['--mc-emerald-soft' as string]: 'rgba(61, 245, 161, 0.14)',
  ['--mc-rose' as string]: '#FF6B8B',
  ['--mc-rose-soft' as string]: 'rgba(255, 107, 139, 0.14)',
}

type TabKey = 'compose' | 'scheduled' | 'insights' | 'accounts'

interface AccountsResp {
  ok: boolean
  baseUrl?: string
}

interface AnalyticsResp {
  ok: boolean
  accounts?: AnalyticsAccount[]
  error?: string
  hint?: string
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Edit02Icon
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
      )}
      style={{
        borderColor: active ? 'var(--mc-cyan)' : 'transparent',
        color: active ? 'var(--mc-cyan)' : 'var(--mc-text-dim)',
      }}
    >
      <HugeiconsIcon icon={icon} className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  )
}

function PostizInsights() {
  const query = useQuery<AnalyticsResp>({
    queryKey: ['postiz', 'analytics'],
    queryFn: async () => {
      const res = await fetch('/api/postiz/analytics', {
        credentials: 'include',
      })
      return (await res.json()) as AnalyticsResp
    },
    refetchInterval: 60_000,
  })

  const accounts = (query.data?.accounts ?? []).filter(
    (a) => !isForbiddenPlatform(a.identifier),
  )

  if (query.isLoading) {
    return (
      <div className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
        Loading analytics…
      </div>
    )
  }

  // The analytics route returns ok=false + 200 when the Postiz instance does
  // not expose analytics. We render an honest empty state rather than fake
  // any numbers.
  if (query.data && !query.data.ok) {
    return (
      <div
        className="rounded-md border border-dashed px-4 py-6 text-sm"
        style={{
          borderColor: 'var(--mc-border-bright)',
          background: 'var(--mc-surface)',
          color: 'var(--mc-text-dim)',
        }}
      >
        <div
          className="text-base font-medium"
          style={{ color: 'var(--mc-text)' }}
        >
          {query.data.error || 'Analytics unavailable'}
        </div>
        <div className="mt-1 text-xs">
          {query.data.hint ??
            'Some self-hosted Postiz builds do not expose the public analytics endpoint. Use the Postiz dashboard for full reporting in the meantime.'}
        </div>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm"
        style={{
          borderColor: 'var(--mc-border-bright)',
          color: 'var(--mc-text-dim)',
        }}
      >
        <HugeiconsIcon
          icon={ChartLineData02Icon}
          className="h-6 w-6"
          aria-hidden="true"
        />
        <div>No analytics rows returned by Postiz.</div>
        <div className="text-xs">
          Once you publish a few posts, per-account metrics will appear here
          (only what Postiz itself reports — no fabrications).
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((a) => (
        <article
          key={a.identifier}
          className="rounded-lg border p-4"
          style={{
            borderColor: 'var(--mc-border-bright)',
            background: 'var(--mc-surface)',
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1 py-0.5 font-mono text-[10px] uppercase"
              style={{
                background: 'var(--mc-surface-2)',
                color: 'var(--mc-text-dim)',
              }}
            >
              {a.identifier}
            </span>
            <span
              className="truncate text-sm font-medium"
              style={{ color: 'var(--mc-text)' }}
              title={a.name}
            >
              {a.name}
            </span>
          </div>
          <dl
            className="mt-3 grid grid-cols-2 gap-2 text-xs"
            style={{ color: 'var(--mc-text-dim)' }}
          >
            <div>
              <dt className="text-[10px] uppercase tracking-wide">followers</dt>
              <dd
                className="text-lg font-semibold"
                style={{ color: 'var(--mc-text)' }}
              >
                {a.followers !== null ? a.followers.toLocaleString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide">posts</dt>
              <dd
                className="text-lg font-semibold"
                style={{ color: 'var(--mc-text)' }}
              >
                {a.postsCount !== null ? a.postsCount.toLocaleString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide">
                impressions
              </dt>
              <dd
                className="text-lg font-semibold"
                style={{ color: 'var(--mc-text)' }}
              >
                {a.impressions !== null ? a.impressions.toLocaleString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide">
                engagement
              </dt>
              <dd
                className="text-lg font-semibold"
                style={{ color: 'var(--mc-text)' }}
              >
                {a.engagement !== null ? a.engagement.toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
          {a.computedAt ? (
            <div
              className="mt-2 text-[10px]"
              style={{ color: 'var(--mc-text-dimmer)' }}
              title={a.computedAt}
            >
              computed {new Date(a.computedAt).toLocaleString()}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

export function PostizScreen() {
  // We grab the baseUrl from the accounts query (cached) so the Scheduled tab
  // can render "Edit in Postiz" deep-links without re-fetching.
  const accountsQuery = useQuery<AccountsResp>({
    queryKey: ['postiz', 'accounts'],
    queryFn: async () => {
      const res = await fetch('/api/postiz/accounts', {
        credentials: 'include',
      })
      return (await res.json()) as AccountsResp
    },
    refetchInterval: 60_000,
  })
  const postizBaseUrl = accountsQuery.data?.baseUrl ?? null

  const [tab, setTab] = useState<TabKey>('compose')

  // After an OAuth round-trip the callback redirects to /postiz?connected=1
  // or /postiz?error=<x>. Land on the Accounts tab so the user sees the
  // PostizConnectCard banner + status. PostizConnectCard itself strips the
  // query string after reading it, so this only fires once per redirect.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = window.location.search
    if (!search) return
    const params = new URLSearchParams(search)
    if (params.get('connected') === '1' || params.has('error')) {
      setTab('accounts')
    }
  }, [])

  return (
    <div
      className="flex h-full flex-col gap-6 overflow-hidden p-6"
      style={{
        ...MC_STYLE,
        background: 'var(--mc-bg)',
        color: 'var(--mc-text)',
        maxWidth: 1560,
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            className="flex items-center gap-3 text-2xl font-semibold"
            style={{ color: 'var(--mc-text)' }}
          >
            <HugeiconsIcon
              icon={Share01Icon}
              className="h-6 w-6"
              style={{ color: 'var(--mc-magenta)' }}
              aria-hidden="true"
            />
            Postiz
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--mc-text-dim)' }}>
            Multi-platform composer, scheduling, and connected-account
            management. LinkedIn lives in its own module.
          </p>
        </div>
        {postizBaseUrl ? (
          <a
            href={postizBaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
            )}
            style={{
              borderColor: 'var(--mc-border-bright)',
              background: 'var(--mc-surface)',
              color: 'var(--mc-text)',
            }}
            title={postizBaseUrl}
          >
            Open Postiz dashboard ↗
          </a>
        ) : null}
      </div>

      {/* Tab nav */}
      <div
        role="tablist"
        aria-label="Postiz workspace"
        className="flex shrink-0 items-center gap-1 border-b"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        <TabButton
          active={tab === 'compose'}
          onClick={() => setTab('compose')}
          icon={Edit02Icon}
          label="Compose"
        />
        <TabButton
          active={tab === 'scheduled'}
          onClick={() => setTab('scheduled')}
          icon={CalendarAdd02Icon}
          label="Scheduled"
        />
        <TabButton
          active={tab === 'insights'}
          onClick={() => setTab('insights')}
          icon={ChartLineData02Icon}
          label="Insights"
        />
        <TabButton
          active={tab === 'accounts'}
          onClick={() => setTab('accounts')}
          icon={PlugSocketIcon}
          label="Accounts"
        />
      </div>

      {/* Tab panels — every panel wrapped to honor reduced-motion */}
      {tab === 'compose' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-hidden motion-reduce:[animation:none!important]"
        >
          <PostizComposer />
        </div>
      ) : null}

      {tab === 'scheduled' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto motion-reduce:[animation:none!important]"
        >
          <PostizScheduledList postizBaseUrl={postizBaseUrl} />
        </div>
      ) : null}

      {tab === 'insights' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto motion-reduce:[animation:none!important]"
        >
          <PostizInsights />
        </div>
      ) : null}

      {tab === 'accounts' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto motion-reduce:[animation:none!important]"
        >
          <PostizConnectCard />
          <PostizAccounts />
        </div>
      ) : null}
    </div>
  )
}
