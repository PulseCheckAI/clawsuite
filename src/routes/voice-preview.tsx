// /voice-preview — standalone visual demo for the Voice Hub UI.
// ───────────────────────────────────────────────────────────────────────────
// THE THING TO SEE. Mounts every voice-hub component side-by-side with
// stubbed data so the design can be validated end-to-end without any
// backend (Supabase / voice-engine / scenarios) wired up.
//
// Composition:
//   1. <HubOverview/>           — the full /voice page (header + cards +
//                                 queue + DNA panel). Uses its own stubs.
//   2. <VoiceFloatingButton/>   — bottom-right FAB. forceShow=true so it
//                                 renders here even though pathname is
//                                 /voice-preview (FAB normally gates by
//                                 /^\/voice(\/|-|$)/i which matches /voice-
//                                 prefixed paths anyway, but explicit is
//                                 better than implicit for the demo).
//   3. <PlaceCallSheet/>        — kicked open by a "Open Place Call Sheet"
//                                 button so the reviewer doesn't need to
//                                 know the FAB right-click shortcut.
//
// No auth, no route guards. The voice-tokens.css side-effect import lives
// on /voice via voice-hub-tokens.css; we also import voice-tokens.css here
// to satisfy the brief's filename + so the demo works without /voice ever
// being loaded.

import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { HubOverview } from '@/components/voice-hub/HubOverview'
import { PlaceCallSheet } from '@/components/voice-hub/PlaceCallSheet'
import { VoiceFloatingButton } from '@/components/voice-hub/VoiceFloatingButton'
import '@/styles/voice-tokens.css'

export const Route = createFileRoute('/voice-preview')({
  ssr: false,
  component: VoicePreviewRoute,
})

function VoicePreviewRoute() {
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <div
      data-voice-hub
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--vh-base)',
      }}
    >
      {/* Demo banner — orient the viewer */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '10px 16px',
          background:
            'linear-gradient(90deg, rgba(46,150,255,0.16), rgba(16,185,129,0.16))',
          borderBottom: '1px solid var(--vh-glass-border-bright)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          className="font-mono"
          style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--vh-text)',
            fontWeight: 600,
          }}
        >
          /voice-preview · Mocked data — see /voice for live
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            style={{
              minHeight: 40,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--vh-active-border)',
              background: 'var(--vh-active-soft)',
              color: 'var(--vh-active)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Open Place Call Sheet
          </button>
          <a
            href="/voice"
            style={{
              minHeight: 40,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--vh-glass-border-bright)',
              background: 'transparent',
              color: 'var(--vh-text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            Go to real /voice
          </a>
        </div>
      </div>

      {/* Hub overview — composed of every voice-hub component except the sheet */}
      <HubOverview />

      {/* Sheet (controlled here so the demo button can open it) */}
      <PlaceCallSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

      {/* FAB — forceShow so the demo doesn't depend on pathname matching */}
      <VoiceFloatingButton forceShow />
    </div>
  )
}
