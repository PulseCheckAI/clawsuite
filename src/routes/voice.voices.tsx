// /voice/voices -- Voice library + cloner (Phase 4)
// ---------------------------------------------------------------------------
// Three-pane layout matching /voice/agents:
//   - Left rail   : voice_library rows (cloned voices for this org)
//   - Right pane  : metadata view for the selected row (read-only for now;
//                   Phase 4.1 will add rename/edit/delete)
//   - Top toolbar : "Add new voice" -> opens an upload sheet
//
// Upload sheet posts multipart/form-data to /api/voice-engine/voices/clone,
// shows progress, and on success appends the new row to the rail in-place +
// surfaces a "Test playback" button that streams audio from
// /api/voice-engine/voices/:id/preview.
//
// SSR off + voice-hub tokens side-effect import, same as /voice/agents.

import { createFileRoute } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ErrorBoundary } from '@/components/error-boundary'
import { usePageTitle } from '@/hooks/use-page-title'
import type {
  ClonedVoiceRow,
  ListVoicesResponse,
  VoiceLibraryRow,
} from '@/lib/voice-api'
import { VoiceApiError, voiceApi } from '@/lib/voice-api'
import '@/styles/voice-hub-tokens.css'

// -- Route ------------------------------------------------------------------

export const Route = createFileRoute('/voice/voices')({
  ssr: false,
  component: function VoiceVoicesRoute() {
    usePageTitle('Voice Library')
    return (
      <ErrorBoundary
        title="Voice library error"
        description="Failed to load the voice library. Try reloading."
      >
        <VoicesContainer />
      </ErrorBoundary>
    )
  },
})

// -- Container --------------------------------------------------------------

function VoicesContainer() {
  const { orgId, ctxError } = useVoiceContext()
  const [list, setList] = useState<ListVoicesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const reload = useCallback(() => {
    if (orgId === undefined) return
    setLoading(true)
    setListError(null)
    voiceApi
      .listVoices(orgId ?? undefined)
      .then((res) => {
        setList(res)
        if (res.cloned.length > 0 && selectedId === null) {
          setSelectedId(res.cloned[0].id)
        }
      })
      .catch((e: unknown) => {
        setListError(toErrorMessage(e))
      })
      .finally(() => setLoading(false))
  }, [orgId, selectedId])

  useEffect(() => {
    if (orgId === undefined) return
    let cancelled = false
    setLoading(true)
    setListError(null)
    voiceApi
      .listVoices(orgId ?? undefined)
      .then((res) => {
        if (cancelled) return
        setList(res)
        if (res.cloned.length > 0) setSelectedId(res.cloned[0].id)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setListError(toErrorMessage(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const selected = useMemo<ClonedVoiceRow | null>(() => {
    if (!list || selectedId === null) return null
    return list.cloned.find((r) => r.id === selectedId) ?? null
  }, [list, selectedId])

  const handleCloned = useCallback((row: VoiceLibraryRow) => {
    setList((cur) => {
      if (!cur) return cur
      // The new row uses VoiceLibraryRow shape (source_audio_url or
      // source_path); cast onto ClonedVoiceRow for the local picker.
      const cloned: ClonedVoiceRow = {
        id: row.id,
        organization_id: row.organization_id,
        display_name: row.display_name,
        source_path: row.source_path || row.source_audio_url || '',
        consent_recorded_at: row.consent_recorded_at,
        created_at: row.created_at,
      }
      return { ...cur, cloned: [cloned, ...cur.cloned] }
    })
    setSelectedId(row.id)
    setSheetOpen(false)
  }, [])

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
        onAddNew={() => setSheetOpen(true)}
        onReload={reload}
        loading={loading}
      />

      <div
        style={{
          marginTop: 20,
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 340px) 1fr',
          gap: 20,
          alignItems: 'start',
          minHeight: 480,
        }}
      >
        <RailPanel
          list={list}
          selectedId={selectedId}
          loading={loading}
          error={listError}
          onSelect={setSelectedId}
        />
        <DetailPanel orgResolved={!!orgId} selected={selected} />
      </div>

      {/* Upload sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <UploadSheet
            onClose={() => setSheetOpen(false)}
            onCloned={handleCloned}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// -- Header -----------------------------------------------------------------

function Header({
  onAddNew,
  onReload,
  loading,
}: {
  onAddNew: () => void
  onReload: () => void
  loading: boolean
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[color:var(--vh-text-muted)] uppercase">
          PulseOS · Voice Hub · Voices
        </div>
        <h1
          className="font-display mt-1 text-2xl font-bold tracking-tight lg:text-3xl"
          style={{ color: 'var(--vh-text)' }}
        >
          Voice library
        </h1>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          aria-label="Reload voice library"
          style={toolbarBtnStyle('ghost', loading)}
        >
          {loading ? 'Reloading…' : 'Reload'}
        </button>
        <button
          type="button"
          onClick={onAddNew}
          aria-label="Add a new voice (open upload sheet)"
          style={toolbarBtnStyle('active')}
        >
          + Add new voice
        </button>
      </div>
    </header>
  )
}

// -- Rail -------------------------------------------------------------------

function RailPanel({
  list,
  selectedId,
  loading,
  error,
  onSelect,
}: {
  list: ListVoicesResponse | null
  selectedId: string | null
  loading: boolean
  error: string | null
  onSelect: (id: string) => void
}) {
  const cloned = list?.cloned ?? []
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
          Cloned voices · {cloned.length}
        </div>
      </div>

      {loading && (
        <div
          className="font-mono"
          style={{ fontSize: 12, color: 'var(--vh-text-muted)', padding: 12 }}
        >
          Loading voices…
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
      {!loading && !error && cloned.length === 0 && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--vh-text-muted)',
            padding: 12,
            lineHeight: 1.5,
          }}
        >
          No cloned voices yet. Hit "Add new voice" to upload a reference
          recording (max 10 MB, WAV preferred).
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
        {cloned.map((row) => {
          const active = row.id === selectedId
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
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
                  minHeight: 48,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: active ? 'var(--vh-active)' : 'var(--vh-text)',
                  }}
                >
                  {row.display_name || '(untitled voice)'}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--vh-text-muted)',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatDate(row.created_at)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

// -- Detail pane ------------------------------------------------------------

function DetailPanel({
  selected,
  orgResolved,
}: {
  selected: ClonedVoiceRow | null
  orgResolved: boolean
}) {
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Revoke the previous blob URL when it changes (avoid memory leak).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // Clear preview when the selected voice changes.
  useEffect(() => {
    setPreviewError(null)
    setPreviewUrl((cur) => {
      if (cur) URL.revokeObjectURL(cur)
      return null
    })
  }, [selected?.id])

  const handlePreview = useCallback(async () => {
    if (!selected) return
    setPreviewBusy(true)
    setPreviewError(null)
    try {
      const blob = await voiceApi.previewVoice(
        selected.id,
        'Hello, this is a test.',
      )
      const url = URL.createObjectURL(blob)
      setPreviewUrl((cur) => {
        if (cur) URL.revokeObjectURL(cur)
        return url
      })
      // Auto-play the freshly minted audio (best-effort; some browsers
      // require a user gesture, and we just got one).
      window.setTimeout(() => {
        audioRef.current?.play().catch(() => {
          // Silent fail -- the user can hit the player's own play button.
        })
      }, 0)
    } catch (e) {
      setPreviewError(toErrorMessage(e))
    } finally {
      setPreviewBusy(false)
    }
  }, [selected])

  if (!selected) {
    return (
      <section
        style={detailShellStyle}
        aria-label="Voice details (none selected)"
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
          No voice selected
        </div>
        <div style={{ color: 'var(--vh-text-muted)', fontSize: 13 }}>
          Pick a voice from the rail to view its metadata, or hit "Add new
          voice" to upload one.
        </div>
      </section>
    )
  }

  return (
    <section style={detailShellStyle} aria-label="Voice details">
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
        Voice details
      </div>

      {!orgResolved && (
        <div role="alert" style={warningRowStyle}>
          No organization resolved -- preview may fail until an org is
          configured.
        </div>
      )}

      <FieldRow label="Display name" value={selected.display_name || '—'} />
      <FieldRow
        label="Voice id (db)"
        value={<code style={codeStyle}>{selected.id}</code>}
      />
      <FieldRow
        label="Reference path"
        value={<code style={codeStyle}>{selected.source_path || '—'}</code>}
      />
      <FieldRow label="Created" value={formatDate(selected.created_at)} />
      <FieldRow
        label="Consent recorded"
        value={formatDate(selected.consent_recorded_at)}
      />

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginTop: 8,
        }}
      >
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewBusy}
          aria-label="Synthesize a short test phrase with this voice"
          style={toolbarBtnStyle('compliant', previewBusy)}
        >
          {previewBusy ? 'Synthesizing…' : 'Test playback'}
        </button>
        {previewUrl && (
          <audio
            ref={audioRef}
            src={previewUrl}
            controls
            style={{ flex: 1, minWidth: 240 }}
          />
        )}
      </div>

      {previewError && (
        <div role="alert" style={errorRowStyle}>
          {previewError}
        </div>
      )}
    </section>
  )
}

// -- Upload sheet -----------------------------------------------------------

const MAX_BYTES = 10 * 1024 * 1024
const NAME_RE = /^[A-Za-z0-9 _-]{2,64}$/
const ALLOWED_EXT_LABEL = '.wav, .mp3'
const ACCEPT_MIME = 'audio/wav,audio/mpeg,audio/mp3,audio/x-wav,.wav,.mp3'

function UploadSheet({
  onClose,
  onCloned,
}: {
  onClose: () => void
  onCloned: (row: VoiceLibraryRow) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<'hume' | 'xtts'>('xtts')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback((f: File | null) => {
    setError(null)
    if (!f) {
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setError(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB, max 10 MB.`)
      setFile(null)
      return
    }
    setFile(f)
  }, [])

  const handleSubmit = useCallback(async () => {
    setError(null)
    const trimmedName = name.trim()
    if (!NAME_RE.test(trimmedName)) {
      setError(
        'Name must be 2-64 chars (letters, digits, space, underscore, dash).',
      )
      return
    }
    if (!file) {
      setError('Pick an audio file (WAV preferred, MP3 for Hume-only).')
      return
    }
    if (provider === 'xtts') {
      const mime = (file.type || '').toLowerCase()
      const isWav =
        mime === 'audio/wav' ||
        mime === 'audio/x-wav' ||
        mime === 'audio/wave' ||
        file.name.toLowerCase().endsWith('.wav')
      if (!isWav) {
        setError('XTTS requires a .wav file -- mp3 is not accepted.')
        return
      }
    }

    const fd = new FormData()
    fd.append('audio', file, file.name)
    fd.append('name', trimmedName)
    fd.append('provider', provider)
    if (description.trim().length > 0) {
      fd.append('description', description.trim())
    }

    setBusy(true)
    try {
      const row = await voiceApi.cloneVoiceMultipart(fd)
      onCloned(row)
    } catch (e) {
      setError(toErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [description, file, name, provider, onCloned])

  return (
    <div
      data-voice-hub
      style={{ position: 'fixed', inset: 0, zIndex: 200 }}
      role="dialog"
      aria-modal="true"
      aria-label="Upload new voice"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={busy ? undefined : onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(7,10,17,0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      />
      <motion.aside
        initial={{ x: '100%', opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0.4 }}
        transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 1 }}
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
          padding: 20,
          gap: 14,
          overflowY: 'auto',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
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
              New voice
            </div>
            <h2
              style={{
                margin: '4px 0 0',
                fontSize: 20,
                fontWeight: 700,
                color: 'var(--vh-text)',
              }}
            >
              Upload reference audio
            </h2>
          </div>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            aria-label="Close upload sheet"
            style={{
              minWidth: 36,
              minHeight: 36,
              borderRadius: 8,
              border: '1px solid var(--vh-glass-border)',
              background: 'transparent',
              color: 'var(--vh-text-muted)',
              fontSize: 18,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            x
          </button>
        </header>

        <FormField label="Name" htmlFor="up-name">
          <input
            id="up-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sam reference voice"
            maxLength={64}
            disabled={busy}
            style={inputStyle}
          />
        </FormField>

        <FormField
          label="Description"
          htmlFor="up-desc"
          hint="Optional, e.g. recorded 2026-05-22, consent on file"
        >
          <textarea
            id="up-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={600}
            disabled={busy}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </FormField>

        <FormField label="Provider" htmlFor="up-provider">
          <div
            role="radiogroup"
            aria-label="Voice cloning provider"
            style={{ display: 'flex', gap: 8 }}
          >
            <ProviderToggle
              checked={provider === 'xtts'}
              onSelect={() => setProvider('xtts')}
              label="XTTS (cascade)"
              hint="WAV only, runs on the local cascade"
              disabled={busy}
            />
            <ProviderToggle
              checked={false}
              onSelect={() => {
                /* disabled -- Hume cloning routes through the Hume web app */
              }}
              label="Hume"
              hint="Upload at app.hume.ai today — SDK pending."
              disabled
              badge="Web app only"
              tooltip="Use the Hume web app to upload voice samples today — Python SDK audio-upload is pending."
            />
          </div>
        </FormField>

        <FormField
          label={`Audio file (${ALLOWED_EXT_LABEL}, max 10 MB)`}
          htmlFor="up-file"
        >
          <input
            id="up-file"
            type="file"
            accept={ACCEPT_MIME}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            style={{ ...inputStyle, padding: 8 }}
          />
        </FormField>

        {file && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--vh-text-muted)',
              padding: '6px 10px',
              border: '1px solid var(--vh-glass-border)',
              borderRadius: 8,
              background: 'var(--vh-base-elevated)',
            }}
          >
            Picked: <code style={codeStyle}>{file.name}</code> ·{' '}
            {(file.size / 1024).toFixed(1)} KB · {file.type || 'unknown mime'}
          </div>
        )}

        {error && (
          <div role="alert" style={errorRowStyle}>
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 8,
          }}
        >
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            aria-label="Cancel upload"
            style={toolbarBtnStyle('ghost', busy)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !file || !name.trim()}
            aria-label="Upload voice"
            style={toolbarBtnStyle('compliant', busy || !file || !name.trim())}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </motion.aside>
    </div>
  )
}

function ProviderToggle({
  checked,
  onSelect,
  label,
  hint,
  disabled,
  badge,
  tooltip,
}: {
  checked: boolean
  onSelect: () => void
  label: string
  hint: string
  disabled: boolean
  badge?: string
  tooltip?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      title={tooltip}
      style={{
        flex: 1,
        minHeight: 56,
        padding: '8px 12px',
        borderRadius: 10,
        border: `1px solid ${checked ? 'var(--vh-active-border)' : 'var(--vh-glass-border)'}`,
        background: checked
          ? 'var(--vh-active-soft)'
          : 'var(--vh-base-elevated)',
        color: 'var(--vh-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: 13,
          color: checked ? 'var(--vh-active)' : 'var(--vh-text)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <span>{label}</span>
        {badge && (
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: 999,
              border: '1px solid var(--vh-glass-border-bright)',
              background: 'var(--vh-base-elevated)',
              color: 'var(--vh-text-muted)',
            }}
          >
            {badge}
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: 'var(--vh-text-faint)' }}>
        {hint}
      </span>
    </button>
  )
}

// -- Tiny helpers -----------------------------------------------------------

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 12,
        alignItems: 'baseline',
        padding: '6px 0',
        borderBottom: '1px solid var(--vh-glass-border)',
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
      <div style={{ fontSize: 13, color: 'var(--vh-text)' }}>{value}</div>
    </div>
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

function toErrorMessage(e: unknown): string {
  if (e instanceof VoiceApiError) {
    if (typeof e.detail === 'string' && e.detail.length > 0) return e.detail
    return e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

// -- Org context hook -- mirrors the one in voice.agents.tsx ----------------

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

const codeStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  color: 'var(--vh-text)',
  background: 'var(--vh-base-elevated)',
  padding: '1px 6px',
  borderRadius: 6,
  border: '1px solid var(--vh-glass-border)',
  wordBreak: 'break-all',
}

const detailShellStyle: CSSProperties = {
  borderRadius: 14,
  border: '1px solid var(--vh-glass-border)',
  background: 'var(--vh-glass-bg)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
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
