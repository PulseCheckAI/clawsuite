// ── /voice/hume-chat — Open-Domain Voice (Hume EVI) ─────────────────────────
// Browser surface for the new Hume EVI 3 voice agent (Agent H1, Phase 1).
//
// Flow:
//   1. On mount, fetch /api/voice-engine/hume-token to get a short-lived EVI
//      access_token + config_id (+ optional dynamic_variables fetched
//      server-side from the relationship-memory MCP).
//   2. Wrap the page in <VoiceProvider> from @humeai/voice-react with the
//      access token. The provider opens the WebSocket to Hume on connect.
//   3. Tap-to-talk button (also bound to spacebar push-to-talk) + a
//      connection-status indicator (idle / connecting / connected).
//   4. Transcript renders user/agent turns with AnimatePresence enter/exit.
//      Agent bubbles surface prosody tone labels when Hume returns them.
//
// SSR off (matches /voice). voice-hub tokens loaded as side-effect so
// var(--vh-*) resolves before the lazy chunk hydrates.
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'
import '@/styles/voice-hub-tokens.css'

const HumeChatSurface = lazy(() =>
  import('@/components/voice-hub/HumeChatSurface').then((m) => ({
    default: m.HumeChatSurface,
  })),
)

export const Route = createFileRoute('/voice/hume-chat')({
  ssr: false,
  component: function HumeChatRoute() {
    usePageTitle('Open-Domain Voice — Hume EVI')
    return (
      <ErrorBoundary
        title="Hume voice error"
        description="Failed to load the Hume voice surface. Try reloading."
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
                Loading Hume voice…
              </div>
            </div>
          }
        >
          <HumeChatSurface />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
