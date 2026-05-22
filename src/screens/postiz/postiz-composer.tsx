// Postiz composer — left ~62% editor + media + platform picker; right ~38%
// integrated AI chat panel.
//
// Pulls connected accounts from GET /api/postiz/accounts (already filters
// LinkedIn server-side; we re-filter defensively). Publishes via
// POST /api/postiz/post with platforms + content + mediaUrls + scheduleAt.
//
// Char-limit table is mirrored client-side here. The canonical table lives
// in src/routes/api/postiz/_client.ts (server module — cannot be imported by
// a client bundle since it touches process.env). Keep the two in sync.
//
// Called from: src/screens/postiz/postiz-screen.tsx (Compose tab).

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Edit02Icon,
  Loading03Icon,
  Rocket01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { PostizAccount } from '@/routes/api/postiz/accounts'
import { PostizChatPanel } from './postiz-chat-panel'
import { PostizMediaUploader, type PostizMedia } from './postiz-media-uploader'

// Mirror of PLATFORM_CHAR_LIMITS in src/routes/api/postiz/_client.ts.
// Keep in sync; cannot import the server module from this client bundle.
const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  threads: 500,
  bluesky: 300,
  mastodon: 500,
  instagram: 2200,
  'instagram-standalone': 2200,
  facebook: 63206,
  youtube: 5000,
  tiktok: 2200,
  reddit: 40000,
  pinterest: 500,
  telegram: 4096,
  discord: 2000,
  slack: 40000,
  dribbble: 275,
  lemmy: 10000,
  farcaster: 320,
  nostr: 10000,
  vk: 16000,
  medium: 100000,
  devto: 100000,
  hashnode: 250000,
  wordpress: 100000,
}

function getCharLimit(p: string): number {
  return PLATFORM_CHAR_LIMITS[p.toLowerCase()] ?? 5000
}

function isLinkedIn(p: string): boolean {
  const v = p.toLowerCase().trim()
  return v === 'linkedin' || v === 'linkedin-page'
}

interface AccountsResp {
  ok: boolean
  accounts?: PostizAccount[]
  baseUrl?: string
  error?: string
  hint?: string
}

interface PostResp {
  ok: boolean
  scheduled?: boolean
  scheduleAt?: string | null
  response?: unknown
  error?: string
  hint?: string
}

export function PostizComposer() {
  const queryClient = useQueryClient()

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

  // Defensive re-filter — backend already strips LinkedIn but the UI should
  // never trust a single layer.
  const accounts = useMemo(
    () =>
      (accountsQuery.data?.accounts ?? []).filter(
        (a) => !isLinkedIn(a.identifier),
      ),
    [accountsQuery.data],
  )

  const [content, setContent] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [media, setMedia] = useState<PostizMedia[]>([])
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now')
  const [scheduleAtLocal, setScheduleAtLocal] = useState('')

  const selectedPlatforms = useMemo(() => {
    const ids = Array.from(selectedIds)
    return ids
      .map((id) => accounts.find((a) => a.id === id)?.identifier)
      .filter((p): p is string => typeof p === 'string' && !isLinkedIn(p))
  }, [accounts, selectedIds])

  const charLen = content.length
  const tightestLimit = useMemo(() => {
    if (selectedPlatforms.length === 0) return null
    let min = Infinity
    let which = ''
    for (const p of selectedPlatforms) {
      const lim = getCharLimit(p)
      if (lim < min) {
        min = lim
        which = p
      }
    }
    return { platform: which, limit: min }
  }, [selectedPlatforms])

  const overLimit = tightestLimit !== null && charLen > tightestLimit.limit

  const hasLocalOnlyMedia = media.some((m) => m.localOnly)

  const publishMutation = useMutation<PostResp, Error, void>({
    mutationFn: async () => {
      if (selectedIds.size === 0) {
        throw new Error('Select at least one platform.')
      }
      if (content.trim().length === 0) {
        throw new Error('Post body is empty.')
      }
      if (overLimit && tightestLimit) {
        throw new Error(
          `Post is ${charLen} chars — over the ${tightestLimit.platform} limit (${tightestLimit.limit}).`,
        )
      }
      if (hasLocalOnlyMedia) {
        throw new Error(
          'One or more attachments are local-only blob URLs. Replace with hosted URLs before publishing — Postiz cannot fetch local previews.',
        )
      }

      let scheduleAt: string | null = null
      if (scheduleMode === 'later') {
        if (!scheduleAtLocal) {
          throw new Error('Pick a schedule time, or switch to Post now.')
        }
        const parsed = Date.parse(scheduleAtLocal)
        if (!Number.isFinite(parsed)) {
          throw new Error('Schedule time is not a valid timestamp.')
        }
        if (parsed <= Date.now()) {
          throw new Error('Schedule time must be in the future.')
        }
        scheduleAt = new Date(parsed).toISOString()
      }

      const payload: Record<string, unknown> = {
        content,
        platforms: Array.from(selectedIds),
        mediaUrls: media.map((m) => m.url),
      }
      if (scheduleAt) payload.scheduleAt = scheduleAt

      const res = await fetch('/api/postiz/post', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as PostResp
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      return data
    },
    onSuccess: () => {
      setContent('')
      setMedia([])
      setSelectedIds(new Set())
      setScheduleMode('now')
      setScheduleAtLocal('')
      void queryClient.invalidateQueries({ queryKey: ['postiz', 'scheduled'] })
    },
  })

  const canPublish =
    !publishMutation.isPending &&
    content.trim().length > 0 &&
    selectedIds.size > 0 &&
    !overLimit &&
    !hasLocalOnlyMedia

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      {/* Left column — composer */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <header className="space-y-2">
          <h2
            className="flex items-center gap-2 text-lg font-medium"
            style={{ color: 'var(--mc-text)' }}
          >
            <HugeiconsIcon
              icon={Edit02Icon}
              className="h-5 w-5"
              style={{ color: 'var(--mc-cyan)' }}
              aria-hidden="true"
            />
            Compose post
          </h2>
          <p className="text-xs" style={{ color: 'var(--mc-text-dim)' }}>
            Multi-platform composer powered by Postiz. LinkedIn is handled by a
            separate module — connected LinkedIn accounts are filtered out.
          </p>
        </header>

        {/* Platform picker */}
        <fieldset className="space-y-1.5">
          <legend
            className="text-xs uppercase tracking-wide"
            style={{ color: 'var(--mc-text-dim)' }}
          >
            Target platforms
          </legend>
          {accountsQuery.isLoading ? (
            <div className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
              Loading connected accounts…
            </div>
          ) : accountsQuery.data && !accountsQuery.data.ok ? (
            <div
              className="rounded-md border px-3 py-2 text-xs"
              role="alert"
              style={{
                borderColor: 'var(--mc-rose)',
                background: 'var(--mc-rose-soft)',
                color: 'var(--mc-rose)',
              }}
            >
              <div className="font-medium">Couldn't load accounts</div>
              <div className="mt-0.5">{accountsQuery.data.error}</div>
              {accountsQuery.data.hint ? (
                <div
                  className="mt-0.5 text-[11px]"
                  style={{ color: 'var(--mc-text-dim)' }}
                >
                  {accountsQuery.data.hint}
                </div>
              ) : null}
            </div>
          ) : accounts.length === 0 ? (
            <div
              className="rounded-md border border-dashed px-3 py-3 text-xs"
              style={{
                borderColor: 'var(--mc-border-bright)',
                color: 'var(--mc-text-dim)',
              }}
            >
              No social accounts connected to Postiz. Open the Accounts tab to
              connect one.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((a) => {
                const selected = selectedIds.has(a.id)
                const disabled = a.disabled || a.refreshNeeded
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAccount(a.id)}
                    disabled={disabled}
                    aria-pressed={selected}
                    title={
                      disabled
                        ? a.disabled
                          ? 'Account disabled in Postiz'
                          : 'Token refresh needed — reconnect in the Accounts tab'
                        : a.identifier
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                    style={
                      selected
                        ? {
                            borderColor: 'var(--mc-cyan)',
                            background: 'var(--mc-cyan-soft)',
                            color: 'var(--mc-cyan)',
                          }
                        : {
                            borderColor: 'var(--mc-border-bright)',
                            background: 'var(--mc-surface)',
                            color: 'var(--mc-text)',
                          }
                    }
                  >
                    <span
                      className="rounded px-1 py-0.5 font-mono text-[10px] uppercase"
                      style={{
                        background: 'var(--mc-surface-2)',
                        color: 'var(--mc-text-dim)',
                      }}
                    >
                      {a.identifier}
                    </span>
                    <span className="truncate max-w-[14ch]">{a.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </fieldset>

        {/* Body text */}
        <label className="sr-only" htmlFor="postiz-composer-text">
          Post body
        </label>
        <textarea
          id="postiz-composer-text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="What do you want to share?"
          className={cn(
            'w-full resize-y rounded-md border px-3 py-2 text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
          )}
          style={{
            borderColor: overLimit
              ? 'var(--mc-rose)'
              : 'var(--mc-border-bright)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text)',
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span
            aria-live="polite"
            style={{
              color: overLimit ? 'var(--mc-rose)' : 'var(--mc-text-dim)',
            }}
          >
            {charLen.toLocaleString()} chars
            {tightestLimit
              ? ` / ${tightestLimit.limit.toLocaleString()} (${tightestLimit.platform})`
              : ''}
            {overLimit ? ' — over limit' : ''}
          </span>
          <span style={{ color: 'var(--mc-text-dim)' }}>
            {media.length} attachment{media.length === 1 ? '' : 's'} ·{' '}
            {selectedPlatforms.length} platform
            {selectedPlatforms.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Per-platform character-count chips */}
        {selectedPlatforms.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedPlatforms.map((p) => {
              const lim = getCharLimit(p)
              const over = charLen > lim
              return (
                <span
                  key={p}
                  className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    background: over
                      ? 'var(--mc-rose-soft)'
                      : 'var(--mc-surface-2)',
                    color: over ? 'var(--mc-rose)' : 'var(--mc-text-dim)',
                  }}
                >
                  {p}: {charLen}/{lim.toLocaleString()}
                </span>
              )
            })}
          </div>
        ) : null}

        <PostizMediaUploader
          items={media}
          onChange={setMedia}
          disabled={publishMutation.isPending}
        />

        {/* Schedule toggle */}
        <fieldset
          className="rounded-md border p-3"
          style={{
            borderColor: 'var(--mc-border-bright)',
            background: 'var(--mc-surface-2)',
          }}
        >
          <legend
            className="px-1 text-xs uppercase tracking-wide"
            style={{ color: 'var(--mc-text-dim)' }}
          >
            <HugeiconsIcon
              icon={Clock01Icon}
              className="mr-1 inline h-3 w-3"
              aria-hidden="true"
            />
            Schedule
          </legend>
          <div className="flex flex-wrap items-center gap-3">
            <label
              className="flex items-center gap-1.5 text-sm"
              style={{ color: 'var(--mc-text)' }}
            >
              <input
                type="radio"
                name="postiz-schedule"
                value="now"
                checked={scheduleMode === 'now'}
                onChange={() => setScheduleMode('now')}
                className="accent-[var(--mc-cyan)]"
              />
              Post now
            </label>
            <label
              className="flex items-center gap-1.5 text-sm"
              style={{ color: 'var(--mc-text)' }}
            >
              <input
                type="radio"
                name="postiz-schedule"
                value="later"
                checked={scheduleMode === 'later'}
                onChange={() => setScheduleMode('later')}
                className="accent-[var(--mc-cyan)]"
              />
              Schedule for
            </label>
            <input
              type="datetime-local"
              value={scheduleAtLocal}
              onChange={(e) => setScheduleAtLocal(e.target.value)}
              disabled={scheduleMode !== 'later'}
              className={cn(
                'rounded-md border px-2 py-1 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
              style={{
                borderColor: 'var(--mc-border-bright)',
                background: 'var(--mc-surface)',
                color: 'var(--mc-text)',
              }}
            />
          </div>
        </fieldset>

        {/* Result banners */}
        {publishMutation.isError ? (
          <div
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            role="alert"
            style={{
              borderColor: 'var(--mc-rose)',
              background: 'var(--mc-rose-soft)',
              color: 'var(--mc-rose)',
            }}
          >
            <HugeiconsIcon
              icon={Alert02Icon}
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <div className="font-medium">Post failed</div>
              <div
                className="mt-0.5 text-xs"
                style={{ color: 'var(--mc-text-dim)' }}
              >
                {publishMutation.error.message}
              </div>
            </div>
          </div>
        ) : null}

        {publishMutation.isSuccess && publishMutation.data ? (
          <div
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            role="status"
            style={{
              borderColor: 'var(--mc-emerald)',
              background: 'var(--mc-emerald-soft)',
              color: 'var(--mc-emerald)',
            }}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="font-medium">
                {publishMutation.data.scheduled
                  ? 'Scheduled'
                  : 'Sent to Postiz'}
              </div>
              {publishMutation.data.scheduleAt ? (
                <div
                  className="mt-0.5 text-xs"
                  style={{ color: 'var(--mc-text-dim)' }}
                >
                  publishes at{' '}
                  {new Date(publishMutation.data.scheduleAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => publishMutation.mutate()}
            disabled={!canPublish}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            style={{
              borderColor: 'var(--mc-magenta)',
              background: 'var(--mc-magenta-soft)',
              color: 'var(--mc-magenta)',
            }}
          >
            {publishMutation.isPending ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                className="h-4 w-4 animate-spin motion-reduce:[animation:none!important]"
                aria-hidden="true"
              />
            ) : (
              <HugeiconsIcon
                icon={Rocket01Icon}
                className="h-4 w-4"
                aria-hidden="true"
              />
            )}
            {publishMutation.isPending
              ? 'Publishing…'
              : scheduleMode === 'later'
                ? 'Schedule post'
                : 'Publish now'}
          </button>
        </div>
      </div>

      {/* Right column — chat */}
      <aside className="min-h-0 lg:h-full">
        <PostizChatPanel draft={content} platforms={selectedPlatforms} />
      </aside>
    </div>
  )
}
