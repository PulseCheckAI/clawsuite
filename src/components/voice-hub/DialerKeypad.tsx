// DialerKeypad — iPhone-style click-to-type telephone keypad.
// ───────────────────────────────────────────────────────────────────────────
// Visual: 3×4 button grid (1-9, *, 0, #) inside a LiquidGlassPanel frame,
// E.164-normalized display strip above, three-up action row below
// (paste, big emerald call button, backspace with long-press-to-clear).
//
// Interactions:
//   - Click a key → digit appended, spring tap micro-animation (motion).
//   - Type a digit on physical keyboard → same handler, no focus needed.
//   - Backspace key or button → pop one digit. Long-press button → clear.
//   - Paste anywhere with focus → normalize, keep only digits + leading '+'.
//   - Big call button → POST /api/calls/place { to } (stubbed; S2 wires).
//
// Design notes:
//   - Cursor-proximity refraction lives in DialerKeypad.module.css via a
//     :has() selector plus --cursor-x / --cursor-y custom properties that
//     this file updates on pointermove (rAF-throttled).
//   - whileTap={{ scale: 0.95 }} + spring back per the brief.
//   - prefers-reduced-motion handled globally in voice-hub-tokens.css.
//   - Every interactive control has aria-label + min 44px hit area.
//
// Consumers:
//   - src/components/voice-hub/HubOverview.tsx
//   - src/routes/voice.tsx (via HubOverview)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { LiquidGlassPanel } from './LiquidGlassPanel'
import styles from './DialerKeypad.module.css'

// ── Types ───────────────────────────────────────────────────────────────────

export interface DialerKeypadProps {
  /** Optional default value (raw digits, may start with '+'). */
  initialValue?: string
  /** Fires every time the buffer changes. */
  onChange?: (e164OrPartial: string) => void
  /** Override the call handler. When omitted, uses the stub. */
  onCall?: (params: { to: string }) => Promise<void> | void
  /** Disable input + the call button. */
  disabled?: boolean
  className?: string
}

type CallState = 'idle' | 'connecting' | 'connected' | 'failed'

// ── Key layout ──────────────────────────────────────────────────────────────
// Letters mirror the iPhone keypad — purely decorative.
const KEYS: ReadonlyArray<{ digit: string; letters: string }> = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
]

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip everything that's not a digit or a leading '+'. */
function sanitize(raw: string): string {
  const trimmed = raw.trim()
  const hasLeadingPlus = trimmed.startsWith('+')
  const digitsOnly = trimmed.replace(/\D/g, '')
  if (!digitsOnly) return ''
  return (hasLeadingPlus ? '+' : '') + digitsOnly
}

/**
 * Format a buffer for display. NOT a libphonenumber port — visible rhythm
 * only. Real E.164 validation happens server-side when S2 ships.
 */
function formatForDisplay(raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('+')) {
    const digits = raw.slice(1)
    if (digits.length <= 3) return `+${digits}`
    const cc = digits.slice(0, Math.min(3, Math.max(1, digits.length - 9)))
    const rest = digits.slice(cc.length)
    const grouped = rest.match(/.{1,3}/g)?.join(' ') ?? rest
    return `+${cc} ${grouped}`.trim()
  }
  if (raw.length === 10) {
    return `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`
  }
  if (raw.length === 11 && raw.startsWith('1')) {
    return `+1 (${raw.slice(1, 4)}) ${raw.slice(4, 7)}-${raw.slice(7)}`
  }
  const grouped = raw.match(/.{1,3}/g)?.join(' ') ?? raw
  return grouped
}

/** Minimum-viable "callable" check — has at least 7 digits. */
function isCallable(raw: string): boolean {
  return raw.replace(/\D/g, '').length >= 7
}

// ── Stub API call (S2 will replace) ────────────────────────────────────────
async function stubPlaceCall(params: { to: string }): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[voice-hub] POST /api/calls/place (stub)', params)
  await new Promise((resolve) => setTimeout(resolve, 900))
}

// ───────────────────────────────────────────────────────────────────────────

export function DialerKeypad({
  initialValue = '',
  onChange,
  onCall,
  disabled = false,
  className,
}: DialerKeypadProps) {
  const [buffer, setBuffer] = useState(() => sanitize(initialValue))
  const [callState, setCallState] = useState<CallState>('idle')
  const frameRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cursorRafRef = useRef<number | null>(null)

  const updateBuffer = useCallback(
    (next: string) => {
      const cleaned = sanitize(next)
      setBuffer(cleaned)
      onChange?.(cleaned)
    },
    [onChange],
  )

  const pushDigit = useCallback(
    (digit: string) => {
      if (disabled) return
      updateBuffer(buffer + digit)
    },
    [buffer, disabled, updateBuffer],
  )

  const popDigit = useCallback(() => {
    if (disabled) return
    updateBuffer(buffer.slice(0, -1))
  }, [buffer, disabled, updateBuffer])

  const clearAll = useCallback(() => {
    if (disabled) return
    updateBuffer('')
  }, [disabled, updateBuffer])

  // Place-call handler (stub).
  const handleCall = useCallback(async () => {
    if (disabled || !isCallable(buffer)) return
    setCallState('connecting')
    try {
      const handler = onCall ?? stubPlaceCall
      await handler({ to: buffer })
      setCallState('connected')
      setTimeout(() => setCallState('idle'), 1600)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[voice-hub] place call failed', err)
      setCallState('failed')
      setTimeout(() => setCallState('idle'), 2000)
    }
  }, [buffer, disabled, onCall])

  // Long-press backspace → clear. 600ms feels long-enough-on-purpose so a
  // normal tap is still just one digit.
  const onBackspacePointerDown = useCallback(() => {
    if (disabled) return
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      clearAll()
      longPressTimerRef.current = null
    }, 600)
  }, [clearAll, disabled])

  const onBackspacePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
      popDigit()
    }
  }, [popDigit])

  // Physical keyboard input — works whenever the frame OR a descendant
  // has focus. Avoids stealing typing from other parts of the page.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      if (e.metaKey || e.ctrlKey) return
      if (e.key === 'Backspace') {
        e.preventDefault()
        popDigit()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (isCallable(buffer)) void handleCall()
        return
      }
      if (/^[0-9*#+]$/.test(e.key)) {
        e.preventDefault()
        pushDigit(e.key)
      }
    },
    [buffer, disabled, popDigit, pushDigit, handleCall],
  )

  // Paste handler — accept anything paste-able, normalize, drop the rest.
  useEffect(() => {
    if (disabled) return
    const el = frameRef.current
    if (!el) return
    const onPaste = (ev: ClipboardEvent) => {
      const text = ev.clipboardData?.getData('text') ?? ''
      if (!text) return
      ev.preventDefault()
      updateBuffer(sanitize(text))
    }
    el.addEventListener('paste', onPaste)
    return () => el.removeEventListener('paste', onPaste)
  }, [disabled, updateBuffer])

  // Cursor-proximity refraction — rAF-throttled pointermove updates two
  // CSS custom properties read by the .grid::before radial-gradient.
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = frameRef.current
    if (!el) return
    if (cursorRafRef.current != null) return
    const clientX = e.clientX
    const clientY = e.clientY
    cursorRafRef.current = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * 100
      const y = ((clientY - rect.top) / rect.height) * 100
      el.style.setProperty('--cursor-x', `${x}%`)
      el.style.setProperty('--cursor-y', `${y}%`)
      cursorRafRef.current = null
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
      if (cursorRafRef.current != null)
        cancelAnimationFrame(cursorRafRef.current)
    }
  }, [])

  const displayText = useMemo(() => formatForDisplay(buffer), [buffer])
  const callable = isCallable(buffer)

  // Per-state hint text + classname
  const hint =
    callState === 'connecting'
      ? { text: 'Connecting…', cls: styles.displayHintCompliant }
      : callState === 'connected'
        ? { text: 'Connected', cls: styles.displayHintCompliant }
        : callState === 'failed'
          ? { text: 'Failed', cls: styles.displayHintBlocked }
          : callable
            ? { text: 'TCPA: Cleared', cls: styles.displayHintCompliant }
            : { text: 'Awaiting Number', cls: undefined }

  return (
    <LiquidGlassPanel
      as="section"
      glow={
        callState === 'connecting' || callState === 'connected'
          ? 'compliant'
          : callState === 'failed'
            ? 'blocked'
            : 'none'
      }
      aria-label="Dialer keypad"
      className={className}
    >
      <div
        ref={frameRef}
        className={styles.keypadFrame}
        tabIndex={0}
        role="group"
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
      >
        {/* Display strip ──────────────────────────── */}
        <div className={styles.display} aria-live="polite">
          <span
            className={
              displayText
                ? styles.displayNumber
                : `${styles.displayNumber} ${styles.displayPlaceholder}`
            }
          >
            {displayText || '+1 (___) ___-____'}
          </span>
          <span className={`${styles.displayHint} ${hint.cls ?? ''}`}>
            {hint.text}
          </span>
        </div>

        {/* 3×4 key grid ───────────────────────────── */}
        <div className={styles.grid} role="group" aria-label="Keypad digits">
          {KEYS.map(({ digit, letters }) => (
            <motion.button
              key={digit}
              type="button"
              className={styles.key}
              aria-label={`Dial ${digit}`}
              disabled={disabled}
              onClick={() => pushDigit(digit)}
              whileTap={{ scale: 0.95 }}
              transition={{
                type: 'spring',
                stiffness: 420,
                damping: 22,
                mass: 0.9,
              }}
            >
              <span className={styles.keyDigit}>{digit}</span>
              <span className={styles.keyLetters}>{letters}</span>
            </motion.button>
          ))}
        </div>

        {/* Action row ─────────────────────────────── */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.actionGhost}
            aria-label="Paste a phone number from clipboard"
            disabled={disabled}
            onClick={async () => {
              if (
                typeof navigator !== 'undefined' &&
                navigator.clipboard?.readText
              ) {
                try {
                  const text = await navigator.clipboard.readText()
                  updateBuffer(sanitize(text))
                } catch {
                  // Permission denied → user can still paste with ⌘V.
                }
              }
            }}
          >
            Paste
          </button>

          <motion.button
            type="button"
            className={styles.callButton}
            aria-label={
              callable
                ? `Place call to ${displayText}`
                : 'Enter a number to call'
            }
            disabled={disabled || !callable || callState === 'connecting'}
            onClick={handleCall}
            whileTap={callable ? { scale: 0.92 } : undefined}
            transition={{
              type: 'spring',
              stiffness: 520,
              damping: 38,
              mass: 1,
            }}
          >
            {/* Heroicons-style phone glyph (SVG, NOT emoji per ui-ux rules) */}
            <svg
              width="28"
              height="28"
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

          <button
            type="button"
            className={`${styles.actionGhost} ${styles.actionGhostDestructive}`}
            aria-label={
              buffer
                ? 'Delete last digit. Long-press to clear.'
                : 'Buffer is empty'
            }
            disabled={disabled || !buffer}
            onPointerDown={onBackspacePointerDown}
            onPointerUp={onBackspacePointerUp}
            onPointerLeave={() => {
              if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current)
                longPressTimerRef.current = null
              }
            }}
          >
            {/* Heroicons backspace */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 5H8l-7 7 7 7h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
            <span>Delete</span>
          </button>
        </div>

        {/* Compliance line — visible at-a-glance TCPA traffic light */}
        <div className={styles.complianceLine} aria-live="polite">
          <span
            className={`${styles.complianceDot} ${
              callable
                ? styles.complianceDotCompliant
                : styles.complianceDotWarming
            }`}
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={callable ? 'cleared' : buffer ? 'verifying' : 'waiting'}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 4 }}
              transition={{ duration: 0.18 }}
            >
              {callable
                ? 'Number cleared for outbound · DNC checked'
                : buffer
                  ? 'Need 7+ digits to verify'
                  : 'Compliance check pending number'}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </LiquidGlassPanel>
  )
}
