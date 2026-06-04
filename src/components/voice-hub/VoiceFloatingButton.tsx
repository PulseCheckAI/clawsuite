// VoiceFloatingButton — bottom-right FAB that opens a dialer popover.
// ───────────────────────────────────────────────────────────────────────────
// Only renders on voice-* routes (/voice, /voice-preview, /voice/anything)
// so we don't haunt every other screen. Mounted globally from __root.tsx so
// it floats above whatever the active route renders — including the dialer
// inside HubOverview.
//
// Behavior:
//   - Bottom-right fixed (24px / 24px inset).
//   - Click → toggles popover with a DialerKeypad inside.
//   - Click outside or Escape closes.
//   - Right-click on FAB → opens PlaceCallSheet directly (power-user
//     shortcut; ui-ux-pro-max secondary-action pattern).
//
// Animation:
//   - FAB enter: fade + spring-up (motion).
//   - Popover: AnimatePresence with origin-bottom-right scale + opacity.
//   - prefers-reduced-motion handled globally in voice-hub-tokens.css.
//
// Consumers:
//   - src/routes/__root.tsx (mount; gates by pathname)
//   - src/routes/voice-preview.tsx (uses forceShow=true)

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouterState } from '@tanstack/react-router'
import { DialerKeypad } from './DialerKeypad'
import { PlaceCallSheet } from './PlaceCallSheet'

const VOICE_ROUTE_RE = /^\/voice(\/|-|$)/i

export interface VoiceFloatingButtonProps {
  /** Force-show the FAB regardless of current pathname (useful for /voice-preview). */
  forceShow?: boolean
}

export function VoiceFloatingButton({ forceShow }: VoiceFloatingButtonProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const visible = forceShow || VOICE_ROUTE_RE.test(pathname)

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const fabRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Click-outside + Escape close the popover.
  useEffect(() => {
    if (!popoverOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (popoverRef.current?.contains(t)) return
      if (fabRef.current?.contains(t)) return
      setPopoverOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [popoverOpen])

  if (!visible) return null

  return (
    <div data-voice-hub>
      {/* FAB itself */}
      <AnimatePresence>
        <motion.button
          key="voice-fab"
          ref={fabRef}
          type="button"
          aria-label={
            popoverOpen
              ? 'Close dialer popover'
              : 'Open dialer popover · right-click for full place-call sheet'
          }
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          onClick={() => setPopoverOpen((v) => !v)}
          onContextMenu={(e) => {
            e.preventDefault()
            setPopoverOpen(false)
            setSheetOpen(true)
          }}
          initial={{ opacity: 0, scale: 0.8, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 12 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
          transition={{
            type: 'spring',
            stiffness: 380,
            damping: 26,
            mass: 0.9,
          }}
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 150,
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '1px solid var(--vh-compliant-border)',
            background:
              'radial-gradient(circle at 35% 30%, #1DD99B 0%, #10B981 55%, #0C8B62 100%)',
            color: '#FFFFFF',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow:
              'inset 0 1px 0 0 rgba(255,255,255,0.4), 0 12px 28px -4px rgba(16, 185, 129, 0.5), 0 2px 6px rgba(0,0,0,0.3)',
            willChange: 'transform',
          }}
        >
          {/* Phone glyph (SVG, NOT emoji) */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
          </svg>
        </motion.button>
      </AnimatePresence>

      {/* Popover with DialerKeypad inside */}
      <AnimatePresence>
        {popoverOpen && (
          <motion.div
            key="voice-fab-popover"
            ref={popoverRef}
            role="dialog"
            aria-label="Quick dialer"
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 8 }}
            transition={{
              type: 'spring',
              stiffness: 380,
              damping: 30,
              mass: 0.9,
            }}
            style={{
              position: 'fixed',
              right: 24,
              bottom: 96, // above the FAB
              zIndex: 150,
              width: 'min(360px, calc(100vw - 48px))',
              transformOrigin: 'bottom right',
            }}
          >
            <DialerKeypad />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PlaceCallSheet — right-click on the FAB opens the full sheet */}
      <PlaceCallSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  )
}
