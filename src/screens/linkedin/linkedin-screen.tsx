// Sub-project D Phase 4 — LinkedIn Insights screen for ClawSuite.
// Shows worker health, queue depth, top posts, recent comments — plus the
// OAuth identities section (added 2026-05-19) that lets you see which
// LinkedIn accounts are connected and reconnect them when scopes drift.
// Four TanStack Queries polling at 10/30/30/30s.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ChartLineData02Icon,
  Clock01Icon,
  Edit02Icon,
  PlugSocketIcon,
  UserAccountIcon,
  CheckmarkCircle02Icon,
  Alert02Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { LinkedInComposer } from './linkedin-composer'
import { LinkedInWebhooks } from './linkedin-webhooks'
import { LinkedInConversions } from './linkedin-conversions'

interface HeartbeatPayload {
  updated_at: string
  loop_started_at: string
  jobs_claimed_total: number
  jobs_processed_total: number
  jobs_failed_total: number
  last_poll_completed_at: string | null
  current_pending_count: number | null
  last_error: string | null
}

interface StatusResponse {
  ok: boolean
  status: 'online' | 'stale' | 'offline'
  heartbeat: HeartbeatPayload | null
  queue: {
    pending: number | null
    errored: number | null
    oldest_next_poll_at: string | null
    error?: string
  }
  error?: string
}

interface PostRow {
  content_id: string
  post_urn: string
  post_url: string | null
  account_handle: string | null
  account_kind: 'company' | 'member'
  body_text: string | null
  hashtags: string[] | null
  published_at: string
  likes_count: number | null
  comments_count: number | null
  last_engagement_check_at: string | null
  engagement_scope_limited: boolean | null
  engagement_error: string | null
  engagement_score: number | null
  percentile_vs_account: number | null
  percentile_vs_corpus: number | null
  signals_computed_at: string | null
  comments_thread_count: number
  next_poll_at: string | null
  last_polled_at: string | null
  age_bucket: string | null
  consecutive_errors: number | null
  schedule_last_error: string | null
}

interface PostsResponse {
  ok: boolean
  posts: PostRow[]
  error?: string
}

interface CommentRow {
  comment_urn: string
  content_id: string
  post_urn: string
  author_urn: string
  author_name: string | null
  author_headline: string | null
  body: string
  posted_at: string
  reactions_count: number
  parent_comment_urn: string | null
  first_seen_at: string
}

interface CommentsResponse {
  ok: boolean
  comments: CommentRow[]
  error?: string
}

interface IdentityRow {
  identity_type: 'person' | 'organization'
  linkedin_id: string
  display_name: string
  scopes: string[]
  expires_at: string
  refresh_expires_at: string | null
  last_refreshed_at: string
  organization_id: string
}

interface IdentitiesResponse {
  ok: boolean
  identities: IdentityRow[]
  error?: string
}

interface AuthStartResponse {
  ok: boolean
  identity_type?: 'person' | 'organization'
  authorization_url?: string
  scopes?: string[]
  expires_in_seconds?: number
  error?: string
  hint?: string
}

// Scopes that LinkedIn-D's worker actually needs. Cards highlight which are
// missing so it's obvious when a token needs reconnect.
const REQUIRED_SCOPES_PERSON = ['r_member_social', 'w_member_social'] as const
const REQUIRED_SCOPES_ORG = [
  'r_organization_social',
  'w_organization_social',
  'rw_organization_admin',
] as const

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const ageS = Math.floor((Date.now() - t) / 1000)
  if (ageS < 60) return `${ageS}s ago`
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`
  if (ageS < 86_400) return `${Math.floor(ageS / 3600)}h ago`
  return `${Math.floor(ageS / 86_400)}d ago`
}

function StatusDot({ status }: { status: 'online' | 'stale' | 'offline' }) {
  const color =
    status === 'online'
      ? 'bg-emerald-500'
      : status === 'stale'
        ? 'bg-amber-500'
        : 'bg-rose-500'
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        color,
        status === 'online' && 'animate-pulse',
      )}
      aria-label={`worker ${status}`}
    />
  )
}

function IdentityCard({
  identity,
  onReconnect,
  reconnecting,
}: {
  identity: IdentityRow
  onReconnect: (identityType: 'person' | 'organization') => void
  reconnecting: boolean
}) {
  const required =
    identity.identity_type === 'person'
      ? REQUIRED_SCOPES_PERSON
      : REQUIRED_SCOPES_ORG
  const missing = required.filter((s) => !identity.scopes.includes(s))
  const accessExpiresMs = new Date(identity.expires_at).getTime() - Date.now()
  const accessExpired = accessExpiresMs <= 0
  const accessDaysLeft = Math.floor(accessExpiresMs / 86_400_000)
  const refreshExpiresMs = identity.refresh_expires_at
    ? new Date(identity.refresh_expires_at).getTime() - Date.now()
    : null
  const refreshExpired = refreshExpiresMs !== null && refreshExpiresMs <= 0
  const healthy = missing.length === 0 && !accessExpired && !refreshExpired

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        healthy
          ? 'border-primary-800/50 bg-primary-900/40'
          : 'border-amber-700/50 bg-amber-950/30',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={UserAccountIcon}
              className="h-4 w-4 text-primary-400"
            />
            <span className="font-medium text-primary-100">
              {identity.display_name}
            </span>
            <span className="rounded bg-primary-800/50 px-1.5 py-0.5 text-xs text-primary-400">
              {identity.identity_type}
            </span>
            {healthy ? (
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="h-4 w-4 text-emerald-400"
                aria-label="all required scopes present"
              />
            ) : (
              <HugeiconsIcon
                icon={Alert02Icon}
                className="h-4 w-4 text-amber-400"
                aria-label="missing required scopes or expired"
              />
            )}
          </div>
          <div className="mt-1 text-xs text-primary-500">
            linkedin_id:{' '}
            <code className="text-primary-400">{identity.linkedin_id}</code>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {identity.scopes.map((s) => {
              const isRequired = (required as readonly string[]).includes(s)
              return (
                <span
                  key={s}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs',
                    isRequired
                      ? 'bg-emerald-900/40 text-emerald-300'
                      : 'bg-primary-800/40 text-primary-400',
                  )}
                  title={isRequired ? 'required scope present' : undefined}
                >
                  {s}
                </span>
              )
            })}
            {missing.map((s) => (
              <span
                key={s}
                className="rounded bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-300"
                title="required scope MISSING — reconnect to grant"
              >
                ⚠ {s}
              </span>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-primary-500">
            <div>
              access{' '}
              {accessExpired ? (
                <span className="text-rose-400">expired</span>
              ) : (
                <span>{accessDaysLeft}d left</span>
              )}
            </div>
            <div>
              refresh{' '}
              {refreshExpired ? (
                <span className="text-rose-400">expired</span>
              ) : refreshExpiresMs !== null ? (
                <span>{Math.floor(refreshExpiresMs / 86_400_000)}d left</span>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="col-span-2">
              refreshed {formatRelative(identity.last_refreshed_at)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            type="button"
            onClick={() => onReconnect(identity.identity_type)}
            disabled={reconnecting}
            title="Open LinkedIn's OAuth consent flow to grant new/refreshed scopes to this token"
            className={cn(
              'rounded-md border border-primary-700/50 bg-primary-800/40 px-3 py-1.5 text-xs font-medium text-primary-100',
              'hover:bg-primary-700/40 focus:outline-none focus:ring-2 focus:ring-primary-600',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {reconnecting ? 'Opening…' : 'Reconnect'}
          </button>
          {/* Separate link to the LinkedIn DEVELOPER PORTAL — different
              destination from Reconnect. Reconnect = OAuth grant flow
              (refreshes scopes on the user token). Dev Portal = manage the
              APP itself (verify redirect URIs, request Community Management
              API, view product approvals, etc.). Operators were conflating
              the two, so they're surfaced as distinct affordances. */}
          <a
            href="https://www.linkedin.com/developers/apps"
            target="_blank"
            rel="noopener noreferrer"
            title="Open the LinkedIn Developer Portal (manage the app: redirect URIs, products, scopes)"
            className={cn(
              'rounded-md border border-primary-700/50 bg-primary-900/40 px-3 py-1.5 text-center text-[11px] font-medium text-primary-300',
              'hover:bg-primary-800/40 focus:outline-none focus:ring-2 focus:ring-primary-600',
            )}
          >
            Dev Portal ↗
          </a>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-primary-800/50 bg-primary-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-primary-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-primary-100">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-primary-500">{hint}</div>
      ) : null}
    </div>
  )
}

export function LinkedInScreen() {
  const statusQuery = useQuery<StatusResponse>({
    queryKey: ['linkedin', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/linkedin/status', {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const postsQuery = useQuery<PostsResponse>({
    queryKey: ['linkedin', 'posts'],
    queryFn: async () => {
      const res = await fetch('/api/linkedin/posts?limit=20', {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    },
    refetchInterval: 30_000,
  })

  const commentsQuery = useQuery<CommentsResponse>({
    queryKey: ['linkedin', 'comments'],
    queryFn: async () => {
      const res = await fetch('/api/linkedin/comments?limit=25', {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    },
    refetchInterval: 30_000,
  })

  const queryClient = useQueryClient()
  const [connectError, setConnectError] = useState<string | null>(null)

  const identitiesQuery = useQuery<IdentitiesResponse>({
    queryKey: ['linkedin', 'identities'],
    queryFn: async () => {
      const res = await fetch('/api/linkedin/identities', {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    },
    refetchInterval: 30_000,
  })

  const connectMutation = useMutation<
    AuthStartResponse,
    Error,
    'person' | 'organization'
  >({
    mutationFn: async (identityType) => {
      const res = await fetch('/api/linkedin/auth/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity_type: identityType }),
      })
      const body = (await res.json()) as AuthStartResponse
      if (!res.ok || !body.ok || !body.authorization_url) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      return body
    },
    onSuccess: (data) => {
      setConnectError(null)
      if (data.authorization_url) {
        // Pop the LinkedIn consent in a new tab. The callback lands on the
        // MCP's /oauth/callback (separate process); identities query polls
        // every 30s so the new row will surface automatically.
        window.open(data.authorization_url, '_blank', 'noopener,noreferrer')
        // Invalidate so the next poll fires sooner.
        void queryClient.invalidateQueries({
          queryKey: ['linkedin', 'identities'],
        })
      }
    },
    onError: (err) => {
      setConnectError(err.message)
    },
  })

  const heartbeat = statusQuery.data?.heartbeat ?? null
  const status = statusQuery.data?.status ?? 'offline'
  const queue = statusQuery.data?.queue
  const identities = identitiesQuery.data?.identities ?? []
  const reconnectingType = connectMutation.isPending
    ? (connectMutation.variables ?? null)
    : null

  const [activeTab, setActiveTab] = useState<
    'compose' | 'insights' | 'webhooks' | 'conversions'
  >('compose')

  // 2026-05-19 — composer-shaped IdentityOption matches the columns the
  // composer needs (identity_type, linkedin_id, display_name, scopes). The
  // IdentityRow above also has these, so a direct pass-through is safe.
  const identityOptions = identities.map((i) => ({
    identity_type: i.identity_type,
    linkedin_id: i.linkedin_id,
    display_name: i.display_name,
    scopes: i.scopes,
    organization_id: i.organization_id,
  }))
  const identitiesErrorMessage = identitiesQuery.error
    ? (identitiesQuery.error as Error).message
    : identitiesQuery.data?.ok === false
      ? (identitiesQuery.data.error ?? 'Failed to load identities')
      : null

  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-primary-100">
            <HugeiconsIcon icon={ChartLineData02Icon} className="h-6 w-6" />
            LinkedIn
          </h1>
          <p className="mt-1 text-sm text-primary-400">
            Compose posts with media, get AI coaching, monitor engagement.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-primary-800/50 bg-primary-900/40 px-3 py-2">
          <StatusDot status={status} />
          <span className="text-sm font-medium text-primary-100">
            Worker {status}
          </span>
          {heartbeat ? (
            <span className="text-xs text-primary-500">
              · last beat {formatRelative(heartbeat.updated_at)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Tab nav */}
      <div
        role="tablist"
        aria-label="LinkedIn workspace"
        className="flex shrink-0 items-center gap-1 border-b border-primary-800/50"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'compose'}
          onClick={() => setActiveTab('compose')}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-cyan-400',
            activeTab === 'compose'
              ? 'border-cyan-400 text-cyan-200'
              : 'border-transparent text-primary-400 hover:text-primary-200',
          )}
        >
          <HugeiconsIcon
            icon={Edit02Icon}
            className="h-4 w-4"
            aria-hidden="true"
          />
          Compose
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'insights'}
          onClick={() => setActiveTab('insights')}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-cyan-400',
            activeTab === 'insights'
              ? 'border-cyan-400 text-cyan-200'
              : 'border-transparent text-primary-400 hover:text-primary-200',
          )}
        >
          <HugeiconsIcon
            icon={ChartLineData02Icon}
            className="h-4 w-4"
            aria-hidden="true"
          />
          Insights
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'webhooks'}
          onClick={() => setActiveTab('webhooks')}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-cyan-400',
            activeTab === 'webhooks'
              ? 'border-cyan-400 text-cyan-200'
              : 'border-transparent text-primary-400 hover:text-primary-200',
          )}
        >
          Webhooks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'conversions'}
          onClick={() => setActiveTab('conversions')}
          className={cn(
            'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-cyan-400',
            activeTab === 'conversions'
              ? 'border-cyan-400 text-cyan-200'
              : 'border-transparent text-primary-400 hover:text-primary-200',
          )}
        >
          Conversions
        </button>
      </div>

      {/* Compose tab */}
      {activeTab === 'compose' ? (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-hidden">
          <LinkedInComposer
            identities={identityOptions}
            identitiesLoading={identitiesQuery.isLoading}
            identitiesError={identitiesErrorMessage}
          />
        </div>
      ) : null}

      {activeTab === 'insights' ? (
        <div
          role="tabpanel"
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto"
        >
          {/* Connected identities + OAuth controls */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-medium text-primary-100">
                <HugeiconsIcon
                  icon={PlugSocketIcon}
                  className="h-5 w-5 text-primary-400"
                />
                Connected identities
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => connectMutation.mutate('person')}
                  disabled={connectMutation.isPending}
                  className={cn(
                    'rounded-md border border-primary-700/50 bg-primary-800/40 px-3 py-1.5 text-xs font-medium text-primary-100',
                    'hover:bg-primary-700/40 focus:outline-none focus:ring-2 focus:ring-primary-600',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {reconnectingType === 'person'
                    ? 'Opening…'
                    : 'Connect person'}
                </button>
                <button
                  type="button"
                  onClick={() => connectMutation.mutate('organization')}
                  disabled={connectMutation.isPending}
                  className={cn(
                    'rounded-md border border-primary-700/50 bg-primary-800/40 px-3 py-1.5 text-xs font-medium text-primary-100',
                    'hover:bg-primary-700/40 focus:outline-none focus:ring-2 focus:ring-primary-600',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {reconnectingType === 'organization'
                    ? 'Opening…'
                    : 'Connect organization'}
                </button>
              </div>
            </div>

            {connectError ? (
              <div className="rounded-md border border-rose-700/50 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
                <div className="font-medium">Could not start OAuth flow</div>
                <div className="mt-1 text-xs text-rose-400">{connectError}</div>
                <div className="mt-1 text-xs text-rose-500">
                  Most common cause: linkedin-mcp not running on :8120, or
                  http://localhost:8120/oauth/callback not in the dev app's
                  Authorized Redirect URLs.
                </div>
              </div>
            ) : null}

            {identitiesQuery.isLoading ? (
              <div className="text-sm text-primary-400">
                Loading identities…
              </div>
            ) : identitiesQuery.error || !identitiesQuery.data?.ok ? (
              <div className="text-sm text-rose-400">
                Error:{' '}
                {identitiesQuery.data?.error ??
                  (identitiesQuery.error as Error)?.message}
              </div>
            ) : identities.length === 0 ? (
              <div className="rounded-lg border border-dashed border-primary-800/50 p-6 text-center text-sm text-primary-500">
                No LinkedIn identities connected yet. Click&nbsp;
                <strong>Connect person</strong> to authorize Thiago's personal
                account, or <strong>Connect organization</strong> to authorize
                the PulseCheck AI company page.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {identities.map((id) => (
                  <IdentityCard
                    key={`${id.identity_type}:${id.linkedin_id}`}
                    identity={id}
                    onReconnect={(t) => connectMutation.mutate(t)}
                    reconnecting={reconnectingType === id.identity_type}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Worker stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Jobs claimed"
              value={heartbeat?.jobs_claimed_total ?? '—'}
              hint={
                heartbeat?.loop_started_at
                  ? `since ${formatRelative(heartbeat.loop_started_at)}`
                  : undefined
              }
            />
            <StatCard
              label="Jobs processed"
              value={heartbeat?.jobs_processed_total ?? '—'}
            />
            <StatCard
              label="Jobs failed"
              value={heartbeat?.jobs_failed_total ?? '—'}
              hint={
                heartbeat?.last_error
                  ? `last error: ${heartbeat.last_error}`
                  : undefined
              }
            />
            <StatCard
              label="Queue pending"
              value={queue?.pending ?? (queue?.error ? 'err' : '—')}
              hint={
                queue?.oldest_next_poll_at
                  ? `oldest due ${formatRelative(queue.oldest_next_poll_at)}`
                  : undefined
              }
            />
          </div>

          {/* Top posts */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-primary-100">
                Top posts · last 30d
              </h2>
              <span className="text-xs text-primary-500">
                {postsQuery.data?.posts.length ?? 0} loaded
              </span>
            </div>
            {postsQuery.isLoading ? (
              <div className="text-sm text-primary-400">Loading posts…</div>
            ) : postsQuery.error || !postsQuery.data?.ok ? (
              <div className="text-sm text-rose-400">
                Error:{' '}
                {postsQuery.data?.error ?? (postsQuery.error as Error)?.message}
              </div>
            ) : postsQuery.data.posts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-primary-800/50 p-6 text-center text-sm text-primary-500">
                No LinkedIn posts tracked yet. Posts published via the LinkedIn
                MCP will appear here automatically once the worker polls them.
              </div>
            ) : (
              <div className="space-y-2">
                {postsQuery.data.posts.map((p) => (
                  <article
                    key={p.content_id}
                    className="rounded-lg border border-primary-800/50 bg-primary-900/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-primary-500">
                          <span className="rounded bg-primary-800/50 px-2 py-0.5">
                            {p.account_kind}
                          </span>
                          <span>{p.account_handle ?? 'unknown'}</span>
                          <span>·</span>
                          <span title={p.published_at}>
                            {formatRelative(p.published_at)}
                          </span>
                          {p.age_bucket ? (
                            <>
                              <span>·</span>
                              <span className="rounded bg-primary-800/50 px-1.5 py-0.5">
                                {p.age_bucket}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm text-primary-200">
                          {p.body_text ?? '(no body)'}
                        </p>
                        {p.hashtags && p.hashtags.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {p.hashtags.map((h) => (
                              <span
                                key={h}
                                className="rounded bg-primary-800/30 px-2 py-0.5 text-xs text-primary-400"
                              >
                                #{h}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-primary-400">
                        <span>
                          <strong className="text-primary-100">
                            {p.likes_count ?? 0}
                          </strong>{' '}
                          reactions
                        </span>
                        <span>
                          <strong className="text-primary-100">
                            {p.comments_count ?? 0}
                          </strong>{' '}
                          comments
                          {p.comments_thread_count > 0 ? (
                            <span className="text-primary-500">
                              {' '}
                              ({p.comments_thread_count} stored)
                            </span>
                          ) : null}
                        </span>
                        {p.engagement_score != null ? (
                          <span>
                            score{' '}
                            <strong className="text-primary-100">
                              {(p.engagement_score * 100).toFixed(0)}
                            </strong>
                          </span>
                        ) : null}
                        {p.engagement_scope_limited ? (
                          <span className="text-amber-400">scope-limited</span>
                        ) : null}
                      </div>
                    </div>
                    {p.last_polled_at ? (
                      <div className="mt-2 flex items-center gap-1 text-xs text-primary-500">
                        <HugeiconsIcon icon={Clock01Icon} className="h-3 w-3" />
                        polled {formatRelative(p.last_polled_at)}
                        {p.next_poll_at ? (
                          <span>· next {formatRelative(p.next_poll_at)}</span>
                        ) : null}
                        {p.consecutive_errors && p.consecutive_errors > 0 ? (
                          <span className="text-rose-400">
                            · {p.consecutive_errors} errs
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Recent comments */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-primary-100">
                Recent comments
              </h2>
              <span className="text-xs text-primary-500">
                {commentsQuery.data?.comments.length ?? 0} loaded
              </span>
            </div>
            {commentsQuery.isLoading ? (
              <div className="text-sm text-primary-400">Loading comments…</div>
            ) : commentsQuery.error || !commentsQuery.data?.ok ? (
              <div className="text-sm text-rose-400">
                Error:{' '}
                {commentsQuery.data?.error ??
                  (commentsQuery.error as Error)?.message}
              </div>
            ) : commentsQuery.data.comments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-primary-800/50 p-6 text-center text-sm text-primary-500">
                No comments ingested yet. Comments on tracked posts appear here
                as the worker polls them on the decaying-cadence schedule.
              </div>
            ) : (
              <div className="space-y-2">
                {commentsQuery.data.comments.map((c) => (
                  <div
                    key={c.comment_urn}
                    className="rounded-lg border border-primary-800/50 bg-primary-900/40 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2 text-xs text-primary-500">
                      <span className="text-primary-300">
                        {c.author_name ?? c.author_urn}
                      </span>
                      {c.author_headline ? (
                        <span className="text-primary-500">
                          · {c.author_headline}
                        </span>
                      ) : null}
                      <span>·</span>
                      <span title={c.posted_at}>
                        {formatRelative(c.posted_at)}
                      </span>
                      {c.reactions_count > 0 ? (
                        <span className="text-primary-400">
                          · {c.reactions_count} reactions
                        </span>
                      ) : null}
                      {c.parent_comment_urn ? (
                        <span className="rounded bg-primary-800/40 px-1.5 py-0.5">
                          reply
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-primary-200">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === 'webhooks' ? (
        <div
          role="tabpanel"
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto"
        >
          <LinkedInWebhooks />
        </div>
      ) : null}

      {activeTab === 'conversions' ? (
        <div
          role="tabpanel"
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto"
        >
          <LinkedInConversions />
        </div>
      ) : null}
    </div>
  )
}
