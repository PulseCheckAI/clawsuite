// Postiz module — OAuth connect/disconnect card.
//
// Renders at the top of the Accounts tab. Reads /api/postiz/oauth/status on
// mount, surfaces ?connected=1 / ?error=<x> banners after the OAuth round-
// trip, then strips the query so refresh doesn't re-show the banner.
//
// Backend contract (do not modify):
//   GET    /api/postiz/oauth/start    → 302 to Postiz authorize. Use
//                                       window.location.href so the browser
//                                       follows the redirect chain and sets
//                                       the state cookie.
//   GET    /api/postiz/oauth/callback → redirects back to /postiz?connected=1
//                                       or /postiz?error=<message>.
//   GET    /api/postiz/oauth/status   → { connected, organizationId?, cus?,
//                                         obtainedAt? }. Never includes the
//                                         access_token.
//   DELETE /api/postiz/oauth          → { ok: true }. Disconnects.
//
// Called from: src/screens/postiz/postiz-screen.tsx (Accounts tab).

import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  LinkSquare02Icon,
  PlugSocketIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

interface PostizOAuthStatus {
  connected: boolean
  organizationId?: string
  cus?: string | null
  obtainedAt?: string
}

type StatusState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: PostizOAuthStatus }
  | { kind: 'error'; message: string }

type BannerState =
  | { kind: 'success' }
  | { kind: 'state_mismatch' }
  | { kind: 'access_denied' }
  | { kind: 'error'; message: string }
  | null

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null
  try {
    const t = new Date(iso)
    if (!Number.isFinite(t.getTime())) return null
    return t.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return null
  }
}

function parseInitialBanner(search: string): BannerState {
  if (!search) return null
  const params = new URLSearchParams(search)
  if (params.get('connected') === '1') {
    return { kind: 'success' }
  }
  const err = params.get('error')
  if (err) {
    if (err === 'state_mismatch') return { kind: 'state_mismatch' }
    if (err === 'access_denied') return { kind: 'access_denied' }
    return { kind: 'error', message: err }
  }
  return null
}

export function PostizConnectCard() {
  const [status, setStatus] = useState<StatusState>({ kind: 'loading' })
  const [banner, setBanner] = useState<BannerState>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // Banner from query string + strip query on mount so a refresh is clean.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const initial = parseInitialBanner(window.location.search)
    if (initial) {
      setBanner(initial)
      try {
        window.history.replaceState({}, '', '/postiz')
      } catch {
        // history.replaceState is best-effort; nothing to recover if it fails.
      }
    }
  }, [])

  // Auto-dismiss the success banner after 5s.
  useEffect(() => {
    if (banner?.kind !== 'success') return
    const id = window.setTimeout(() => setBanner(null), 5000)
    return () => window.clearTimeout(id)
  }, [banner])

  // Load status on mount + after disconnect. `signal` is optional so the
  // post-disconnect call (which fires from an event handler, not a cleanup-
  // sensitive useEffect) can omit it.
  const refreshStatus = async (signal?: AbortSignal) => {
    setStatus({ kind: 'loading' })
    try {
      const res = await fetch('/api/postiz/oauth/status', {
        credentials: 'same-origin',
        signal,
      })
      if (!res.ok) {
        setStatus({
          kind: 'error',
          message: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
        })
        return
      }
      const data = (await res.json()) as PostizOAuthStatus
      setStatus({ kind: 'ok', data })
    } catch (err) {
      // AbortError on unmount is expected; don't surface as a render error.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    void refreshStatus(ctrl.signal)
    return () => ctrl.abort()
  }, [])

  const handleConnect = () => {
    // Full navigation so the browser follows the 302 + sets the state cookie.
    window.location.href = '/api/postiz/oauth/start'
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await fetch('/api/postiz/oauth', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
    } catch {
      // Even on error, re-fetch status so the UI reflects reality.
    } finally {
      setDisconnecting(false)
      void refreshStatus()
    }
  }

  return (
    <section className="space-y-3">
      {/* Banners */}
      {banner ? (
        <Banner banner={banner} onDismiss={() => setBanner(null)} />
      ) : null}

      {/* Card */}
      <article
        className="rounded-lg border p-4"
        style={{
          borderColor: 'var(--mc-border-bright)',
          background: 'var(--mc-surface)',
        }}
      >
        {status.kind === 'loading' ? (
          <div className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
            Checking Postiz connection…
          </div>
        ) : status.kind === 'error' ? (
          <div className="space-y-1">
            <div
              className="flex items-center gap-2 text-sm font-medium"
              style={{ color: 'var(--mc-text)' }}
            >
              <HugeiconsIcon
                icon={Alert02Icon}
                className="h-4 w-4"
                style={{ color: 'var(--mc-rose)' }}
                aria-hidden="true"
              />
              Couldn't load Postiz connection status
            </div>
            <div className="text-xs" style={{ color: 'var(--mc-text-dim)' }}>
              {status.message}
            </div>
          </div>
        ) : status.data.connected ? (
          <ConnectedView
            data={status.data}
            onDisconnect={handleDisconnect}
            disconnecting={disconnecting}
          />
        ) : (
          <DisconnectedView onConnect={handleConnect} />
        )}
      </article>
    </section>
  )
}

function DisconnectedView({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h3
          className="flex items-center gap-2 text-base font-medium"
          style={{ color: 'var(--mc-text)' }}
        >
          <HugeiconsIcon
            icon={PlugSocketIcon}
            className="h-4 w-4"
            style={{ color: 'var(--mc-cyan)' }}
            aria-hidden="true"
          />
          Connect to Postiz Cloud
        </h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--mc-text-dim)' }}>
          Schedule posts across 30+ platforms via your Postiz account.
        </p>
      </div>
      <button
        type="button"
        onClick={onConnect}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
        )}
        style={{
          borderColor: 'var(--mc-cyan)',
          background: 'var(--mc-cyan-soft)',
          color: 'var(--mc-cyan)',
        }}
      >
        <HugeiconsIcon
          icon={LinkSquare02Icon}
          className="h-3.5 w-3.5"
          aria-hidden="true"
        />
        Connect with Postiz
      </button>
    </div>
  )
}

function ConnectedView({
  data,
  onDisconnect,
  disconnecting,
}: {
  data: PostizOAuthStatus
  onDisconnect: () => void
  disconnecting: boolean
}) {
  const formattedDate = formatDate(data.obtainedAt)
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h3
          className="flex items-center gap-2 text-base font-medium"
          style={{ color: 'var(--mc-text)' }}
        >
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            className="h-4 w-4"
            style={{ color: 'var(--mc-emerald)' }}
            aria-hidden="true"
          />
          Connected to Postiz Cloud
        </h3>
        <div
          className="mt-1 grid grid-cols-1 gap-0.5 text-xs"
          style={{ color: 'var(--mc-text-dim)' }}
        >
          {data.organizationId ? (
            <div>
              org{' '}
              <code
                className="rounded px-1 py-0.5 font-mono text-[11px]"
                style={{
                  background: 'var(--mc-surface-2)',
                  color: 'var(--mc-text)',
                }}
              >
                {data.organizationId}
              </code>
            </div>
          ) : null}
          {formattedDate ? (
            <div>
              Connected on{' '}
              <span style={{ color: 'var(--mc-text)' }}>{formattedDate}</span>
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onDisconnect}
        disabled={disconnecting}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        style={{
          borderColor: 'var(--mc-border-bright)',
          background: 'var(--mc-surface-2)',
          color: 'var(--mc-text)',
        }}
      >
        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
      </button>
    </div>
  )
}

function Banner({
  banner,
  onDismiss,
}: {
  banner: NonNullable<BannerState>
  onDismiss: () => void
}) {
  // Visual style per banner kind. We deliberately use --mc-emerald for success
  // (the Postiz palette doesn't define --mc-success); falls back to cyan
  // semantics if a future palette lands without emerald.
  let role: 'status' | 'alert' = 'status'
  let icon: typeof CheckmarkCircle02Icon = CheckmarkCircle02Icon
  let borderColor = 'var(--mc-cyan)'
  let background = 'var(--mc-cyan-soft)'
  let color = 'var(--mc-cyan)'
  let title = ''
  let body: string | null = null

  if (banner.kind === 'success') {
    role = 'status'
    icon = CheckmarkCircle02Icon
    borderColor = 'var(--mc-emerald)'
    background = 'var(--mc-emerald-soft)'
    color = 'var(--mc-emerald)'
    title = 'Successfully connected to Postiz Cloud.'
  } else if (banner.kind === 'state_mismatch') {
    role = 'alert'
    icon = Alert02Icon
    borderColor = 'var(--mc-rose)'
    background = 'var(--mc-rose-soft)'
    color = 'var(--mc-rose)'
    title = 'Session expired during Postiz authorization. Please try again.'
  } else if (banner.kind === 'access_denied') {
    role = 'status'
    icon = InformationCircleIcon
    borderColor = 'var(--mc-border-bright)'
    background = 'var(--mc-surface-2)'
    color = 'var(--mc-text-dim)'
    title = 'You declined the Postiz authorization request.'
  } else {
    role = 'alert'
    icon = Alert02Icon
    borderColor = 'var(--mc-rose)'
    background = 'var(--mc-rose-soft)'
    color = 'var(--mc-rose)'
    title = 'Postiz authorization failed.'
    body = banner.message
  }

  return (
    <div
      role={role}
      className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
      style={{ borderColor, background, color }}
    >
      <HugeiconsIcon
        icon={icon}
        className="mt-0.5 h-4 w-4 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {body ? (
          <div
            className="mt-0.5 text-xs"
            style={{ color: 'var(--mc-text-dim)' }}
          >
            {body}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded px-1 text-xs opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)]"
        aria-label="Dismiss"
        style={{ color }}
      >
        ×
      </button>
    </div>
  )
}
