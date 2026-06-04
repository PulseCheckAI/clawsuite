// /voice/agents -- Scenarios CRUD + AI Customizer entry point.
// ---------------------------------------------------------------------------
// Three-pane layout, matching the visual language of /voice (HubOverview):
//   - Left rail   : scenario list, select / new / delete
//   - Right pane  : editor form mapping to voice_scenarios columns
//   - Top toolbar : Save / Discard / Delete / Customize with AI
//
// AI Customizer opens in a right-edge side sheet (AnimatePresence + backdrop)
// and writes its draft back into the form via onApply. Save persists to
// /api/voice-engine/scenarios (PUT for existing, POST for new) which proxies
// to voice-engine; the new/updated row replaces the rail entry in-place.
//
// SSR off + voice-hub tokens side-effect import -- same posture as /voice.
// ---------------------------------------------------------------------------

import { Link, createFileRoute } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import { ErrorBoundary } from '@/components/error-boundary'
import { usePageTitle } from '@/hooks/use-page-title'
import type {
  AIScenarioDraft,
  ScenarioPerformance,
  ScenarioSuggestion,
  VoiceScenarioRow,
} from '@/lib/voice-api'
import { VoiceApiError, voiceApi } from '@/lib/voice-api'
import '@/styles/voice-hub-tokens.css'

const AICustomizerChat = lazy(() =>
  import('@/components/voice-hub/AICustomizerChat').then((m) => ({
    default: m.AICustomizerChat,
  })),
)

// -- Route ------------------------------------------------------------------

export const Route = createFileRoute('/voice/agents')({
  ssr: false,
  component: function VoiceAgentsRoute() {
    usePageTitle('Voice Scenarios')
    return (
      <ErrorBoundary
        title="Voice scenarios error"
        description="Failed to load scenarios. Try reloading."
      >
        <ScenariosContainer />
      </ErrorBoundary>
    )
  },
})

// -- Editor form state model ------------------------------------------------
//
// Mirrors voice_scenarios columns + the richer AI-draft fields. The "overlay"
// fields (opening_line, objective, success_criteria, tone, allowed_tools)
// persist via voice_scenarios.overlay -- they aren't native columns. The
// VoiceApiClient already accepts overlay: Record<string, unknown>.

interface EditorState {
  id: string | null // null = unsaved draft
  name: string
  description: string
  voice_id: string
  max_duration_seconds: number
  // Overlay fields:
  opening_line: string
  objective: string
  success_criteria: string
  tone: string
  allowed_tools: string // comma-separated in the form; split on save
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  name: '',
  description: '',
  voice_id: '',
  max_duration_seconds: 300,
  opening_line: '',
  objective: '',
  success_criteria: '',
  tone: '',
  allowed_tools: '',
}

function rowToEditor(row: VoiceScenarioRow): EditorState {
  const o = (row.overlay ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  const tools = Array.isArray(o.allowed_tools)
    ? (o.allowed_tools as Array<unknown>).filter(
        (t): t is string => typeof t === 'string',
      )
    : []
  const dur =
    typeof o.max_duration_seconds === 'number'
      ? (o.max_duration_seconds as number)
      : 300
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    voice_id: str('voice_id'),
    max_duration_seconds: dur,
    opening_line: str('opening_line'),
    objective: str('objective'),
    success_criteria: str('success_criteria'),
    tone: str('tone'),
    allowed_tools: tools.join(', '),
  }
}

function editorToOverlay(e: EditorState): Record<string, unknown> {
  const tools = e.allowed_tools
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const overlay: Record<string, unknown> = {
    voice_id: e.voice_id,
    max_duration_seconds: e.max_duration_seconds,
    opening_line: e.opening_line,
    objective: e.objective,
    success_criteria: e.success_criteria,
    tone: e.tone,
    allowed_tools: tools,
  }
  return overlay
}

// AI draft -> form. Pure shape mapping; no I/O.
function aiDraftToEditor(
  current: EditorState,
  draft: AIScenarioDraft,
): EditorState {
  return {
    ...current,
    name: draft.name,
    description: draft.description,
    voice_id: draft.voice_id,
    max_duration_seconds: draft.max_duration_seconds,
    opening_line: draft.opening_line,
    objective: draft.objective,
    success_criteria: draft.success_criteria,
    tone: draft.tone,
    allowed_tools: draft.allowed_tools.join(', '),
  }
}

// -- Container --------------------------------------------------------------

function ScenariosContainer() {
  const { orgId, ctxError } = useVoiceContext()
  const [scenarios, setScenarios] = useState<Array<VoiceScenarioRow>>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR)
  const [pristine, setPristine] = useState<EditorState>(EMPTY_EDITOR)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [customizerOpen, setCustomizerOpen] = useState(false)
  // Phase 5: right-pane tab. "editor" (V1 form) or "performance" (writeback loop).
  const [rightTab, setRightTab] = useState<'editor' | 'performance'>('editor')

  const dirty = useMemo(
    () => JSON.stringify(editor) !== JSON.stringify(pristine),
    [editor, pristine],
  )

  // -- Initial list load --------------------------------------------------
  useEffect(() => {
    if (orgId === undefined) return
    let cancelled = false
    setListLoading(true)
    setListError(null)
    voiceApi
      .listScenarios(orgId ?? undefined)
      .then((res) => {
        if (cancelled) return
        setScenarios(res.scenarios)
        // Auto-select first row if any -- nicer than landing on a blank form.
        if (res.scenarios.length > 0) {
          const initial = rowToEditor(res.scenarios[0])
          setEditor(initial)
          setPristine(initial)
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg =
          e instanceof VoiceApiError
            ? typeof e.detail === 'string'
              ? e.detail
              : e.message
            : e instanceof Error
              ? e.message
              : String(e)
        setListError(msg)
      })
      .finally(() => {
        if (cancelled) return
        setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  // -- Rail handlers ------------------------------------------------------
  const selectScenario = useCallback(
    (row: VoiceScenarioRow) => {
      if (dirty) {
        const ok = window.confirm(
          'Discard unsaved changes to the current scenario?',
        )
        if (!ok) return
      }
      const next = rowToEditor(row)
      setEditor(next)
      setPristine(next)
      setFormError(null)
    },
    [dirty],
  )

  const newScenario = useCallback(() => {
    if (dirty) {
      const ok = window.confirm('Discard unsaved changes to start a new one?')
      if (!ok) return
    }
    setEditor(EMPTY_EDITOR)
    setPristine(EMPTY_EDITOR)
    setFormError(null)
  }, [dirty])

  // -- Toolbar handlers ---------------------------------------------------
  const handleSave = useCallback(async () => {
    setFormError(null)
    if (!editor.name.trim()) {
      setFormError('Name is required.')
      return
    }
    if (!orgId && editor.id === null) {
      setFormError(
        'No organization resolved -- cannot create a scenario without an org.',
      )
      return
    }
    setBusy(true)
    try {
      const overlay = editorToOverlay(editor)
      if (editor.id) {
        const updated = await voiceApi.updateScenario(editor.id, {
          name: editor.name.trim(),
          description: editor.description.trim() || null,
          overlay,
        })
        setScenarios((all) =>
          all.map((r) => (r.id === updated.id ? updated : r)),
        )
        const next = rowToEditor(updated)
        setEditor(next)
        setPristine(next)
      } else {
        const created = await voiceApi.createScenario({
          organization_id: orgId!,
          name: editor.name.trim(),
          description: editor.description.trim() || null,
          overlay,
        })
        setScenarios((all) => [created, ...all])
        const next = rowToEditor(created)
        setEditor(next)
        setPristine(next)
      }
    } catch (e) {
      const msg =
        e instanceof VoiceApiError
          ? typeof e.detail === 'string'
            ? e.detail
            : e.message
          : e instanceof Error
            ? e.message
            : String(e)
      setFormError(msg)
    } finally {
      setBusy(false)
    }
  }, [editor, orgId])

  const handleDiscard = useCallback(() => {
    setEditor(pristine)
    setFormError(null)
  }, [pristine])

  const handleDelete = useCallback(async () => {
    if (!editor.id) {
      // Unsaved draft -- just clear.
      setEditor(EMPTY_EDITOR)
      setPristine(EMPTY_EDITOR)
      return
    }
    const ok = window.confirm(
      `Delete scenario "${editor.name}"? This cannot be undone.`,
    )
    if (!ok) return
    setBusy(true)
    setFormError(null)
    try {
      await voiceApi.deleteScenario(editor.id)
      setScenarios((all) => all.filter((r) => r.id !== editor.id))
      setEditor(EMPTY_EDITOR)
      setPristine(EMPTY_EDITOR)
    } catch (e) {
      const msg =
        e instanceof VoiceApiError
          ? typeof e.detail === 'string'
            ? e.detail
            : e.message
          : e instanceof Error
            ? e.message
            : String(e)
      setFormError(msg)
    } finally {
      setBusy(false)
    }
  }, [editor.id, editor.name])

  // -- AI Customizer handlers --------------------------------------------
  const currentForCustomizer = useMemo<Record<string, unknown> | undefined>(
    () =>
      editor.name || editor.description || editor.objective
        ? {
            name: editor.name,
            description: editor.description,
            opening_line: editor.opening_line,
            objective: editor.objective,
            success_criteria: editor.success_criteria,
            tone: editor.tone,
            voice_id: editor.voice_id,
            max_duration_seconds: editor.max_duration_seconds,
            allowed_tools: editor.allowed_tools
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          }
        : undefined,
    [editor],
  )

  const handleAIApply = useCallback((draft: AIScenarioDraft) => {
    setEditor((cur) => aiDraftToEditor(cur, draft))
  }, [])

  // Phase 5: apply a Groq-suggested scenario back to the editor + persist.
  // We map the suggested shape onto the same EditorState the customizer
  // produces (overlay-rich), then PATCH via voiceApi.updateScenario and
  // bounce back to the editor tab so the operator sees the saved result.
  const applySuggestion = useCallback(
    async (suggestion: ScenarioSuggestion) => {
      if (!editor.id) {
        setFormError('Cannot apply a suggestion to an unsaved scenario.')
        return
      }
      const s = suggestion.suggested
      const o =
        s.overlay && typeof s.overlay === 'object'
          ? (s.overlay as Record<string, unknown>)
          : (s as Record<string, unknown>)
      const str = (k: string) =>
        typeof o[k] === 'string' ? (o[k] as string) : ''
      const toolsRaw = Array.isArray(o.allowed_tools)
        ? (o.allowed_tools as Array<unknown>).filter(
            (t): t is string => typeof t === 'string',
          )
        : []
      const dur =
        typeof o.max_duration_seconds === 'number'
          ? (o.max_duration_seconds as number)
          : editor.max_duration_seconds
      const merged: EditorState = {
        ...editor,
        name:
          typeof s.name === 'string' && s.name.trim() ? s.name : editor.name,
        description:
          typeof s.description === 'string'
            ? s.description
            : editor.description,
        voice_id: str('voice_id') || editor.voice_id,
        max_duration_seconds: dur,
        opening_line: str('opening_line') || editor.opening_line,
        objective: str('objective') || editor.objective,
        success_criteria: str('success_criteria') || editor.success_criteria,
        tone: str('tone') || editor.tone,
        allowed_tools:
          toolsRaw.length > 0 ? toolsRaw.join(', ') : editor.allowed_tools,
      }
      setBusy(true)
      setFormError(null)
      try {
        const overlay = editorToOverlay(merged)
        const updated = await voiceApi.updateScenario(editor.id, {
          name: merged.name.trim(),
          description: merged.description.trim() || null,
          overlay,
        })
        setScenarios((all) =>
          all.map((r) => (r.id === updated.id ? updated : r)),
        )
        const next = rowToEditor(updated)
        setEditor(next)
        setPristine(next)
        setRightTab('editor')
      } catch (e) {
        const msg =
          e instanceof VoiceApiError
            ? typeof e.detail === 'string'
              ? e.detail
              : e.message
            : e instanceof Error
              ? e.message
              : String(e)
        setFormError(msg)
      } finally {
        setBusy(false)
      }
    },
    [editor],
  )

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
        onDelete={handleDelete}
        onCustomize={() => setCustomizerOpen(true)}
        canSave={dirty && !busy && editor.name.trim().length > 0}
        canDiscard={dirty && !busy}
        canDelete={editor.id !== null && !busy}
        busy={busy}
      />

      <div
        style={{
          marginTop: 20,
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 320px) 1fr',
          gap: 20,
          alignItems: 'start',
          minHeight: 480,
        }}
      >
        <RailPanel
          scenarios={scenarios}
          selectedId={editor.id}
          loading={listLoading}
          error={listError}
          onSelect={selectScenario}
          onNew={newScenario}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RightPaneTabs
            active={rightTab}
            onChange={setRightTab}
            performanceDisabled={editor.id === null}
          />
          {rightTab === 'editor' ? (
            <EditorPanel
              editor={editor}
              onChange={setEditor}
              error={formError}
              orgResolved={!!orgId}
            />
          ) : (
            <PerformancePanel
              scenarioId={editor.id}
              scenarioName={editor.name}
              onApply={applySuggestion}
              busy={busy}
              error={formError}
            />
          )}
        </div>
      </div>

      {/* AI Customizer side sheet */}
      <AnimatePresence>
        {customizerOpen && (
          <div
            data-voice-hub
            style={{ position: 'fixed', inset: 0, zIndex: 200 }}
            role="dialog"
            aria-modal="true"
            aria-label="AI Customizer"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setCustomizerOpen(false)}
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(7,10,17,0.55)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                cursor: 'pointer',
              }}
            />
            <motion.aside
              initial={{ x: '100%', opacity: 0.6 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0.4 }}
              transition={{
                type: 'spring',
                stiffness: 280,
                damping: 32,
                mass: 1,
              }}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                width: 'min(520px, 100vw)',
                background: 'var(--vh-base)',
                borderLeft: '1px solid var(--vh-glass-border-bright)',
                boxShadow: 'var(--vh-shadow-float)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Suspense
                fallback={
                  <div
                    style={{
                      padding: 24,
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
                  onApply={handleAIApply}
                  onClose={() => setCustomizerOpen(false)}
                />
              </Suspense>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

// -- Subcomponents ----------------------------------------------------------

function Header({
  onSave,
  onDiscard,
  onDelete,
  onCustomize,
  canSave,
  canDiscard,
  canDelete,
  busy,
}: {
  onSave: () => void
  onDiscard: () => void
  onDelete: () => void
  onCustomize: () => void
  canSave: boolean
  canDiscard: boolean
  canDelete: boolean
  busy: boolean
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
          PulseOS · Voice Hub · Scenarios
        </div>
        <h1
          className="font-display mt-1 text-2xl font-bold tracking-tight lg:text-3xl"
          style={{ color: 'var(--vh-text)' }}
        >
          Voice scenarios
        </h1>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onCustomize}
          disabled={busy}
          aria-label="Open AI Customizer"
          style={toolbarBtnStyle('active')}
        >
          Customize with AI
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={!canDiscard}
          aria-label="Discard unsaved changes"
          style={toolbarBtnStyle('ghost', !canDiscard)}
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!canDelete}
          aria-label="Delete this scenario"
          style={toolbarBtnStyle('blocked', !canDelete)}
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          aria-label="Save scenario"
          style={toolbarBtnStyle('compliant', !canSave)}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </header>
  )
}

function RailPanel({
  scenarios,
  selectedId,
  loading,
  error,
  onSelect,
  onNew,
}: {
  scenarios: Array<VoiceScenarioRow>
  selectedId: string | null
  loading: boolean
  error: string | null
  onSelect: (row: VoiceScenarioRow) => void
  onNew: () => void
}) {
  return (
    <aside
      style={{
        borderRadius: 14,
        border: '1px solid var(--vh-glass-border)',
        background: 'var(--vh-glass-bg)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 480,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 4px 8px',
          borderBottom: '1px solid var(--vh-glass-border)',
        }}
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
          Scenarios · {scenarios.length}
        </div>
        <button
          type="button"
          onClick={onNew}
          aria-label="Start a new scenario"
          style={{
            minHeight: 32,
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid var(--vh-active-border)',
            background: 'var(--vh-active-soft)',
            color: 'var(--vh-active)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + New
        </button>
      </div>

      {loading && (
        <div
          className="font-mono"
          style={{
            fontSize: 12,
            color: 'var(--vh-text-muted)',
            padding: 12,
          }}
        >
          Loading scenarios…
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--vh-blocked)',
            padding: 12,
            border: '1px solid var(--vh-blocked-border)',
            background: 'var(--vh-blocked-soft)',
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}
      {!loading && !error && scenarios.length === 0 && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--vh-text-muted)',
            padding: 12,
            lineHeight: 1.5,
          }}
        >
          No scenarios yet. Hit + New to draft one, or Customize with AI to
          generate one from a natural-language brief.
        </div>
      )}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflowY: 'auto',
        }}
      >
        {scenarios.map((row) => {
          const active = row.id === selectedId
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${
                    active
                      ? 'var(--vh-active-border)'
                      : 'var(--vh-glass-border)'
                  }`,
                  background: active
                    ? 'var(--vh-active-soft)'
                    : 'var(--vh-base-elevated)',
                  color: 'var(--vh-text)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minHeight: 44,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: active ? 'var(--vh-active)' : 'var(--vh-text)',
                  }}
                >
                  {row.name || '(untitled)'}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--vh-text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.description || 'No description'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function EditorPanel({
  editor,
  onChange,
  error,
  orgResolved,
}: {
  editor: EditorState
  onChange: (next: EditorState) => void
  error: string | null
  orgResolved: boolean
}) {
  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) =>
    onChange({ ...editor, [k]: v })

  return (
    <section
      style={{
        borderRadius: 14,
        border: '1px solid var(--vh-glass-border)',
        background: 'var(--vh-glass-bg)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
      aria-label="Scenario editor"
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
        {editor.id ? 'Editing scenario' : 'New scenario (unsaved)'}
      </div>

      {!orgResolved && (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 10,
            background: 'var(--vh-warming-soft)',
            border: '1px solid var(--vh-warming-border)',
            color: 'var(--vh-warming)',
            fontSize: 12,
          }}
        >
          No organization resolved -- you can edit, but Save will fail until an
          org is configured.
        </div>
      )}

      <FormField label="Name" htmlFor="sc-name">
        <input
          id="sc-name"
          type="text"
          value={editor.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Pickup confirmation -- friendly"
          style={inputStyle}
          maxLength={120}
        />
      </FormField>

      <FormField label="Description" htmlFor="sc-description">
        <textarea
          id="sc-description"
          value={editor.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Short summary of when / why to use this scenario"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          maxLength={600}
        />
      </FormField>

      <FormField label="Opening line" htmlFor="sc-opening">
        <textarea
          id="sc-opening"
          value={editor.opening_line}
          onChange={(e) => set('opening_line', e.target.value)}
          placeholder="The first thing the agent says when the line connects"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          maxLength={400}
        />
      </FormField>

      <FormField label="Objective" htmlFor="sc-objective">
        <textarea
          id="sc-objective"
          value={editor.objective}
          onChange={(e) => set('objective', e.target.value)}
          placeholder="What must the agent achieve on this call"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          maxLength={400}
        />
      </FormField>

      <FormField label="Success criteria" htmlFor="sc-success">
        <textarea
          id="sc-success"
          value={editor.success_criteria}
          onChange={(e) => set('success_criteria', e.target.value)}
          placeholder="How do we judge whether the call succeeded"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          maxLength={400}
        />
      </FormField>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
        }}
      >
        <FormField label="Tone" htmlFor="sc-tone">
          <input
            id="sc-tone"
            type="text"
            value={editor.tone}
            onChange={(e) => set('tone', e.target.value)}
            placeholder="warm / professional / energetic"
            style={inputStyle}
            maxLength={80}
          />
        </FormField>
        <FormField label="Voice id" htmlFor="sc-voice">
          <input
            id="sc-voice"
            type="text"
            value={editor.voice_id}
            onChange={(e) => set('voice_id', e.target.value)}
            placeholder="e.g. af_heart"
            style={inputStyle}
            maxLength={120}
          />
        </FormField>
        <FormField label="Max duration (sec)" htmlFor="sc-max">
          <input
            id="sc-max"
            type="number"
            min={30}
            max={1800}
            step={30}
            value={editor.max_duration_seconds}
            onChange={(e) =>
              set('max_duration_seconds', Number(e.target.value) || 300)
            }
            style={inputStyle}
          />
        </FormField>
      </div>

      <FormField
        label="Allowed tools (comma-separated)"
        htmlFor="sc-tools"
        hint="Tools the agent may call mid-conversation, e.g. lookup_order, schedule_callback"
      >
        <input
          id="sc-tools"
          type="text"
          value={editor.allowed_tools}
          onChange={(e) => set('allowed_tools', e.target.value)}
          placeholder="lookup_order, schedule_callback"
          style={inputStyle}
        />
      </FormField>

      {error && (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 10,
            background: 'var(--vh-blocked-soft)',
            border: '1px solid var(--vh-blocked-border)',
            color: 'var(--vh-blocked)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </section>
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

// -- Phase 5: right-pane tab strip ------------------------------------------

function RightPaneTabs({
  active,
  onChange,
  performanceDisabled,
}: {
  active: 'editor' | 'performance'
  onChange: (next: 'editor' | 'performance') => void
  performanceDisabled: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label="Scenario right pane"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        borderRadius: 12,
        border: '1px solid var(--vh-glass-border)',
        background: 'var(--vh-base-elevated)',
        alignSelf: 'flex-start',
      }}
    >
      <TabBtn
        active={active === 'editor'}
        onClick={() => onChange('editor')}
        label="Editor"
      />
      <TabBtn
        active={active === 'performance'}
        onClick={() => onChange('performance')}
        label="Performance"
        disabled={performanceDisabled}
        title={
          performanceDisabled
            ? 'Save the scenario first to see performance.'
            : undefined
        }
      />
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  active: boolean
  onClick: () => void
  label: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        minHeight: 32,
        padding: '0 14px',
        borderRadius: 8,
        border: '1px solid transparent',
        background: active ? 'var(--vh-active-soft)' : 'transparent',
        color: active
          ? 'var(--vh-active)'
          : disabled
            ? 'var(--vh-text-faint)'
            : 'var(--vh-text-muted)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.04em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  )
}

// -- Phase 5: PerformancePanel ----------------------------------------------
//
// Right-pane content for the Performance tab. Shows aggregated outcomes for
// the selected scenario + a "Suggest improvements" CTA that POSTs to the
// suggest endpoint, then renders a side-by-side current/suggested JSON diff
// the operator can Apply or Discard.
//
// No chart library -- the bar list is just <div>s with width = % of total.
// Diff is plain side-by-side <pre> blocks (one-line rationale + summary
// above). Apply hands the suggestion back up to the container via onApply,
// which PATCHes via voiceApi.updateScenario and bounces back to the editor.

function PerformancePanel({
  scenarioId,
  scenarioName,
  onApply,
  busy,
  error,
}: {
  scenarioId: string | null
  scenarioName: string
  onApply: (s: ScenarioSuggestion) => Promise<void> | void
  busy: boolean
  error: string | null
}) {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [perf, setPerf] = useState<ScenarioPerformance | null>(null)
  const [perfLoading, setPerfLoading] = useState(false)
  const [perfError, setPerfError] = useState<string | null>(null)

  const [suggestion, setSuggestion] = useState<ScenarioSuggestion | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)

  // Fetch performance on scenario / window change.
  useEffect(() => {
    if (!scenarioId) return
    let cancelled = false
    setPerfLoading(true)
    setPerfError(null)
    setSuggestion(null)
    voiceApi
      .getScenarioPerformance(scenarioId, days)
      .then((p) => {
        if (cancelled) return
        setPerf(p)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg =
          e instanceof VoiceApiError
            ? typeof e.detail === 'string'
              ? e.detail
              : e.message
            : e instanceof Error
              ? e.message
              : String(e)
        setPerfError(msg)
      })
      .finally(() => {
        if (cancelled) return
        setPerfLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scenarioId, days])

  const handleSuggest = useCallback(async () => {
    if (!scenarioId) return
    setSuggestLoading(true)
    setSuggestError(null)
    setSuggestion(null)
    try {
      const s = await voiceApi.suggestScenarioImprovements(scenarioId, {
        days,
        maxTranscriptsPerOutcome: 3,
      })
      setSuggestion(s)
    } catch (e) {
      const msg =
        e instanceof VoiceApiError
          ? typeof e.detail === 'string'
            ? e.detail
            : e.message
          : e instanceof Error
            ? e.message
            : String(e)
      setSuggestError(msg)
    } finally {
      setSuggestLoading(false)
    }
  }, [scenarioId, days])

  if (!scenarioId) {
    return (
      <section
        style={{
          borderRadius: 14,
          border: '1px solid var(--vh-glass-border)',
          background: 'var(--vh-glass-bg)',
          padding: 24,
          color: 'var(--vh-text-muted)',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Save this scenario first to see its call performance.
      </section>
    )
  }

  return (
    <section
      style={{
        borderRadius: 14,
        border: '1px solid var(--vh-glass-border)',
        background: 'var(--vh-glass-bg)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
      aria-label="Scenario performance"
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
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
            Outcome metrics
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--vh-text)',
              marginTop: 2,
            }}
          >
            {scenarioName || '(untitled)'}
          </div>
        </div>
        <WindowSelector
          value={days}
          onChange={setDays}
          disabled={perfLoading}
        />
      </div>

      {perfLoading && (
        <div
          className="font-mono"
          style={{ fontSize: 12, color: 'var(--vh-text-muted)' }}
        >
          Loading metrics…
        </div>
      )}
      {perfError && (
        <div role="alert" style={alertStyle('blocked')}>
          {perfError}
        </div>
      )}
      {!perfLoading && perf && (
        <>
          <SuccessOutcomesHint outcomes={perf.success_outcomes} />
          <BigNumberRow perf={perf} />
          <DeflectionVsFillerSwapNote />
          <OutcomeBars byOutcome={perf.by_outcome} total={perf.total_calls} />
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              alignItems: 'center',
            }}
          >
            {suggestion && (
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                style={toolbarBtnStyle('ghost')}
                disabled={busy || suggestLoading}
              >
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={handleSuggest}
              disabled={suggestLoading || busy || perf.total_calls === 0}
              title={
                perf.total_calls === 0
                  ? 'No calls in window -- nothing to learn from yet.'
                  : undefined
              }
              style={toolbarBtnStyle(
                'active',
                suggestLoading || busy || perf.total_calls === 0,
              )}
            >
              {suggestLoading ? 'Asking Groq…' : 'Suggest improvements'}
            </button>
          </div>
        </>
      )}

      {suggestError && (
        <div role="alert" style={alertStyle('blocked')}>
          {suggestError}
        </div>
      )}

      {suggestion && (
        <SuggestionDiff suggestion={suggestion} onApply={onApply} busy={busy} />
      )}

      {error && (
        <div role="alert" style={alertStyle('blocked')}>
          {error}
        </div>
      )}
    </section>
  )
}

function WindowSelector({
  value,
  onChange,
  disabled,
}: {
  value: 7 | 30 | 90
  onChange: (next: 7 | 30 | 90) => void
  disabled: boolean
}) {
  const opts: Array<7 | 30 | 90> = [7, 30, 90]
  return (
    <div
      role="group"
      aria-label="Time window"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 3,
        borderRadius: 10,
        border: '1px solid var(--vh-glass-border)',
        background: 'var(--vh-base-elevated)',
      }}
    >
      {opts.map((n) => {
        const active = value === n
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            disabled={disabled}
            style={{
              minHeight: 28,
              padding: '0 10px',
              borderRadius: 7,
              border: '1px solid transparent',
              background: active ? 'var(--vh-active-soft)' : 'transparent',
              color: active ? 'var(--vh-active)' : 'var(--vh-text-muted)',
              fontSize: 12,
              fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {n}d
          </button>
        )
      })}
    </div>
  )
}

// Inline note above the success-rate card so the operator knows exactly
// which outcome slugs are being counted as "success" right now (resolved
// per-org by the performance endpoint). Falls back to a no-op when the
// API returns an empty array -- which means "nothing counts as success"
// and the success_rate card is already going to be 0%, so the bar chart
// tells the story.
function SuccessOutcomesHint({ outcomes }: { outcomes: Array<string> }) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return null
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--vh-text-muted)',
        lineHeight: 1.5,
      }}
    >
      Success defined as: {outcomes.join(', ')}.{' '}
      <Link
        to="/voice/settings"
        style={{
          color: 'var(--vh-active)',
          textDecoration: 'underline',
        }}
      >
        Edit in Settings
      </Link>
      .
    </div>
  )
}

function BigNumberRow({ perf }: { perf: ScenarioPerformance }) {
  const successPct = Math.round(perf.success_rate * 100)
  const avgDur =
    perf.avg_duration_seconds >= 60
      ? `${(perf.avg_duration_seconds / 60).toFixed(1)} min`
      : `${perf.avg_duration_seconds.toFixed(0)} s`
  return (
    // 5 cards: auto-fit + minmax lets the row stay one line at wide widths
    // and gracefully wrap (3+2) at narrower viewports — preserves the
    // at-a-glance KPI scan without crushing the deflection / filler-swap
    // pair into illegible slivers.
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12,
      }}
    >
      <BigNumberCard label="Total calls" value={String(perf.total_calls)} />
      <BigNumberCard
        label="Success rate"
        value={perf.total_calls > 0 ? `${successPct}%` : '--'}
      />
      <BigNumberCard
        label="Avg duration"
        value={perf.total_calls > 0 ? avgDur : '--'}
      />
      <BigNumberCard
        label="Deflections"
        value={String(perf.deflection_count)}
        tone={perf.deflection_count > 0 ? 'warming' : 'compliant'}
        caption="Final-turn refusals"
      />
      <BigNumberCard
        label="Filler swaps"
        value={String(perf.filler_swap_count)}
        // Filler swaps are benign hygiene, not a refusal — keep neutral text
        // tone even when nonzero so operators don't confuse it with the
        // deflection signal.
        caption="Pre-tool figure swaps"
      />
    </div>
  )
}

function BigNumberCard({
  label,
  value,
  tone,
  caption,
}: {
  label: string
  value: string
  tone?: 'warming' | 'compliant'
  caption?: string
}) {
  const fg =
    tone === 'warming'
      ? 'var(--vh-warming)'
      : tone === 'compliant'
        ? 'var(--vh-compliant)'
        : 'var(--vh-text)'
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--vh-glass-border)',
        background: 'var(--vh-base-elevated)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vh-text-muted)',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: fg }}>{value}</div>
      {caption && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--vh-text-faint)',
            lineHeight: 1.3,
          }}
        >
          {caption}
        </div>
      )}
    </div>
  )
}

// Distinguishes deflections (real refusal signal) from filler swaps (benign
// pre-tool figure replacement) so operators don't read the two as
// interchangeable. Sits between the BigNumberRow and OutcomeBars.
function DeflectionVsFillerSwapNote() {
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--vh-text-muted)',
        lineHeight: 1.5,
        padding: '8px 12px',
        borderLeft: '2px solid var(--vh-glass-border)',
      }}
    >
      Final-turn refusals signal the faithfulness gate refusing to say the
      number. Pre-tool figure swaps are benign — the model wanted to mention a
      number in the pre-tool filler, the gate replaced it with a neutral phrase,
      and the actual tool call still ran. Track both, but trust the deflection
      count as the real refusal signal.
    </div>
  )
}

function OutcomeBars({
  byOutcome,
  total,
}: {
  byOutcome: Record<string, number>
  total: number
}) {
  // Stable order: largest bucket first so the bar list reads as a histogram.
  const entries = Object.entries(byOutcome).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          border: '1px dashed var(--vh-glass-border)',
          color: 'var(--vh-text-muted)',
          fontSize: 13,
        }}
      >
        No calls in this window yet.
      </div>
    )
  }
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      aria-label="Outcome breakdown"
    >
      {entries.map(([label, count]) => {
        const pct = total > 0 ? (count / total) * 100 : 0
        return (
          <div
            key={label}
            style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--vh-text)',
              }}
            >
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={{ color: 'var(--vh-text-muted)' }}>
                {count} · {pct.toFixed(0)}%
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 8,
                borderRadius: 4,
                background: 'var(--vh-base-elevated)',
                border: '1px solid var(--vh-glass-border)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.max(2, pct)}%`,
                  height: '100%',
                  background:
                    label.toLowerCase() === 'completed' ||
                    label.toLowerCase() === 'success'
                      ? 'var(--vh-compliant)'
                      : label.toLowerCase().includes('refus') ||
                          label.toLowerCase().includes('fail')
                        ? 'var(--vh-blocked)'
                        : 'var(--vh-active)',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SuggestionDiff({
  suggestion,
  onApply,
  busy,
}: {
  suggestion: ScenarioSuggestion
  onApply: (s: ScenarioSuggestion) => Promise<void> | void
  busy: boolean
}) {
  const currentStr = useMemo(
    () => JSON.stringify(suggestion.current, null, 2),
    [suggestion],
  )
  const suggestedStr = useMemo(
    () => JSON.stringify(suggestion.suggested, null, 2),
    [suggestion],
  )
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 12,
        border: '1px solid var(--vh-active-border)',
        background: 'var(--vh-active-soft)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--vh-active)',
          }}
        >
          Why
        </div>
        <div style={{ fontSize: 13, color: 'var(--vh-text)' }}>
          {suggestion.rationale}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--vh-active)',
          }}
        >
          What changed
        </div>
        <div style={{ fontSize: 13, color: 'var(--vh-text)' }}>
          {suggestion.change_summary}
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}
      >
        <DiffColumn title="Current" body={currentStr} />
        <DiffColumn title="Suggested" body={suggestedStr} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => onApply(suggestion)}
          disabled={busy}
          style={toolbarBtnStyle('compliant', busy)}
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
      {!suggestion.transcripts_used && (
        <div
          role="note"
          style={{
            fontSize: 11,
            color: 'var(--vh-text-faint)',
            lineHeight: 1.45,
          }}
        >
          Note: no transcripts were available on the source calls -- the
          suggestion is based on outcome counts only. Once transcripts are
          captured the suggestions get sharper.
        </div>
      )}
    </div>
  )
}

function DiffColumn({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vh-text-muted)',
        }}
      >
        {title}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          borderRadius: 8,
          background: 'var(--vh-base)',
          border: '1px solid var(--vh-glass-border)',
          color: 'var(--vh-text)',
          fontSize: 11,
          lineHeight: 1.4,
          maxHeight: 320,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {body}
      </pre>
    </div>
  )
}

function alertStyle(tone: 'blocked' | 'warming'): CSSProperties {
  if (tone === 'warming') {
    return {
      padding: 10,
      borderRadius: 10,
      background: 'var(--vh-warming-soft)',
      border: '1px solid var(--vh-warming-border)',
      color: 'var(--vh-warming)',
      fontSize: 12,
    }
  }
  return {
    padding: 10,
    borderRadius: 10,
    background: 'var(--vh-blocked-soft)',
    border: '1px solid var(--vh-blocked-border)',
    color: 'var(--vh-blocked)',
    fontSize: 12,
  }
}

// -- Org context hook -- mirrors the one in voice.tsx -----------------------

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

// -- Styles -----------------------------------------------------------------

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
