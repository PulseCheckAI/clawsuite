// HubSpot module — main screen with Contacts | Connect tabs. Uses the
// mission-control palette inline (--mc-* tokens), mirroring the Postiz screen.
//
// Called from: src/routes/hubspot.tsx.

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type CSSProperties } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlugSocketIcon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { HubSpotContact } from '@/routes/api/hubspot/contacts'
import { HubSpotConnectCard } from './components/hubspot-connect-card'

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
  ['--mc-amber' as string]: '#FFB547',
  ['--mc-emerald' as string]: '#3DF5A1',
  ['--mc-emerald-soft' as string]: 'rgba(61, 245, 161, 0.14)',
  ['--mc-rose' as string]: '#FF6B8B',
  ['--mc-rose-soft' as string]: 'rgba(255, 107, 139, 0.14)',
  ['--mc-orange' as string]: '#FF7A45',
}

type TabKey = 'contacts' | 'connect'

interface ContactsResp {
  ok: boolean
  connected?: boolean
  error?: string
  contacts?: HubSpotContact[]
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof UserMultipleIcon
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

function HubSpotContacts() {
  const query = useQuery<ContactsResp>({
    queryKey: ['hubspot', 'contacts'],
    queryFn: async () => {
      const res = await fetch('/api/hubspot/contacts', {
        credentials: 'include',
      })
      return (await res.json()) as ContactsResp
    },
    refetchInterval: 60_000,
  })

  if (query.isLoading) {
    return (
      <div className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
        Loading contacts…
      </div>
    )
  }

  // Fetch/network error — surfaced distinctly so a failure never masquerades
  // as an empty CRM ("No contacts"), which would be a silent failure.
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
          Couldn't load contacts
        </div>
        <div className="mt-1 text-xs">
          {query.error instanceof Error
            ? query.error.message
            : 'Request failed — try again shortly.'}
        </div>
      </div>
    )
  }

  // Not connected (or upstream error) — honest connect prompt, never fake rows.
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
          HubSpot not connected
        </div>
        <div className="mt-1 text-xs">
          {query.data.error && query.data.error !== 'HubSpot not connected'
            ? query.data.error
            : 'Connect HubSpot in the Connect tab to load contacts.'}
        </div>
      </div>
    )
  }

  const contacts = query.data?.contacts ?? []
  if (contacts.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm"
        style={{
          borderColor: 'var(--mc-border-bright)',
          color: 'var(--mc-text-dim)',
        }}
      >
        <HugeiconsIcon
          icon={UserMultipleIcon}
          className="h-6 w-6"
          aria-hidden="true"
        />
        <div>No contacts returned by HubSpot.</div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ color: 'var(--mc-text-dim)' }}>
            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide">
              Name
            </th>
            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide">
              Email
            </th>
            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide">
              Company
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr
              key={c.id}
              className="border-t"
              style={{
                borderColor: 'var(--mc-border)',
                color: 'var(--mc-text)',
              }}
            >
              <td className="px-3 py-2">{c.name ?? '—'}</td>
              <td className="px-3 py-2" style={{ color: 'var(--mc-text-dim)' }}>
                {c.email ?? '—'}
              </td>
              <td className="px-3 py-2" style={{ color: 'var(--mc-text-dim)' }}>
                {c.company ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function HubSpotScreen() {
  const [tab, setTab] = useState<TabKey>('contacts')

  // After an OAuth round-trip the callback redirects to /hubspot?connected=1
  // or /hubspot?error=<x>. Land on Connect so the user sees the banner/status.
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
              icon={UserMultipleIcon}
              className="h-6 w-6"
              style={{ color: 'var(--mc-orange)' }}
              aria-hidden="true"
            />
            HubSpot
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--mc-text-dim)' }}>
            CRM contacts and deals from your HubSpot account.
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="HubSpot workspace"
        className="flex shrink-0 items-center gap-1 border-b"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        <TabButton
          active={tab === 'contacts'}
          onClick={() => setTab('contacts')}
          icon={UserMultipleIcon}
          label="Contacts"
        />
        <TabButton
          active={tab === 'connect'}
          onClick={() => setTab('connect')}
          icon={PlugSocketIcon}
          label="Connect"
        />
      </div>

      {tab === 'contacts' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto motion-reduce:[animation:none!important]"
        >
          <HubSpotContacts />
        </div>
      ) : null}

      {tab === 'connect' ? (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto motion-reduce:[animation:none!important]"
        >
          <HubSpotConnectCard />
        </div>
      ) : null}
    </div>
  )
}
