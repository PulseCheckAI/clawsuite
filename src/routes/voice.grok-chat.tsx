// ── /voice/grok-chat — Business-Analytics Voice (xAI Grok) ─────────────────
// Browser surface for the xAI Grok Voice agent (Phase 6).
//
// Three-product voice lineup:
//   /voice/calls       — voice-engine (outbound business + grounding/faithfulness)
//   /voice/hume-chat   — hume-evi-agent (open-domain, emotional)
//   /voice/grok-chat   — THIS (restaurant analytics + native web/x search)
//
// Flow:
//   1. On mount, fetch /api/voice-engine/grok-token to get a short-lived xAI
//      ephemeral client_secret + the session_defaults (instructions + tools).
//   2. GrokChatSurface opens a raw WebSocket to wss://api.x.ai/v1/realtime
//      with the ephemeral as a subprotocol — no SDK, no Hume-style provider.
//   3. Tap-to-talk + transcript + tool-call surface (mirrors hume-chat shape
//      so operators have a consistent feel across the three voice surfaces).
//
// SSR off (matches /voice/hume-chat). voice-hub tokens loaded as side-effect
// so var(--vh-*) resolves before the lazy chunk hydrates.
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'
import '@/styles/voice-hub-tokens.css'

const GrokChatSurface = lazy(() =>
  import('@/components/voice-hub/GrokChatSurface').then((m) => ({
    default: m.GrokChatSurface,
  })),
)

export const Route = createFileRoute('/voice/grok-chat')({
  ssr: false,
  component: function GrokChatRoute() {
    usePageTitle('Business Analytics Voice — xAI Grok')
    return (
      <ErrorBoundary
        title="Grok voice error"
        description="Failed to load the Grok voice surface. Try reloading."
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
                Loading Grok voice…
              </div>
            </div>
          }
        >
          <GrokChatSurface />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
