// AICustomizerChat -- natural-language to voice-scenario JSON.
// ---------------------------------------------------------------------------
// Embedded chat panel. The user types what they want the agent to do; we
// POST to /api/voice-engine/customize-scenario (Groq-backed); the validated
// scenario JSON comes back; the user previews the draft and clicks Apply to
// push it into the parent form.
//
// This component is presentational + the network call -- it owns nothing
// permanent. The parent (scenarios CRUD page or PlaceCallSheet) owns the
// "current scenario" state and the "apply" handler.
//
// Visual: glass card, message thread at top, prompt chips, textarea + Send.
// Lives inside a `data-voice-hub` ancestor so var(--vh-*) tokens resolve.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AIScenarioDraft } from '@/lib/voice-api'
import { VoiceApiError, voiceApi } from '@/lib/voice-api'

// -- Types ------------------------------------------------------------------

export interface AICustomizerChatProps {
  /** The scenario the operator is currently editing in the parent form.
   * Passed to the model as starting context so it edits-in-place rather
   * than rebuilding from scratch. */
  currentScenario?: Record<string, unknown>
  /** Fires when the operator clicks "Apply" on a generated draft. Parent
   * is responsible for merging the draft into its form state. */
  onApply: (scenario: AIScenarioDraft) => void
  /** Optional close handler -- wired when the parent renders the chat in a
   * side-sheet / modal that wants a header X button. */
  onClose?: () => void
  /** Optional override for the three seed prompts shown as chips. */
  seedPrompts?: ReadonlyArray<string>
}

type ChatTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; status: 'loading' }
  | { id: string; role: 'assistant'; status: 'error'; error: string }
  | {
      id: string
      role: 'assistant'
      status: 'draft'
      scenario: AIScenarioDraft
      raw: string
      applied: boolean
    }

const DEFAULT_SEEDS: ReadonlyArray<string> = [
  'Make a friendly outbound check-in for late delivery',
  'Discovery call for new restaurant owner',
  'Win-back call for churned customer',
]

// ---------------------------------------------------------------------------

export function AICustomizerChat({
  currentScenario,
  onApply,
  onClose,
  seedPrompts = DEFAULT_SEEDS,
}: AICustomizerChatProps) {
  const [turns, setTurns] = useState<Array<ChatTurn>>([])
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const threadRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll the thread to the newest message.
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [turns])

  const send = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim()
    if (!prompt || submitting) return
    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: prompt,
    }
    const loadingTurn: ChatTurn = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      status: 'loading',
    }
    setTurns((t) => [...t, userTurn, loadingTurn])
    setInput('')
    setSubmitting(true)
    try {
      const res = await voiceApi.customizeScenario(prompt, currentScenario)
      setTurns((t) =>
        t.map((turn) =>
          turn.id === loadingTurn.id
            ? {
                id: turn.id,
                role: 'assistant',
                status: 'draft',
                scenario: res.scenario,
                raw: res.raw,
                applied: false,
              }
            : turn,
        ),
      )
    } catch (e) {
      const msg =
        e instanceof VoiceApiError
          ? typeof e.detail === 'string'
            ? e.detail
            : e.message
          : e instanceof Error
            ? e.message
            : String(e)
      setTurns((t) =>
        t.map((turn) =>
          turn.id === loadingTurn.id
            ? {
                id: turn.id,
                role: 'assistant',
                status: 'error',
                error: msg,
              }
            : turn,
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const apply = (turnId: string) => {
    const target = turns.find(
      (turn) =>
        turn.id === turnId &&
        turn.role === 'assistant' &&
        turn.status === 'draft',
    )
    setTurns((t) =>
      t.map((turn) =>
        turn.id === turnId &&
        turn.role === 'assistant' &&
        turn.status === 'draft'
          ? { ...turn, applied: true }
          : turn,
      ),
    )
    if (target && target.role === 'assistant' && target.status === 'draft') {
      onApply(target.scenario)
    }
  }

  return (
    <section
      data-voice-hub
      aria-label="AI Call Customizer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--vh-base)',
        color: 'var(--vh-text)',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--vh-glass-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--vh-text-muted)',
            }}
          >
            AI Customizer · Groq · gpt-oss-120b
          </div>
          <h3
            className="font-display"
            style={{
              margin: '4px 0 0',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--vh-text)',
            }}
          >
            Describe the call you want
          </h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customizer"
            style={iconBtnStyle}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </header>

      {/* Seed prompt chips -- shown only before the first user turn */}
      {turns.length === 0 && (
        <div
          style={{
            padding: '12px 20px 0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {seedPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => send(p)}
              disabled={submitting}
              style={chipStyle}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Thread */}
      <div
        ref={threadRef}
        role="log"
        aria-live="polite"
        aria-label="AI customizer conversation"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <AnimatePresence initial={false}>
          {turns.map((turn) => (
            <motion.div
              key={turn.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{
                alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '92%',
              }}
            >
              {turn.role === 'user' ? (
                <UserBubble text={turn.text} />
              ) : turn.status === 'loading' ? (
                <AssistantLoading />
              ) : turn.status === 'error' ? (
                <AssistantError text={turn.error} />
              ) : (
                <AssistantDraft
                  scenario={turn.scenario}
                  applied={turn.applied}
                  onApply={() => apply(turn.id)}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
        style={{
          padding: '12px 20px 16px',
          borderTop: '1px solid var(--vh-glass-border)',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          placeholder="e.g. Confirm pickup time, friendly tone, max 3 minutes"
          rows={2}
          aria-label="Describe the call"
          disabled={submitting}
          style={{
            flex: 1,
            minHeight: 44,
            maxHeight: 160,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--vh-glass-border)',
            background: 'var(--vh-base-elevated)',
            color: 'var(--vh-text)',
            fontSize: 14,
            lineHeight: 1.5,
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="submit"
          disabled={submitting || input.trim().length === 0}
          aria-label="Send to AI Customizer"
          style={{
            minHeight: 44,
            padding: '0 18px',
            borderRadius: 10,
            border: '1px solid var(--vh-active-border)',
            background:
              submitting || input.trim().length === 0
                ? 'var(--vh-active-soft)'
                : 'var(--vh-active)',
            color:
              submitting || input.trim().length === 0
                ? 'var(--vh-active)'
                : '#06251b',
            fontSize: 14,
            fontWeight: 700,
            cursor:
              submitting || input.trim().length === 0
                ? 'not-allowed'
                : 'pointer',
            transition: 'all 150ms ease',
          }}
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  )
}

// -- Bubbles ----------------------------------------------------------------

function UserBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 14,
        background: 'var(--vh-active-soft)',
        border: '1px solid var(--vh-active-border)',
        color: 'var(--vh-text)',
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  )
}

function AssistantLoading() {
  return (
    <div
      role="status"
      style={{
        padding: '10px 14px',
        borderRadius: 14,
        background: 'var(--vh-glass-bg)',
        border: '1px solid var(--vh-glass-border)',
        color: 'var(--vh-text-muted)',
        fontSize: 13,
        display: 'inline-flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <Dots />
      <span>Drafting scenario…</span>
    </div>
  )
}

function AssistantError({ text }: { text: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '10px 14px',
        borderRadius: 14,
        background: 'var(--vh-blocked-soft)',
        border: '1px solid var(--vh-blocked-border)',
        color: 'var(--vh-blocked)',
        fontSize: 13,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  )
}

function AssistantDraft({
  scenario,
  applied,
  onApply,
}: {
  scenario: AIScenarioDraft
  applied: boolean
  onApply: () => void
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        background: 'var(--vh-glass-bg)',
        border: '1px solid var(--vh-glass-border-bright)',
        color: 'var(--vh-text)',
        fontSize: 13,
        display: 'grid',
        gap: 8,
      }}
    >
      <DraftRow label="Name" value={scenario.name} />
      <DraftRow label="Description" value={scenario.description} multi />
      <DraftRow label="Opening line" value={scenario.opening_line} multi />
      <DraftRow label="Objective" value={scenario.objective} multi />
      <DraftRow
        label="Success criteria"
        value={scenario.success_criteria}
        multi
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
        }}
      >
        <DraftRow label="Tone" value={scenario.tone} />
        <DraftRow label="Voice id" value={scenario.voice_id} mono />
        <DraftRow
          label="Max duration"
          value={`${scenario.max_duration_seconds}s`}
          mono
        />
      </div>
      <DraftRow
        label="Allowed tools"
        value={
          scenario.allowed_tools.length
            ? scenario.allowed_tools.join(', ')
            : '(none)'
        }
        mono
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onApply}
          disabled={applied}
          aria-label={
            applied ? 'Already applied to form' : 'Apply this draft to the form'
          }
          style={{
            minHeight: 36,
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid var(--vh-compliant-border)',
            background: applied
              ? 'var(--vh-compliant-soft)'
              : 'var(--vh-compliant)',
            color: applied ? 'var(--vh-compliant)' : '#06251b',
            fontSize: 13,
            fontWeight: 700,
            cursor: applied ? 'default' : 'pointer',
          }}
        >
          {applied ? 'Applied' : 'Apply to form'}
        </button>
      </div>
    </div>
  )
}

function DraftRow({
  label,
  value,
  multi,
  mono,
}: {
  label: string
  value: string
  multi?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <div
        className="font-mono"
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vh-text-muted)',
        }}
      >
        {label}
      </div>
      <div
        className={mono ? 'font-mono' : undefined}
        style={{
          marginTop: 2,
          fontSize: mono ? 12 : 13,
          color: 'var(--vh-text)',
          lineHeight: multi ? 1.5 : 1.3,
          whiteSpace: multi ? 'pre-wrap' : 'normal',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: i * 0.18,
            ease: 'easeInOut',
          }}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--vh-text-muted)',
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  )
}

// -- Styles -----------------------------------------------------------------

const iconBtnStyle: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  border: '1px solid var(--vh-glass-border)',
  background: 'transparent',
  color: 'var(--vh-text-muted)',
  cursor: 'pointer',
}

const chipStyle: CSSProperties = {
  minHeight: 36,
  padding: '0 12px',
  borderRadius: 999,
  border: '1px solid var(--vh-glass-border-bright)',
  background: 'var(--vh-glass-bg)',
  color: 'var(--vh-text)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 150ms ease',
}
