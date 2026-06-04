// /voice/settings -- Per-org voice config editor (Phase 4)
// ---------------------------------------------------------------------------
// Editable view of public.organizations.voice_config (jsonb) for the current
// org. Loads via GET /api/voice-engine/org/:id/voice-config, persists via
// PUT (which voice-engine treats as a MERGE so unknown keys survive).
//
// Editable fields (matches the spec; jsonb keys are open-ended so unknown
// keys passing through don't fight the form):
//   default_provider        radio: voice-engine | hume-evi | grok
//   default_voice_id        typeahead bound to voice_library filtered by provider
//   default_scenario_id     typeahead bound to voice_scenarios
//   tcpa_outbound_window    start/end time pickers (HH:MM, caller's tz)
//   max_call_seconds        number input (60-1800)
//
// Save button writes the full config. Discard reverts the form to the last
// loaded snapshot.
//
// SSR off + voice-hub tokens import, matches /voice/agents posture.

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ErrorBoundary } from '@/components/error-boundary'
import { usePageTitle } from '@/hooks/use-page-title'
import type {
  ClonedVoiceRow,
  ListVoicesResponse,
  OrgVoiceConfig,
  VoiceScenarioRow,
} from '@/lib/voice-api'
import { VoiceApiError, voiceApi } from '@/lib/voice-api'
import '@/styles/voice-hub-tokens.css'

// -- Route ------------------------------------------------------------------

export const Route = createFileRoute('/voice/settings')({
  ssr: false,
  component: function VoiceSettingsRoute() {
    usePageTitle('Voice Settings')
    return (
      <ErrorBoundary
        title="Voice settings error"
        description="Failed to load voice settings. Try reloading."
      >
        <SettingsContainer />
      </ErrorBoundary>
    )
  },
})

// -- Editor form shape (subset of OrgVoiceConfig, normalised for inputs) ---

const PROVIDER_OPTIONS = ['voice-engine', 'hume-evi', 'grok'] as const
type Provider = (typeof PROVIDER_OPTIONS)[number]

interface EditorState {
  default_provider: Provider
  default_voice_id: string
  default_scenario_id: string
  tcpa_start: string // "HH:MM"
  tcpa_end: string // "HH:MM"
  max_call_seconds: number
  // Comma-separated outcome slugs the operator types. On save we split,
  // trim, lowercase, dedupe, validate against OUTCOME_SLUG_RE, and write
  // a string[] to voice_config.success_outcomes. Empty input -> []
  // (= "nothing counts" -- different from a missing key which falls back
  // to the engine defaults).
  success_outcomes: string
}

const EMPTY_EDITOR: EditorState = {
  default_provider: 'voice-engine',
  default_voice_id: '',
  default_scenario_id: '',
  tcpa_start: '09:00',
  tcpa_end: '20:00',
  max_call_seconds: 600,
  success_outcomes: '',
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// Lowercase outcome slugs, matches the voice-engine outcome vocabulary
// and the server-side validator on the performance endpoint.
const OUTCOME_SLUG_RE = /^[a-z0-9_]{1,32}$/

// Echoed in the input placeholder so operators know what they'll get if
// they leave the field empty. Mirrors DEFAULT_SUCCESS_OUTCOMES on the
// performance endpoint.
const DEFAULT_SUCCESS_OUTCOMES_HINT = 'completed, success, booked'

/** Split the comma-separated input into a deduped, lowercased slug array.
 * Skips blanks; does NOT enforce OUTCOME_SLUG_RE -- that happens on save
 * so the user sees a specific error before persisting. */
function parseOutcomesInput(raw: string): Array<string> {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const part of raw.split(',')) {
    const slug = part.trim().toLowerCase()
    if (!slug) continue
    if (seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

function configToEditor(cfg: OrgVoiceConfig): EditorState {
  const provider =
    cfg.default_provider && PROVIDER_OPTIONS.includes(cfg.default_provider)
      ? cfg.default_provider
      : EMPTY_EDITOR.default_provider
  const window =
    cfg.tcpa_outbound_window && typeof cfg.tcpa_outbound_window === 'object'
      ? cfg.tcpa_outbound_window
      : null
  const start =
    window && typeof window.start === 'string' && TIME_RE.test(window.start)
      ? window.start
      : EMPTY_EDITOR.tcpa_start
  const end =
    window && typeof window.end === 'string' && TIME_RE.test(window.end)
      ? window.end
      : EMPTY_EDITOR.tcpa_end
  const maxRaw = cfg.max_call_seconds
  const max =
    typeof maxRaw === 'number' && Number.isFinite(maxRaw)
      ? Math.min(1800, Math.max(60, Math.floor(maxRaw)))
      : EMPTY_EDITOR.max_call_seconds
  // success_outcomes: tolerate a missing key (fallback to '' which the
  // engine resolves to defaults), a non-array (treat as empty), or a
  // string[] (join with ', ' for the input). Filter out anything
  // non-string defensively -- jsonb has no schema.
  let successOutcomesInput = ''
  if (Array.isArray(cfg.success_outcomes)) {
    const cleaned: Array<string> = []
    const seen = new Set<string>()
    for (const v of cfg.success_outcomes) {
      if (typeof v !== 'string') continue
      const slug = v.trim().toLowerCase()
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      cleaned.push(slug)
    }
    successOutcomesInput = cleaned.join(', ')
  }
  return {
    default_provider: provider,
    default_voice_id:
      typeof cfg.default_voice_id === 'string' ? cfg.default_voice_id : '',
    default_scenario_id:
      typeof cfg.default_scenario_id === 'string'
        ? cfg.default_scenario_id
        : '',
    tcpa_start: start,
    tcpa_end: end,
    max_call_seconds: max,
    success_outcomes: successOutcomesInput,
  }
}

/** Merge the editor's typed fields back ON TOP of the original jsonb so any
 * extra keys the org had (custom feature flags, etc) survive a save. */
function editorToConfig(
  editor: EditorState,
  original: OrgVoiceConfig,
): OrgVoiceConfig {
  return {
    ...original,
    default_provider: editor.default_provider,
    default_voice_id: editor.default_voice_id || null,
    default_scenario_id: editor.default_scenario_id || null,
    tcpa_outbound_window: {
      start: editor.tcpa_start,
      end: editor.tcpa_end,
    },
    max_call_seconds: editor.max_call_seconds,
    // Overwrite (not merge) -- handing voice_config a string[] means the
    // operator's current list IS the list. An empty input writes [] (the
    // engine treats empty as "fall back to defaults" -- see the resolver
    // on /scenarios/$id/performance).
    success_outcomes: parseOutcomesInput(editor.success_outcomes),
  }
}

// -- Container --------------------------------------------------------------

function SettingsContainer() {
  const { orgId, ctxError } = useVoiceContext()
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR)
  const [pristine, setPristine] = useState<EditorState>(EMPTY_EDITOR)
  const [originalCfg, setOriginalCfg] = useState<OrgVoiceConfig>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [voices, setVoices] = useState<ListVoicesResponse | null>(null)
  const [scenarios, setScenarios] = useState<Array<VoiceScenarioRow>>([])

  const dirty = useMemo(
    () => JSON.stringify(editor) !== JSON.stringify(pristine),
    [editor, pristine],
  )

  // -- Load config + voices + scenarios in parallel -----------------------
  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    Promise.all([
      voiceApi.getOrgVoiceConfig(orgId),
      voiceApi.listVoices(orgId).catch(() => null),
      voiceApi
        .listScenarios(orgId)
        .then((r) => r.scenarios)
        .catch(() => []),
    ])
      .then(([cfg, v, s]) => {
        if (cancelled) return
        const next = configToEditor(cfg)
        setEditor(next)
        setPristine(next)
        setOriginalCfg(cfg)
        if (v) setVoices(v)
        setScenarios(s)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoadError(toErrorMessage(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const handleSave = useCallback(async () => {
    if (!orgId) {
      setSaveError(
        'No organization resolved -- cannot save until an org is configured.',
      )
      return
    }
    setSaveError(null)
    // Lightweight validation.
    if (!TIME_RE.test(editor.tcpa_start) || !TIME_RE.test(editor.tcpa_end)) {
      setSaveError('TCPA window times must be HH:MM (00:00 - 23:59).')
      return
    }
    if (
      !Number.isFinite(editor.max_call_seconds) ||
      editor.max_call_seconds < 60 ||
      editor.max_call_seconds > 1800
    ) {
      setSaveError('Max call seconds must be between 60 and 1800.')
      return
    }
    // Validate success-outcome slugs before save -- reject the whole save
    // and name the offending entry so the operator can fix it. Empty
    // input is fine (writes [] = "nothing counts as success").
    const parsedOutcomes = parseOutcomesInput(editor.success_outcomes)
    const badOutcome = parsedOutcomes.find((s) => !OUTCOME_SLUG_RE.test(s))
    if (badOutcome !== undefined) {
      setSaveError(
        `Success outcome "${badOutcome}" is invalid -- use lowercase a-z, 0-9, underscore (1-32 chars).`,
      )
      return
    }
    setSaveBusy(true)
    try {
      const payload = editorToConfig(editor, originalCfg)
      const saved = await voiceApi.setOrgVoiceConfig(orgId, payload)
      const next = configToEditor(saved)
      setEditor(next)
      setPristine(next)
      setOriginalCfg(saved)
    } catch (e) {
      setSaveError(toErrorMessage(e))
    } finally {
      setSaveBusy(false)
    }
  }, [orgId, editor, originalCfg])

  const handleDiscard = useCallback(() => {
    setEditor(pristine)
    setSaveError(null)
  }, [pristine])

  // Voices for the typeahead, filtered by provider. The cloned voices in
  // voice_library don't carry a provider column (today), so we show them
  // under both voice-engine and hume-evi defaults (they're useful in either
  // dialer); built-ins are voice-engine-only.
  const availableVoices = useMemo(() => {
    const out: Array<{ id: string; label: string; group: string }> = []
    if (!voices) return out
    if (editor.default_provider === 'voice-engine') {
      for (const v of voices.xtts) {
        const name =
          (typeof v.id === 'string' && v.id) ||
          (typeof v.name === 'string' && v.name) ||
          ''
        if (name) out.push({ id: `xtts:${name}`, label: name, group: 'XTTS' })
      }
      for (const v of voices.kokoro) {
        const name =
          (typeof v.id === 'string' && v.id) ||
          (typeof v.name === 'string' && v.name) ||
          ''
        if (name)
          out.push({ id: `kokoro:${name}`, label: name, group: 'Kokoro' })
      }
    }
    if (
      editor.default_provider === 'voice-engine' ||
      editor.default_provider === 'hume-evi'
    ) {
      for (const c of voices.cloned as Array<ClonedVoiceRow>) {
        out.push({ id: c.id, label: c.display_name, group: 'Cloned (org)' })
      }
    }
    return out
  }, [voices, editor.default_provider])

  // -- Render -------------------------------------------------------------
  if (orgId === undefined) {
    return (
      <div data-voice-hub style={pageShellStyle}>
        <div className="font-mono text-sm" style={mutedCenterStyle}>
          {ctxError ?? 'Resolving organization…'}
        </div>
      </div>
    )
  }

  return (
    <div
      data-voice-hub
      className="relative min-h-screen px-6 py-6 lg:px-10 lg:py-8"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(46,150,255,0.08), transparent 60%), var(--vh-base)',
        color: 'var(--vh-text)',
      }}
    >
      <Header
        onSave={handleSave}
        onDiscard={handleDiscard}
        canSave={dirty && !saveBusy}
        canDiscard={dirty && !saveBusy}
        busy={saveBusy}
      />

      <section
        style={{
          marginTop: 20,
          borderRadius: 14,
          border: '1px solid var(--vh-glass-border)',
          background: 'var(--vh-glass-bg)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          maxWidth: 760,
        }}
        aria-label="Org voice config"
      >
        {!orgId && (
          <div role="alert" style={warningRowStyle}>
            No organization resolved -- form is editable but Save will fail.
          </div>
        )}

        {loading && (
          <div
            className="font-mono"
            style={{ fontSize: 12, color: 'var(--vh-text-muted)' }}
          >
            Loading current voice config…
          </div>
        )}
        {loadError && (
          <div role="alert" style={errorRowStyle}>
            {loadError}
          </div>
        )}

        <FormField label="Default provider" htmlFor="vs-provider">
          <div
            role="radiogroup"
            aria-label="Default provider"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            {PROVIDER_OPTIONS.map((p) => (
              <ProviderRadio
                key={p}
                checked={editor.default_provider === p}
                onSelect={() => setEditor({ ...editor, default_provider: p })}
                label={p}
                disabled={loading || saveBusy}
              />
            ))}
          </div>
        </FormField>

        <FormField
          label="Default voice id"
          htmlFor="vs-voice"
          hint={
            voices
              ? `${availableVoices.length} voice(s) available for ${editor.default_provider}`
              : 'Voice list unavailable -- you can still type a raw id'
          }
        >
          <input
            id="vs-voice"
            type="text"
            value={editor.default_voice_id}
            onChange={(e) =>
              setEditor({ ...editor, default_voice_id: e.target.value })
            }
            placeholder="Type or pick a voice id"
            list="vs-voice-options"
            disabled={loading || saveBusy}
            style={inputStyle}
          />
          {availableVoices.length > 0 && (
            <datalist id="vs-voice-options">
              {availableVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.group})
                </option>
              ))}
            </datalist>
          )}
        </FormField>

        <FormField
          label="Default scenario id"
          htmlFor="vs-scenario"
          hint={`${scenarios.length} scenario(s) on file`}
        >
          <input
            id="vs-scenario"
            type="text"
            value={editor.default_scenario_id}
            onChange={(e) =>
              setEditor({ ...editor, default_scenario_id: e.target.value })
            }
            placeholder="Type or pick a scenario id"
            list="vs-scenario-options"
            disabled={loading || saveBusy}
            style={inputStyle}
          />
          {scenarios.length > 0 && (
            <datalist id="vs-scenario-options">
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </datalist>
          )}
        </FormField>

        <FormField
          label="TCPA outbound window (caller's tz)"
          htmlFor="vs-tcpa-start"
          hint="Calls outside this window will be refused by the gating layer"
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              id="vs-tcpa-start"
              type="time"
              value={editor.tcpa_start}
              onChange={(e) =>
                setEditor({ ...editor, tcpa_start: e.target.value })
              }
              disabled={loading || saveBusy}
              style={{ ...inputStyle, maxWidth: 160 }}
            />
            <span
              style={{ color: 'var(--vh-text-muted)', fontSize: 13 }}
              aria-hidden="true"
            >
              to
            </span>
            <input
              id="vs-tcpa-end"
              type="time"
              aria-label="TCPA window end"
              value={editor.tcpa_end}
              onChange={(e) =>
                setEditor({ ...editor, tcpa_end: e.target.value })
              }
              disabled={loading || saveBusy}
              style={{ ...inputStyle, maxWidth: 160 }}
            />
          </div>
        </FormField>

        <FormField
          label="Max call duration (seconds)"
          htmlFor="vs-max"
          hint="Hard cap (60-1800). Voice engine ends the call when this elapses."
        >
          <input
            id="vs-max"
            type="number"
            min={60}
            max={1800}
            step={30}
            value={editor.max_call_seconds}
            onChange={(e) =>
              setEditor({
                ...editor,
                max_call_seconds: Number(e.target.value) || 600,
              })
            }
            disabled={loading || saveBusy}
            style={{ ...inputStyle, maxWidth: 200 }}
          />
        </FormField>

        <FormField
          label="Success outcomes"
          htmlFor="vs-success-outcomes"
          hint="Outcomes that count as success when computing per-scenario success rates."
        >
          <input
            id="vs-success-outcomes"
            type="text"
            value={editor.success_outcomes}
            onChange={(e) =>
              setEditor({ ...editor, success_outcomes: e.target.value })
            }
            placeholder={`e.g. ${DEFAULT_SUCCESS_OUTCOMES_HINT} (leave blank for defaults)`}
            disabled={loading || saveBusy}
            style={inputStyle}
            aria-describedby="vs-success-outcomes-preview"
          />
          <OutcomeChipPreview
            id="vs-success-outcomes-preview"
            input={editor.success_outcomes}
          />
        </FormField>

        {saveError && (
          <div role="alert" style={errorRowStyle}>
            {saveError}
          </div>
        )}
      </section>
    </div>
  )
}

// -- Header -----------------------------------------------------------------

function Header({
  onSave,
  onDiscard,
  canSave,
  canDiscard,
  busy,
}: {
  onSave: () => void
  onDiscard: () => void
  canSave: boolean
  canDiscard: boolean
  busy: boolean
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
          PulseOS · Voice Hub · Settings
        </div>
        <h1
          className="font-display mt-1 text-2xl font-bold tracking-tight lg:text-3xl"
          style={{ color: 'var(--vh-text)' }}
        >
          Voice settings
        </h1>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onDiscard}
          disabled={!canDiscard}
          aria-label="Discard unsaved voice-config changes"
          style={toolbarBtnStyle('ghost', !canDiscard)}
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          aria-label="Save voice settings"
          style={toolbarBtnStyle('compliant', !canSave)}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </header>
  )
}

function ProviderRadio({
  checked,
  onSelect,
  label,
  disabled,
}: {
  checked: boolean
  onSelect: () => void
  label: string
  disabled: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      style={{
        minHeight: 44,
        padding: '8px 16px',
        borderRadius: 10,
        border: `1px solid ${checked ? 'var(--vh-active-border)' : 'var(--vh-glass-border)'}`,
        background: checked
          ? 'var(--vh-active-soft)'
          : 'var(--vh-base-elevated)',
        color: checked ? 'var(--vh-active)' : 'var(--vh-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      {label}
    </button>
  )
}

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="font-mono"
        style={{
          display: 'block',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vh-text-muted)',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--vh-text-faint)',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}

// Renders the comma-separated success_outcomes input as a chip stack so the
// operator sees exactly what will be persisted (after split + trim + lowercase
// + dedupe). Invalid slugs are shown in the "blocked" tone so they spot the
// issue before clicking Save -- save-time validation is the source of truth.
function OutcomeChipPreview({ id, input }: { id: string; input: string }) {
  const slugs = parseOutcomesInput(input)
  if (slugs.length === 0) {
    return (
      <div
        id={id}
        style={{
          marginTop: 6,
          fontSize: 11,
          color: 'var(--vh-text-faint)',
          fontStyle: 'italic',
        }}
      >
        No outcomes set -- the engine will use the default list (
        {DEFAULT_SUCCESS_OUTCOMES_HINT}).
      </div>
    )
  }
  return (
    <div
      id={id}
      style={{
        marginTop: 6,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      {slugs.map((s) => {
        const ok = OUTCOME_SLUG_RE.test(s)
        return (
          <span
            key={s}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              border: `1px solid ${ok ? 'var(--vh-compliant-border)' : 'var(--vh-blocked-border)'}`,
              background: ok
                ? 'var(--vh-compliant-soft)'
                : 'var(--vh-blocked-soft)',
              color: ok ? 'var(--vh-compliant)' : 'var(--vh-blocked)',
            }}
            title={ok ? undefined : 'Invalid -- use a-z, 0-9, _ (1-32 chars).'}
          >
            {s}
          </span>
        )
      })}
    </div>
  )
}

// -- Org context hook ------------------------------------------------------

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

// -- Helpers ---------------------------------------------------------------

function toErrorMessage(e: unknown): string {
  if (e instanceof VoiceApiError) {
    if (typeof e.detail === 'string' && e.detail.length > 0) return e.detail
    return e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}

// -- Styles ----------------------------------------------------------------

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--vh-glass-border)',
  background: 'var(--vh-base-elevated)',
  color: 'var(--vh-text)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
}

const errorRowStyle: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--vh-blocked-soft)',
  border: '1px solid var(--vh-blocked-border)',
  color: 'var(--vh-blocked)',
  fontSize: 13,
}

const warningRowStyle: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: 'var(--vh-warming-soft)',
  border: '1px solid var(--vh-warming-border)',
  color: 'var(--vh-warming)',
  fontSize: 12,
}

function toolbarBtnStyle(
  tone: 'active' | 'compliant' | 'blocked' | 'ghost',
  disabled = false,
): CSSProperties {
  const palettes = {
    active: {
      border: 'var(--vh-active-border)',
      bg: disabled ? 'transparent' : 'var(--vh-active-soft)',
      fg: 'var(--vh-active)',
    },
    compliant: {
      border: 'var(--vh-compliant-border)',
      bg: disabled ? 'var(--vh-compliant-soft)' : 'var(--vh-compliant)',
      fg: disabled ? 'var(--vh-compliant)' : '#06251b',
    },
    blocked: {
      border: 'var(--vh-blocked-border)',
      bg: disabled ? 'transparent' : 'var(--vh-blocked-soft)',
      fg: 'var(--vh-blocked)',
    },
    ghost: {
      border: 'var(--vh-glass-border-bright)',
      bg: 'transparent',
      fg: 'var(--vh-text)',
    },
  } as const
  const p = palettes[tone]
  return {
    minHeight: 40,
    padding: '0 16px',
    borderRadius: 10,
    border: `1px solid ${p.border}`,
    background: p.bg,
    color: p.fg,
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'all 150ms ease',
  }
}

const pageShellStyle: CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--vh-base)',
  color: 'var(--vh-text-muted)',
}

const mutedCenterStyle: CSSProperties = {
  fontSize: 14,
  letterSpacing: '0.04em',
}
