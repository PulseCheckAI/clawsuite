// /voice route — PulseOS Voice Agent Hub, live.
// ───────────────────────────────────────────────────────────────────────────
// Same lazy-load + error-boundary frame as Phase 1, but now mounts
// LiveHubOverview (not HubOverview). The page hydrates:
//   1. GET /api/voice-engine/context → resolved org id.
//   2. useVoiceCallsLive(orgId, {limit: 50}) → cold-start REST + supabase
//      realtime postgres_changes on public.voice_calls.
//
// /voice-preview is the unaffected zero-backend demo path (still mounts
// HubOverview directly).
//
// SSR off, voice-hub tokens imported as a side-effect so var(--vh-*)
// resolves before the lazy chunk hydrates.
// ───────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy, useEffect, useState } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'
import { useVoiceCallsLive } from '@/hooks/use-voice-calls-live'
import '@/styles/voice-hub-tokens.css'

const LiveHubOverview = lazy(() =>
  import('@/components/voice-hub/LiveHubOverview').then((m) => ({
    default: m.LiveHubOverview,
  })),
)

export const Route = createFileRoute('/voice')({
  ssr: false,
  component: function VoiceRoute() {
    usePageTitle('Voice Hub')
    return (
      <ErrorBoundary
        title="Voice Hub error"
        description="Failed to load the Voice Hub. Try reloading."
      >
        <Suspense
          fallback={
            <div
              data-voice-hub
              className="flex h-full items-center justify-center"
              style={{
                minHeight: '100vh',
                backgroundColor: 'var(--vh-base)',
                color: 'var(--vh-text-muted)',
              }}
            >
              <div className="font-mono text-sm tracking-wide">
                Loading Voice Hub…
              </div>
            </div>
          }
        >
          <VoiceHubLiveContainer />
        </Suspense>
      </ErrorBoundary>
    )
  },
})

// ── Container: resolves org + drives the live hook ─────────────────────────

function VoiceHubLiveContainer() {
  const { orgId, ctxError } = useVoiceContext()
  const { calls, loading, error } = useVoiceCallsLive(orgId ?? undefined, {
    limit: 50,
  })

  // While we're still discovering the org, render the same skeleton the
  // outer Suspense uses so the page never "snaps" between two empty states.
  if (orgId === undefined) {
    return (
      <div
        data-voice-hub
        className="flex h-full items-center justify-center"
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--vh-base)',
          color: 'var(--vh-text-muted)',
        }}
      >
        <div className="font-mono text-sm tracking-wide">
          {ctxError ?? 'Resolving organization…'}
        </div>
      </div>
    )
  }

  return (
    <LiveHubOverview
      calls={calls}
      loading={loading}
      error={error}
      orgId={orgId ?? undefined}
    />
  )
}

// ── Org-context hook (browser → /api/voice-engine/context) ─────────────────
// Returns `orgId === undefined` while the fetch is in flight; `null` when
// resolved-but-empty (server didn't have one); `string` when bound.

function useVoiceContext(): {
  orgId: string | null | undefined
  ctxError: string | null
} {
  const [orgId, setOrgId] = useState<string | null | undefined>(undefined)
  const [ctxError, setCtxError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/voice-engine/context', { credentials: 'same-origin' })
      .then(async (r) => {
        if (cancelled) return
        const body = (await r.json().catch(() => null)) as {
          ok?: boolean
          orgId?: string | null
          error?: string
        } | null
        if (!body || body.ok !== true) {
          setCtxError(body?.error ?? `context failed (${r.status})`)
          setOrgId(null)
          return
        }
        setOrgId(body.orgId ?? null)
      })
      .catch((e) => {
        if (cancelled) return
        setCtxError(e instanceof Error ? e.message : String(e))
        setOrgId(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { orgId, ctxError }
}
