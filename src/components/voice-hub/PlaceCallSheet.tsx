// PlaceCallSheet — right-side slide-in modal for placing an outbound call.
// ───────────────────────────────────────────────────────────────────────────
// Visual: 480px wide overlay docked to the right edge of the viewport.
// Glassmorphism panel, slide-in from x:100% (AnimatePresence). Backdrop
// scrim fades in behind it; pressing Escape, the backdrop, or the close
// button dismisses.
//
// Fields (all STUBBED — wires to real lead / scenario / DNA queries once
// S1/S2/S3 land):
//   - To           (lead picker — synthetic dropdown of 3 leads)
//   - From         (per-org caller-id radio — 2 stub numbers)
//   - Scenario     (radio: Q-check / Re-engage / Ad-hoc)
//   - Customize    (collapsible: expected pain / must mention / must avoid /
//                   voice / max duration)
//   - Behavioral DNA panel (read-only, stub)
//   - Compliance preflight (4 traffic lights — all green stub)
//   - Footer: Save overlay as Scenario · Cancel · Place Now (primary)
//
// Antigravity: 100% → 0 transform via spring, gentle blur during transition
// so the page reads as "the panel rose from the right edge" not "snapped in".
// ui-ux-pro-max: all clickable items have cursor-pointer + 44px hit area,
// ARIA-labeled, escape closes, body scroll locked.
// framer-motion: AnimatePresence handles enter/exit, layoutId not used (no
// shared element transitions here — keeps it lighter).
//
// Consumers:
//   - src/routes/voice-preview.tsx (standalone demo)
//   - src/components/voice-hub/VoiceFloatingButton.tsx
//
// Phase 2 (NOT in this file):
//   - Shadow Mode toggle, AI Customizer chat (separate Skill / sheet)

import { Suspense, lazy, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LiquidGlassPanel } from './LiquidGlassPanel'
import type { ReactNode } from 'react'
import type { AIScenarioDraft } from '@/lib/voice-api'
import { VoiceApiError, voiceApi } from '@/lib/voice-api'

// Lazy-loaded so the AI Customizer chunk only ships when an operator
// actually clicks "Customize with AI" inside the sheet.
const AICustomizerChat = lazy(() =>
  import('./AICustomizerChat').then((m) => ({ default: m.AICustomizerChat })),
)

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlaceCallSheetProps {
  /** Controls visibility. */
  open: boolean
  /** Fires when the sheet wants to close (Esc, backdrop, Cancel, X). */
  onClose: () => void
  /** Optional pre-fill of the To field. */
  initialTo?: string
  /** Optional pre-fill of the scenario id. */
  initialScenario?: ScenarioId
  /** Fires when user clicks Place Now. When omitted AND `organizationId` is
   * set, the sheet calls `voiceApi.placeCall` directly; the resulting
   * voice_calls row will flow back via the Supabase realtime channel the
   * /voice page subscribes to. When omitted AND `organizationId` is unset,
   * falls back to a console-log stub (used by /voice-preview). */
  onPlaceCall?: (payload: PlaceCallPayload) => Promise<void> | void
  /** Fires when user clicks "Save overlay as Scenario". Stub by default. */
  onSaveScenario?: (payload: PlaceCallPayload) => Promise<void> | void
  /** Org the call should be placed under. When set the default Place Now
   * handler forwards via voiceApi.placeCall(). Unset = demo posture. */
  organizationId?: string
}

type ScenarioId = 'q-check' | 're-engage' | 'ad-hoc'

export interface PlaceCallPayload {
  to: string
  fromCallerId: string
  scenario: ScenarioId
  customize: {
    expectedPain: string
    mustMention: string
    mustAvoid: string
    voice: 'warm' | 'professional' | 'energetic'
    maxDurationMin: number
  }
}

// ── Stub catalogues (S1/S2/S3 will replace with live queries) ──────────────

const LEADS_STUB: ReadonlyArray<{
  id: string
  name: string
  phone: string
}> = [
  { id: 'lead-1', name: 'Acropolis Greek Taverna', phone: '+1 (305) 555-0143' },
  { id: 'lead-2', name: 'Corner Table', phone: '+1 (415) 555-0199' },
  { id: 'lead-3', name: 'Bayside Catering', phone: '+1 (727) 555-0117' },
]

const CALLER_IDS_STUB: ReadonlyArray<{
  id: string
  label: string
  number: string
}> = [
  { id: 'cid-main', label: 'Main line', number: '+1 (786) 555-0100' },
  { id: 'cid-sales', label: 'Sales (local)', number: '+1 (305) 555-0188' },
]

const SCENARIOS_STUB: ReadonlyArray<{
  id: ScenarioId
  label: string
  blurb: string
}> = [
  { id: 'q-check', label: 'Q-Check', blurb: 'Quick health pulse · 3-5 min' },
  {
    id: 're-engage',
    label: 'Re-engage',
    blurb: 'Reconnect lapsed contact · 5-10 min',
  },
  { id: 'ad-hoc', label: 'Ad-hoc', blurb: 'Custom freeform call · open-ended' },
]

const BEHAVIORAL_DNA_STUB = {
  register: 'casual',
  pace: 'fast',
  preferredAddress: 'Sam',
  lastTopic: 'labor scheduling',
  notes:
    'Tense in last call — avoid pricing pressure. Prefers direct asks; minimal small talk.',
}

const COMPLIANCE_PREFLIGHT_STUB: ReadonlyArray<{
  label: string
  state: 'pass' | 'warn' | 'fail'
  detail: string
}> = [
  { label: 'TCPA consent', state: 'pass', detail: 'Inbound consent · 3 days' },
  { label: 'DNC check', state: 'pass', detail: 'Federal + internal clear' },
  { label: 'Call window', state: 'pass', detail: '2:30 PM local · in-window' },
  { label: 'Rate cap', state: 'pass', detail: '12/50 daily quota used' },
]

// ── Helpers ────────────────────────────────────────────────────────────────

async function stubPlaceCall(payload: PlaceCallPayload): Promise<void> {
  console.log('[voice-hub] Place call (stub)', payload)
  await new Promise((r) => setTimeout(r, 600))
}

async function stubSaveScenario(payload: PlaceCallPayload): Promise<void> {
  console.log('[voice-hub] Save scenario from overlay (stub)', payload)
  await new Promise((r) => setTimeout(r, 400))
}

// ── Motion ────────────────────────────────────────────────────────────────

const SHEET_ENTRANCE = {
  hidden: { x: '100%', opacity: 0.6 },
  visible: {
    x: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 280,
      damping: 32,
      mass: 1,
    },
  },
  exit: {
    x: '100%',
    opacity: 0.4,
    transition: { duration: 0.24, ease: [0.22, 0.61, 0.36, 1] as const },
  },
}

const BACKDROP_FADE = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
}

// ───────────────────────────────────────────────────────────────────────────

export function PlaceCallSheet({
  open,
  onClose,
  initialTo,
  initialScenario = 'q-check',
  onPlaceCall,
  onSaveScenario,
  organizationId,
}: PlaceCallSheetProps) {
  const initialLead =
    LEADS_STUB.find((l) => l.phone === initialTo) ?? LEADS_STUB[0]
  const [leadId, setLeadId] = useState(initialLead.id)
  const [callerId, setCallerId] = useState(CALLER_IDS_STUB[0].id)
  const [scenario, setScenario] = useState<ScenarioId>(initialScenario)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [expectedPain, setExpectedPain] = useState('')
  const [mustMention, setMustMention] = useState('')
  const [mustAvoid, setMustAvoid] = useState('')
  const [voice, setVoice] = useState<'warm' | 'professional' | 'energetic'>(
    'warm',
  )
  const [maxDuration, setMaxDuration] = useState(8)
  const [submitting, setSubmitting] = useState(false)
  // Inline error surface (e.g. compliance refusal_reason from the engine).
  const [submitError, setSubmitError] = useState<string | null>(null)
  // AI Customizer inline panel (opens within the same sheet, not a separate
  // overlay -- spec asked for "inline").
  const [customizerOpen, setCustomizerOpen] = useState(false)

  // Map an AI-generated scenario draft onto the editable customize fields.
  // Only the overlay-shaped fields exist on this sheet, so we read the
  // subset that the form actually owns. Name/description/voice_id are not
  // editable here -- the Scenarios CRUD page (/voice/agents) is where those
  // get persisted.
  const applyAIDraft = (draft: AIScenarioDraft) => {
    // Synthesize a single "must mention" string from objective + opening_line
    // because the sheet only has one input for that slot.
    const mustMentionLine = draft.opening_line || draft.objective
    if (mustMentionLine) setMustMention(mustMentionLine)
    if (draft.success_criteria) setExpectedPain(draft.success_criteria)
    // Tone heuristic -- the form's voice select is a closed enum, so map.
    const t = draft.tone.toLowerCase()
    if (t.includes('energ')) setVoice('energetic')
    else if (t.includes('prof') || t.includes('formal'))
      setVoice('professional')
    else setVoice('warm')
    // Clamp max duration to the sheet's minute scale.
    if (draft.max_duration_seconds > 0) {
      setMaxDuration(
        Math.max(1, Math.min(60, Math.round(draft.max_duration_seconds / 60))),
      )
    }
    // Open the customize panel so the operator can see what was filled in.
    setCustomizeOpen(true)
    setCustomizerOpen(false)
  }

  // Build a snapshot of the current overlay for the AI customizer so it can
  // edit-in-place rather than generating from scratch.
  const currentForCustomizer: Record<string, unknown> = {
    expected_pain: expectedPain,
    must_mention: mustMention,
    must_avoid: mustAvoid,
    voice,
    max_duration_min: maxDuration,
    scenario,
  }

  // Lock body scroll while open + Escape closes.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const collectPayload = (): PlaceCallPayload => {
    const lead = LEADS_STUB.find((l) => l.id === leadId) ?? LEADS_STUB[0]
    const cid =
      CALLER_IDS_STUB.find((c) => c.id === callerId) ?? CALLER_IDS_STUB[0]
    return {
      to: lead.phone,
      fromCallerId: cid.number,
      scenario,
      customize: {
        expectedPain,
        mustMention,
        mustAvoid,
        voice,
        maxDurationMin: maxDuration,
      },
    }
  }

  const handlePlace = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload = collectPayload()
      // Three paths, in priority order:
      //   1. Explicit override prop — caller fully owns the side effect.
      //   2. Live wiring — org set + no override → POST voice-engine /calls.
      //      The new row arrives via the supabase realtime channel that
      //      LiveHubOverview subscribes to, so we don't need to thread it
      //      back as a return value here.
      //   3. Demo posture — no org + no override → console-log stub. Used
      //      by /voice-preview to keep the design demo working with no
      //      backend dependency.
      if (onPlaceCall) {
        await onPlaceCall(payload)
        onClose()
        return
      }
      if (organizationId) {
        // Build the overlay from the customize panel. Empty fields skipped
        // so the engine sees a clean overlay rather than {expectedPain: ""}.
        const overlay: Record<string, unknown> = {}
        if (payload.customize.expectedPain) {
          overlay.expected_pain = payload.customize.expectedPain
        }
        if (payload.customize.mustMention) {
          overlay.must_mention = payload.customize.mustMention
        }
        if (payload.customize.mustAvoid) {
          overlay.must_avoid = payload.customize.mustAvoid
        }
        overlay.voice = payload.customize.voice
        overlay.max_duration_min = payload.customize.maxDurationMin
        overlay.caller_id = payload.fromCallerId
        overlay.scenario_label = payload.scenario

        const res = await voiceApi.placeCall({
          lead_id: leadId,
          organization_id: organizationId,
          phone: payload.to,
          transport: 'twilio',
          overlay,
        })
        if (res.status === 'gated_refused') {
          // Don't auto-close — leave the sheet open so the operator can fix
          // the issue (toggle a setting, pick another caller-id) and retry.
          setSubmitError(
            `Refused at the gate — ${res.refusal_reason ?? 'no reason provided'}`,
          )
          return
        }
        onClose()
        return
      }
      // Demo posture
      await stubPlaceCall(payload)
      onClose()
    } catch (e) {
      const msg =
        e instanceof VoiceApiError
          ? typeof e.detail === 'string'
            ? e.detail
            : e.message
          : e instanceof Error
            ? e.message
            : String(e)
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveScenario = async () => {
    const handler = onSaveScenario ?? stubSaveScenario
    await handler(collectPayload())
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          data-voice-hub
          style={{ position: 'fixed', inset: 0, zIndex: 200 }}
          role="dialog"
          aria-modal="true"
          aria-label="Place a call"
        >
          {/* Backdrop scrim — click to dismiss */}
          <motion.div
            variants={BACKDROP_FADE}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(7, 10, 17, 0.55)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              cursor: 'pointer',
            }}
            aria-label="Close — click outside to cancel"
          />

          {/* Sheet */}
          <motion.aside
            variants={SHEET_ENTRANCE}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(480px, 100vw)',
              background: 'var(--vh-base)',
              borderLeft: '1px solid var(--vh-glass-border-bright)',
              boxShadow: 'var(--vh-shadow-float)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header */}
            <header
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                padding: '20px 24px 16px',
                backgroundColor: 'rgba(15, 23, 41, 0.92)',
                backdropFilter: 'blur(20px) saturate(160%)',
                WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                borderBottom: '1px solid var(--vh-glass-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
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
                  Outbound · TCPA-gated
                </div>
                <h2
                  className="font-display"
                  style={{
                    margin: '4px 0 0',
                    fontSize: 22,
                    fontWeight: 700,
                    color: 'var(--vh-text)',
                  }}
                >
                  Place a call
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close sheet"
                style={{
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
                }}
              >
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            {/* Body */}
            <div
              style={{
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
                flex: 1,
              }}
            >
              {/* To — lead picker */}
              <Field label="To" htmlFor="place-call-to">
                <select
                  id="place-call-to"
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                  className="font-mono"
                  style={selectStyle}
                >
                  {LEADS_STUB.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} — {lead.phone}
                    </option>
                  ))}
                </select>
              </Field>

              {/* From — caller-id radios */}
              <Field label="From" htmlFor="place-call-from">
                <div
                  id="place-call-from"
                  role="radiogroup"
                  aria-label="Choose a caller ID"
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                >
                  {CALLER_IDS_STUB.map((cid) => (
                    <PillRadio
                      key={cid.id}
                      checked={callerId === cid.id}
                      onChange={() => setCallerId(cid.id)}
                      label={cid.label}
                      sub={cid.number}
                    />
                  ))}
                </div>
              </Field>

              {/* Scenario radios */}
              <Field label="Scenario" htmlFor="place-call-scenario">
                <div
                  id="place-call-scenario"
                  role="radiogroup"
                  aria-label="Choose a call scenario"
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                >
                  {SCENARIOS_STUB.map((s) => (
                    <PillRadio
                      key={s.id}
                      checked={scenario === s.id}
                      onChange={() => setScenario(s.id)}
                      label={s.label}
                      sub={s.blurb}
                    />
                  ))}
                </div>
                {/* AI Customizer toggle -- inline, below the scenario pills. */}
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setCustomizerOpen((v) => !v)}
                    aria-expanded={customizerOpen}
                    aria-controls="place-call-ai-customizer"
                    style={{
                      minHeight: 36,
                      padding: '0 12px',
                      borderRadius: 8,
                      border: '1px solid var(--vh-active-border)',
                      background: customizerOpen
                        ? 'var(--vh-active)'
                        : 'var(--vh-active-soft)',
                      color: customizerOpen ? '#06251b' : 'var(--vh-active)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    {customizerOpen
                      ? 'Hide AI Customizer'
                      : 'Customize with AI'}
                  </button>
                </div>
              </Field>

              {/* AI Customizer inline panel -- collapsible. */}
              <AnimatePresence initial={false}>
                {customizerOpen && (
                  <motion.div
                    id="place-call-ai-customizer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                      overflow: 'hidden',
                      borderRadius: 12,
                      border: '1px solid var(--vh-glass-border-bright)',
                      background: 'var(--vh-base-elevated)',
                    }}
                  >
                    <div style={{ height: 420, display: 'flex' }}>
                      <Suspense
                        fallback={
                          <div
                            style={{
                              padding: 16,
                              color: 'var(--vh-text-muted)',
                              fontSize: 13,
                            }}
                          >
                            Loading customizer…
                          </div>
                        }
                      >
                        <AICustomizerChat
                          currentScenario={currentForCustomizer}
                          onApply={applyAIDraft}
                          onClose={() => setCustomizerOpen(false)}
                        />
                      </Suspense>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Customize collapsible */}
              <div
                style={{
                  borderRadius: 12,
                  border: '1px solid var(--vh-glass-border)',
                  background: 'var(--vh-glass-bg)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setCustomizeOpen((v) => !v)}
                  aria-expanded={customizeOpen}
                  aria-controls="place-call-customize-body"
                  style={{
                    width: '100%',
                    minHeight: 44,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'transparent',
                    border: 0,
                    color: 'var(--vh-text)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  <span>Customize for this call</span>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      transition: 'transform 200ms ease',
                      transform: customizeOpen
                        ? 'rotate(180deg)'
                        : 'rotate(0deg)',
                    }}
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
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {customizeOpen && (
                    <motion.div
                      id="place-call-customize-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div
                        style={{
                          padding: '0 16px 16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                        }}
                      >
                        <SmallField label="Expected pain">
                          <input
                            type="text"
                            value={expectedPain}
                            onChange={(e) => setExpectedPain(e.target.value)}
                            placeholder="e.g. labor scheduling waste"
                            style={inputStyle}
                          />
                        </SmallField>
                        <SmallField label="Must mention">
                          <input
                            type="text"
                            value={mustMention}
                            onChange={(e) => setMustMention(e.target.value)}
                            placeholder="e.g. last quarter's margin recovery"
                            style={inputStyle}
                          />
                        </SmallField>
                        <SmallField label="Must avoid">
                          <input
                            type="text"
                            value={mustAvoid}
                            onChange={(e) => setMustAvoid(e.target.value)}
                            placeholder="e.g. competitor names, pricing"
                            style={inputStyle}
                          />
                        </SmallField>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 12,
                          }}
                        >
                          <SmallField label="Voice">
                            <select
                              value={voice}
                              onChange={(e) =>
                                setVoice(e.target.value as typeof voice)
                              }
                              style={selectStyle}
                            >
                              <option value="warm">Warm</option>
                              <option value="professional">Professional</option>
                              <option value="energetic">Energetic</option>
                            </select>
                          </SmallField>
                          <SmallField label="Max duration (min)">
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={maxDuration}
                              onChange={(e) =>
                                setMaxDuration(Number(e.target.value) || 8)
                              }
                              style={inputStyle}
                            />
                          </SmallField>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Behavioral DNA — read-only panel */}
              <LiquidGlassPanel
                as="article"
                density="compact"
                aria-label="Behavioral DNA"
              >
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
                  Behavioral DNA · {BEHAVIORAL_DNA_STUB.preferredAddress}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '6px 18px',
                    fontSize: 12,
                  }}
                >
                  <DnaPair
                    label="Register"
                    value={BEHAVIORAL_DNA_STUB.register}
                  />
                  <DnaPair label="Pace" value={BEHAVIORAL_DNA_STUB.pace} />
                  <DnaPair
                    label="Last topic"
                    value={BEHAVIORAL_DNA_STUB.lastTopic}
                  />
                  <DnaPair label="Flag" value="tense — handle with care" />
                </div>
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid var(--vh-glass-border)',
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: 'var(--vh-text-muted)',
                  }}
                >
                  {BEHAVIORAL_DNA_STUB.notes}
                </div>
              </LiquidGlassPanel>

              {/* Compliance preflight */}
              <LiquidGlassPanel
                as="article"
                density="compact"
                aria-label="Compliance preflight"
              >
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
                  Compliance preflight
                </div>
                <ul
                  style={{
                    margin: '8px 0 0',
                    padding: 0,
                    listStyle: 'none',
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  {COMPLIANCE_PREFLIGHT_STUB.map((c) => (
                    <li
                      key={c.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 8px',
                        borderRadius: 8,
                        background: 'var(--vh-glass-bg)',
                      }}
                    >
                      <span
                        aria-label={c.state}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor:
                            c.state === 'pass'
                              ? 'var(--vh-compliant)'
                              : c.state === 'warn'
                                ? 'var(--vh-warming)'
                                : 'var(--vh-blocked)',
                          boxShadow:
                            c.state === 'pass'
                              ? '0 0 6px var(--vh-compliant)'
                              : undefined,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--vh-text)',
                          flex: 1,
                        }}
                      >
                        {c.label}
                      </span>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--vh-text-muted)',
                        }}
                      >
                        {c.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </LiquidGlassPanel>
            </div>

            {/* Inline submit error — e.g. the engine's refusal_reason. */}
            {submitError && (
              <div
                role="alert"
                style={{
                  margin: '0 24px 12px',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--vh-blocked-border)',
                  background: 'var(--vh-blocked-soft)',
                  color: 'var(--vh-blocked)',
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {submitError}
              </div>
            )}

            {/* Footer */}
            <footer
              style={{
                position: 'sticky',
                bottom: 0,
                padding: '14px 24px 18px',
                borderTop: '1px solid var(--vh-glass-border)',
                background: 'rgba(15, 23, 41, 0.92)',
                backdropFilter: 'blur(20px) saturate(160%)',
                WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <button
                type="button"
                onClick={handleSaveScenario}
                aria-label="Save these overlay values as a reusable scenario"
                style={{
                  minHeight: 44,
                  padding: '0 12px',
                  background: 'transparent',
                  border: 0,
                  color: 'var(--vh-active)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Save overlay as Scenario
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cancel and close"
                  style={{
                    minHeight: 44,
                    padding: '0 16px',
                    borderRadius: 10,
                    border: '1px solid var(--vh-glass-border-bright)',
                    background: 'transparent',
                    color: 'var(--vh-text)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <motion.button
                  type="button"
                  onClick={handlePlace}
                  disabled={submitting}
                  aria-label="Place call now"
                  whileTap={submitting ? undefined : { scale: 0.97 }}
                  whileHover={submitting ? undefined : { scale: 1.02 }}
                  transition={{
                    type: 'spring',
                    stiffness: 520,
                    damping: 38,
                  }}
                  style={{
                    minHeight: 44,
                    padding: '0 22px',
                    borderRadius: 10,
                    border: '1px solid var(--vh-compliant-border)',
                    background: submitting
                      ? 'var(--vh-compliant-soft)'
                      : 'var(--vh-compliant)',
                    color: submitting ? 'var(--vh-compliant)' : '#06251b',
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '0.02em',
                    cursor: submitting ? 'wait' : 'pointer',
                    boxShadow: submitting
                      ? undefined
                      : 'var(--vh-shadow-glow-compliant)',
                  }}
                >
                  {submitting ? 'Placing…' : 'Place Now'}
                </motion.button>
              </div>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}

// ── Local atoms ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily:
    "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--vh-text-muted)',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--vh-glass-border)',
  background: 'var(--vh-base-elevated)',
  color: 'var(--vh-text)',
  fontSize: 14,
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23F7F4EE' stroke-opacity='0.6' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 32,
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} style={labelStyle}>
        {label}
      </label>
      {children}
    </div>
  )
}

function SmallField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <span style={{ ...labelStyle, fontSize: 9 }}>{label}</span>
      {children}
    </div>
  )
}

function PillRadio({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean
  onChange: () => void
  label: string
  sub: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onChange}
      style={{
        minHeight: 44,
        padding: '6px 14px',
        borderRadius: 999,
        border: `1px solid ${checked ? 'var(--vh-active-border)' : 'var(--vh-glass-border)'}`,
        background: checked ? 'var(--vh-active-soft)' : 'var(--vh-glass-bg)',
        color: checked ? 'var(--vh-active)' : 'var(--vh-text)',
        cursor: 'pointer',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: 2,
        transition: 'all 150ms ease',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1 }}>
        {label}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          opacity: 0.8,
          letterSpacing: '0.04em',
        }}
      >
        {sub}
      </span>
    </button>
  )
}

function DnaPair({ label, value }: { label: string; value: string }) {
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
        style={{
          marginTop: 2,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--vh-text)',
          textTransform: 'capitalize',
        }}
      >
        {value}
      </div>
    </div>
  )
}
