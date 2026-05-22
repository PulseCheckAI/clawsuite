// Gmail module — main screen with Inbox | Connect tabs. Uses the
// mission-control palette inline, mirroring the HubSpot screen.
//
// Called from: src/routes/gmail.tsx.

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type CSSProperties } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Mail01Icon, PlugSocketIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { GmailMessage } from '@/routes/api/gmail/messages'
import { GmailConnectCard } from './components/gmail-connect-card'

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
  ['--mc-emerald' as string]: '#3DF5A1',
  ['--mc-emerald-soft' as string]: 'rgba(61, 245, 161, 0.14)',
  ['--mc-rose' as string]: '#FF6B8B',
  ['--mc-rose-soft' as string]: 'rgba(255, 107, 139, 0.14)',
  ['--mc-red' as string]: '#FF5A5F',
}

type TabKey = 'inbox' | 'connect'

interface MessagesResp {
  ok: boolean
  connected?: boolean
  error?: string
  messages?: GmailMessage[]
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Mail01Icon
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

function GmailInbox() {
  const query = useQuery<MessagesResp>({
    queryKey: ['gmail', 'messages'],
    queryFn: async () => {
      const res = await fetch('/api/gmail/messages', {
        credentials: 'include',
      })
      return (await res.json()) as MessagesResp
    },
    refetchInterval: 60_000,
  })

  if (query.isLoading) {
    return (
      <div className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
        Loading inbox…
      </div>
    )
  }

  // Fetch/network error — surfaced distinctly so a failure never masquerades
  // as an empty inbox ("No messages"), which would be a silent failure.
  if (query.isError) {
    return (
      <div
        className="rounded-md border border-dashed px-4 py-8 text-center text-sm"
        style={{
          borderColor: 'var(--mc-rose)',
          background: 'var(--mc-surface)',
          color: 'var(--mc-text-dim)',
        }}
      >
        <div
          className="text-base font-medium"
          style={{ color: 'var(--mc-text)' }}
        >
          Couldn't load inbox
        </div>
        <div className="mt-1 text-xs">
          {query.error instanceof Error
            ? query.error.message
            : 'Request failed — try again shortly.'}
        </div>
      </div>
    )
  }

  if (query.data && !query.data.ok) {
    return (
      <div
        className="rounded-md border border-dashed px-4 py-8 text-center text-sm"
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
          Gmail not connected
        </div>
        <div className="mt-1 text-xs">
          {query.data.error && query.data.error !== 'Gmail not connected'
            ? query.data.error
            : 'Connect Gmail in the Connect tab to load your inbox.'}
        </div>
      </div>
    )
  }

  const messages = query.data?.messages ?? []
  if (messages.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm"
        style={{
          borderColor: 'var(--mc-border-bright)',
          color: 'var(--mc-text-dim)',
        }}
      >
        <HugeiconsIcon
          icon={Mail01Icon}
          className="h-6 w-6"
          aria-hidden="true"
        />
        <div>No messages returned by Gmail.</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <article
          key={m.id}
          className="rounded-lg border p-3"
          style={{
            borderColor: 'var(--mc-border-bright)',
            background: 'var(--mc-surface)',
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div
              className="truncate text-sm font-medium"
              style={{ color: 'var(--mc-text)' }}
              title={m.subject ?? undefined}
            >
              {m.subject || '(no subject)'}
            </div>
            {m.date ? (
              <div
                className="shrink-0 text-[11px]"
                style={{ color: 'var(--mc-text-dimmer)' }}
              >
                {m.date}
              </div>
            ) : null}
          </div>
          {m.from ? (
            <div
              className="mt-0.5 truncate text-xs"
              style={{ color: 'var(--mc-text-dim)' }}
              title={m.from}
            >
              {m.from}
            </div>
          ) : null}
          {m.snippet ? (
            <div
              className="mt-1 line-clamp-2 text-xs"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              {m.snippet}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

export function GmailScreen() {
  const [tab, setTab] = useState<TabKey>('inbox')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = window.location.search
    if (!search) return
    const params = new URLSearchParams(search)
    if (params.get('connected') === '1' || params.has('error')) {
      setTab('connect')
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            className="flex items-center gap-3 text-2xl font-semibold"
            style={{ color: 'var(--mc-text)' }}
          >
            <HugeiconsIcon
              icon={Mail01Icon}
              className="h-6 w-6"
              style={{ color: 'var(--mc-red)' }}
              aria-hidden="true"
            />
            Gmail
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--mc-text-dim)' }}>
            Recent inbox messages (read-only).
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Gmail workspace"
        className="flex shrink-0 items-center gap-1 border-b"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        <TabButton
          active={tab === 'inbox'}
          onClick={() => setTab('inbox')}
          icon={Mail01Icon}
          label="Inbox"
        />
        <TabButton
          active={tab === 'connect'}
          onClick={() => setTab('connect')}
          icon={PlugSocketIcon}
          label="Connect"
        />
      </div>

      {tab === 'inbox' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto motion-reduce:[animation:none!important]"
        >
          <GmailInbox />
        </div>
      ) : null}

      {tab === 'connect' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto motion-reduce:[animation:none!important]"
        >
          <GmailConnectCard />
        </div>
      ) : null}
    </div>
  )
}
