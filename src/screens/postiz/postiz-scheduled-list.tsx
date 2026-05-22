// Postiz module — scheduled-posts list.
//
// Calls GET /api/postiz/scheduled (already filters LinkedIn server-side; we
// re-filter defensively). Shows rows with platform identifier, handle,
// publish-time relative + absolute, content preview, state pill, and
// per-row actions.
//
// Delete: Postiz exposes DELETE /public/v1/posts/:id but the dashboard
// backend does NOT yet wrap it. Rather than fabricate the call, the action
// renders disabled with a tooltip pointing at the Postiz dashboard. When the
// backend gains a delete route, only this file (and the action handler)
// needs to change.
//
// Edit: same story — no /api/postiz/post update endpoint exists. The button
// opens the Postiz dashboard's edit page (best-effort URL).
//
// Called from: src/screens/postiz/postiz-screen.tsx (Scheduled tab).

import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CalendarAdd02Icon,
  Clock01Icon,
  Edit02Icon,
  Image01Icon,
  LinkSquare02Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { ScheduledPost } from '@/routes/api/postiz/scheduled'

interface ScheduledResp {
  ok: boolean
  posts?: ScheduledPost[]
  error?: string
  hint?: string
}

function isLinkedIn(p: string): boolean {
  const v = p.toLowerCase().trim()
  return v === 'linkedin' || v === 'linkedin-page'
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diffMs = t - Date.now()
  const absMs = Math.abs(diffMs)
  const future = diffMs >= 0
  const s = Math.floor(absMs / 1000)
  if (s < 60) return future ? `in ${s}s` : `${s}s ago`
  if (s < 3600)
    return future ? `in ${Math.floor(s / 60)}m` : `${Math.floor(s / 60)}m ago`
  if (s < 86_400)
    return future
      ? `in ${Math.floor(s / 3600)}h`
      : `${Math.floor(s / 3600)}h ago`
  return future
    ? `in ${Math.floor(s / 86_400)}d`
    : `${Math.floor(s / 86_400)}d ago`
}

function stateStyle(state: string): {
  background: string
  color: string
  label: string
} {
  const s = state.toUpperCase()
  if (s === 'PUBLISHED' || s === 'POSTED') {
    return {
      background: 'var(--mc-emerald-soft)',
      color: 'var(--mc-emerald)',
      label: s,
    }
  }
  if (s === 'ERROR' || s === 'FAILED') {
    return {
      background: 'var(--mc-rose-soft)',
      color: 'var(--mc-rose)',
      label: s,
    }
  }
  if (s === 'DRAFT') {
    return {
      background: 'var(--mc-surface-2)',
      color: 'var(--mc-text-dim)',
      label: s,
    }
  }
  // QUEUE / SCHEDULED / UNKNOWN
  return {
    background: 'var(--mc-amber-soft)',
    color: 'var(--mc-amber)',
    label: s,
  }
}

interface Props {
  postizBaseUrl: string | null
}

export function PostizScheduledList({ postizBaseUrl }: Props) {
  const query = useQuery<ScheduledResp>({
    queryKey: ['postiz', 'scheduled'],
    queryFn: async () => {
      const res = await fetch('/api/postiz/scheduled', {
        credentials: 'include',
      })
      return (await res.json()) as ScheduledResp
    },
    refetchInterval: 30_000,
  })

  const posts = (query.data?.posts ?? []).filter(
    (p) => !isLinkedIn(p.platform.identifier),
  )

  if (query.isLoading) {
    return (
      <div className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
        Loading scheduled posts…
      </div>
    )
  }

  if (query.data && !query.data.ok) {
    return (
      <div
        className="rounded-md border px-3 py-2 text-sm"
        role="alert"
        style={{
          borderColor: 'var(--mc-rose)',
          background: 'var(--mc-rose-soft)',
          color: 'var(--mc-rose)',
        }}
      >
        <div className="flex items-start gap-2">
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <div>
            <div className="font-medium">Couldn't load scheduled posts</div>
            <div
              className="mt-0.5 text-xs"
              style={{ color: 'var(--mc-text-dim)' }}
            >
              {query.data.error}
            </div>
            {query.data.hint ? (
              <div
                className="mt-0.5 text-[11px]"
                style={{ color: 'var(--mc-text-dim)' }}
              >
                {query.data.hint}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm"
        style={{
          borderColor: 'var(--mc-border-bright)',
          color: 'var(--mc-text-dim)',
        }}
      >
        <HugeiconsIcon
          icon={CalendarAdd02Icon}
          className="h-6 w-6"
          aria-hidden="true"
        />
        <div>No scheduled posts yet.</div>
        <div className="text-xs">
          Switch to the Compose tab to schedule a post, or use the Postiz
          dashboard for advanced workflows.
        </div>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {posts.map((p) => {
        const stateUi = stateStyle(p.state)
        return (
          <li
            key={p.id}
            className="rounded-lg border p-3"
            style={{
              borderColor: 'var(--mc-border-bright)',
              background: 'var(--mc-surface)',
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
                    style={{
                      background: 'var(--mc-surface-2)',
                      color: 'var(--mc-text-dim)',
                    }}
                  >
                    {p.platform.identifier}
                  </span>
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--mc-text)' }}
                  >
                    {p.platform.name}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                    style={{
                      background: stateUi.background,
                      color: stateUi.color,
                    }}
                  >
                    {stateUi.label}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 text-xs"
                    style={{ color: 'var(--mc-text-dim)' }}
                    title={p.publishDate}
                  >
                    <HugeiconsIcon
                      icon={Clock01Icon}
                      className="h-3 w-3"
                      aria-hidden="true"
                    />
                    {formatRelative(p.publishDate)} ·{' '}
                    {new Date(p.publishDate).toLocaleString()}
                  </span>
                </div>

                {p.content ? (
                  <p
                    className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm"
                    style={{ color: 'var(--mc-text)' }}
                  >
                    {p.content}
                  </p>
                ) : (
                  <p
                    className="mt-2 text-sm italic"
                    style={{ color: 'var(--mc-text-dimmer)' }}
                  >
                    (no body)
                  </p>
                )}

                {p.mediaUrls.length > 0 ? (
                  <div
                    className="mt-1.5 inline-flex items-center gap-1 text-xs"
                    style={{ color: 'var(--mc-text-dim)' }}
                  >
                    <HugeiconsIcon
                      icon={Image01Icon}
                      className="h-3 w-3"
                      aria-hidden="true"
                    />
                    {p.mediaUrls.length} attachment
                    {p.mediaUrls.length === 1 ? '' : 's'}
                  </div>
                ) : null}

                {p.error ? (
                  <div
                    className="mt-2 rounded border px-2 py-1 text-xs"
                    role="alert"
                    style={{
                      borderColor: 'var(--mc-rose)',
                      background: 'var(--mc-rose-soft)',
                      color: 'var(--mc-rose)',
                    }}
                  >
                    {p.error}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                {postizBaseUrl ? (
                  <a
                    href={`${postizBaseUrl}/launches`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
                    )}
                    style={{
                      borderColor: 'var(--mc-border-bright)',
                      background: 'var(--mc-surface-2)',
                      color: 'var(--mc-text)',
                    }}
                  >
                    <HugeiconsIcon
                      icon={Edit02Icon}
                      className="h-3 w-3"
                      aria-hidden="true"
                    />
                    Edit in Postiz
                    <HugeiconsIcon
                      icon={LinkSquare02Icon}
                      className="h-3 w-3"
                      aria-hidden="true"
                    />
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled
                  title="Delete via API is not yet wired in the dashboard — remove this post from the Postiz dashboard for now."
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                  style={{
                    borderColor: 'var(--mc-border-bright)',
                    background: 'var(--mc-surface-2)',
                    color: 'var(--mc-text-dim)',
                  }}
                >
                  Delete (TODO)
                </button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
