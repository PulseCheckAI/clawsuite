// Postiz module — connected-accounts grid.
//
// Renders one card per account from GET /api/postiz/accounts (server filters
// LinkedIn; we re-filter defensively). Each card shows platform identifier,
// handle, status pill (active / disabled / refresh-needed / expiring), token
// expiration, and a "Reconnect" button that opens `${postizBaseUrl}/integrations`
// in a new tab.
//
// A "Connect new" CTA links to the same Postiz integrations page, since the
// OAuth dance happens entirely in the Postiz UI — we never proxy it.
//
// Called from: src/screens/postiz/postiz-screen.tsx (Accounts tab).

import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  LinkSquare02Icon,
  PlugSocketIcon,
  PlusSignIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { PostizAccount } from '@/routes/api/postiz/accounts'

interface AccountsResp {
  ok: boolean
  accounts?: PostizAccount[]
  baseUrl?: string
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

interface StatusInfo {
  label: string
  background: string
  color: string
  Icon: typeof CheckmarkCircle02Icon
}

function statusFor(a: PostizAccount): StatusInfo {
  if (a.disabled) {
    return {
      label: 'disabled',
      background: 'var(--mc-rose-soft)',
      color: 'var(--mc-rose)',
      Icon: Alert02Icon,
    }
  }
  if (a.refreshNeeded) {
    return {
      label: 'refresh needed',
      background: 'var(--mc-amber-soft)',
      color: 'var(--mc-amber)',
      Icon: RefreshIcon,
    }
  }
  if (a.tokenExpiration) {
    const ms = new Date(a.tokenExpiration).getTime() - Date.now()
    if (Number.isFinite(ms) && ms <= 0) {
      return {
        label: 'expired',
        background: 'var(--mc-rose-soft)',
        color: 'var(--mc-rose)',
        Icon: Alert02Icon,
      }
    }
    if (Number.isFinite(ms) && ms < 7 * 86_400_000) {
      return {
        label: 'expiring soon',
        background: 'var(--mc-amber-soft)',
        color: 'var(--mc-amber)',
        Icon: Alert02Icon,
      }
    }
  }
  return {
    label: 'active',
    background: 'var(--mc-emerald-soft)',
    color: 'var(--mc-emerald)',
    Icon: CheckmarkCircle02Icon,
  }
}

export function PostizAccounts() {
  const query = useQuery<AccountsResp>({
    queryKey: ['postiz', 'accounts'],
    queryFn: async () => {
      const res = await fetch('/api/postiz/accounts', {
        credentials: 'include',
      })
      return (await res.json()) as AccountsResp
    },
    refetchInterval: 60_000,
  })

  const accounts = (query.data?.accounts ?? []).filter(
    (a) => !isLinkedIn(a.identifier),
  )
  const baseUrl = query.data?.baseUrl ?? null
  const integrationsHref = baseUrl ? `${baseUrl}/integrations` : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className="flex items-center gap-2 text-lg font-medium"
          style={{ color: 'var(--mc-text)' }}
        >
          <HugeiconsIcon
            icon={PlugSocketIcon}
            className="h-5 w-5"
            style={{ color: 'var(--mc-cyan)' }}
            aria-hidden="true"
          />
          Connected accounts
          {accounts.length > 0 ? (
            <span
              className="rounded px-1.5 py-0.5 text-xs"
              style={{
                background: 'var(--mc-surface-2)',
                color: 'var(--mc-text-dim)',
              }}
            >
              {accounts.length}
            </span>
          ) : null}
        </h2>
        {integrationsHref ? (
          <a
            href={integrationsHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
            )}
            style={{
              borderColor: 'var(--mc-cyan)',
              background: 'var(--mc-cyan-soft)',
              color: 'var(--mc-cyan)',
            }}
          >
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="h-3.5 w-3.5"
              aria-hidden="true"
            />
            Connect new
            <HugeiconsIcon
              icon={LinkSquare02Icon}
              className="h-3 w-3"
              aria-hidden="true"
            />
          </a>
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
          Loading connected accounts…
        </div>
      ) : query.data && !query.data.ok ? (
        <div
          className="rounded-md border px-3 py-2 text-sm"
          role="alert"
          style={{
            borderColor: 'var(--mc-rose)',
            background: 'var(--mc-rose-soft)',
            color: 'var(--mc-rose)',
          }}
        >
          <div className="font-medium">Couldn't reach Postiz</div>
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
      ) : accounts.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm"
          style={{
            borderColor: 'var(--mc-border-bright)',
            color: 'var(--mc-text-dim)',
          }}
        >
          <HugeiconsIcon
            icon={PlugSocketIcon}
            className="h-6 w-6"
            aria-hidden="true"
          />
          <div>No social accounts connected.</div>
          {integrationsHref ? (
            <a
              href={integrationsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)]"
              style={{ color: 'var(--mc-cyan)' }}
            >
              Open Postiz integrations →
            </a>
          ) : (
            <div className="text-xs">
              Set POSTIZ_API_URL in the dashboard environment to enable this
              tab.
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const s = statusFor(a)
            return (
              <article
                key={a.id}
                className="rounded-lg border p-4"
                style={{
                  borderColor: 'var(--mc-border-bright)',
                  background: 'var(--mc-surface)',
                }}
              >
                <div className="flex items-start gap-3">
                  {a.picture ? (
                    <img
                      src={a.picture}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                      style={{
                        background: 'var(--mc-surface-2)',
                      }}
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-xs uppercase"
                      style={{
                        background: 'var(--mc-surface-2)',
                        color: 'var(--mc-text-dim)',
                      }}
                      aria-hidden="true"
                    >
                      {a.identifier.slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
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
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        style={{
                          background: s.background,
                          color: s.color,
                        }}
                      >
                        <HugeiconsIcon
                          icon={s.Icon}
                          className="h-3 w-3"
                          aria-hidden="true"
                        />
                        {s.label}
                      </span>
                    </div>
                    <div
                      className="mt-1 truncate text-sm font-medium"
                      style={{ color: 'var(--mc-text)' }}
                      title={a.name}
                    >
                      {a.name}
                    </div>
                    <div
                      className="mt-1 grid grid-cols-1 gap-0.5 text-xs"
                      style={{ color: 'var(--mc-text-dim)' }}
                    >
                      <div>
                        type{' '}
                        <span style={{ color: 'var(--mc-text)' }}>
                          {a.type}
                        </span>
                      </div>
                      <div>
                        token{' '}
                        {a.tokenExpiration ? (
                          <span
                            title={a.tokenExpiration}
                            style={{ color: 'var(--mc-text)' }}
                          >
                            expires {formatRelative(a.tokenExpiration)}
                          </span>
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {integrationsHref ? (
                  <div className="mt-3 flex justify-end">
                    <a
                      href={integrationsHref}
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
                        icon={RefreshIcon}
                        className="h-3 w-3"
                        aria-hidden="true"
                      />
                      Reconnect
                      <HugeiconsIcon
                        icon={LinkSquare02Icon}
                        className="h-3 w-3"
                        aria-hidden="true"
                      />
                    </a>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
