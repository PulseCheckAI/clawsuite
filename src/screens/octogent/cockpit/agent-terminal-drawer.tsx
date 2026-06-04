/**
 * AgentTerminalDrawer — right-side Liquid Glass drawer for a single Octogent
 * terminal. Opened with a terminalId (kind:'octogent' pucks only — gateway and
 * cron pucks have no octogent terminalId and never open this drawer).
 *
 * Live stream: useOctogentTerminalStream(terminalId) over the per-terminal WS.
 * Controls (all real, octogent-namespace contracts via octogent-api.ts):
 *   Stop  → stopTerminal(id)  → POST /octogent/api/terminals/:id/stop
 *   Kill  → killTerminal(id)  → POST /octogent/api/terminals/:id/kill
 *   Steer → sendChannelMessage(id, content) → POST /octogent/api/channels/:id/messages
 *           Labeled "delivered when agent next idle" because the upstream only
 *           delivers channel messages when the target is idle (no fake "sent").
 *
 * These do NOT call gateway-api.ts steerAgent/killAgentSession — those expect a
 * conductor sessionKey, a different namespace (see fake_to_avoid).
 *
 * After stop/kill/steer, invalidates ['octogent','agents'] so the floor + lists
 * refresh.
 */
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOctogentTerminalStream } from '@/hooks/use-octogent-terminal-stream'
import {
  killTerminal,
  sendChannelMessage,
  stopTerminal,
} from '@/lib/octogent-api'
import { cn } from '@/lib/utils'

const CYAN = '#00E5FF'
const ROSE = '#FF6B8B'
const EMERALD = '#3DF5A1'
const AMBER = '#FFB547'
const TEXT = '#E6F1FF'
const DIM = '#8FA3BF'
const DIMMER = '#7A8FA8'

function glass(accent: string, strong = false): CSSProperties {
  return {
    background: 'rgba(13, 19, 29, 0.55)',
    backdropFilter: 'blur(22px) saturate(180%)',
    WebkitBackdropFilter: 'blur(22px) saturate(180%)',
    border: `1px solid ${strong ? accent : 'rgba(255,255,255,0.12)'}`,
    boxShadow: `0 16px 50px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.30), inset 0 -2px 8px rgba(0,0,0,0.30)${strong ? `, 0 0 36px -6px ${accent}` : ''}`,
  }
}

export function AgentTerminalDrawer({
  terminalId,
  label,
  lifecycleState,
  onClose,
}: {
  terminalId: string
  label: string
  lifecycleState?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const stream = useOctogentTerminalStream(terminalId)
  const [busy, setBusy] = useState<null | 'stop' | 'kill'>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [steerMsg, setSteerMsg] = useState('')
  const [steerPending, setSteerPending] = useState(false)
  const [steerNote, setSteerNote] = useState<string | null>(null)
  const outputRef = useRef<HTMLPreElement | null>(null)

  // Auto-scroll the output pane to the bottom as new frames arrive, unless the
  // user scrolled up.
  useEffect(() => {
    const el = outputRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [stream.output])

  async function runAction(kind: 'stop' | 'kill') {
    setBusy(kind)
    setActionError(null)
    try {
      if (kind === 'stop') await stopTerminal(terminalId)
      else await killTerminal(terminalId)
      void qc.invalidateQueries({ queryKey: ['octogent', 'agents'] })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function steer() {
    const content = steerMsg.trim()
    if (!content || steerPending) return
    setSteerPending(true)
    setSteerNote(null)
    setActionError(null)
    try {
      await sendChannelMessage(terminalId, content)
      setSteerMsg('')
      setSteerNote('Queued — delivered when the agent is next idle.')
      void qc.invalidateQueries({ queryKey: ['octogent', 'agents'] })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSteerPending(false)
    }
  }

  const stateColor =
    lifecycleState === 'running'
      ? EMERALD
      : lifecycleState === 'stale'
        ? AMBER
        : DIM

  return (
    <div
      className="absolute inset-y-0 right-0 z-40 flex w-[420px] max-w-[92vw] flex-col rounded-l-2xl p-4"
      role="dialog"
      aria-label={`Agent terminal ${label}`}
      style={{ ...glass(CYAN, true), color: TEXT }}
    >
      {/* header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="truncate font-mono text-[12px] font-semibold"
            style={{ color: TEXT }}
            title={label}
          >
            {label}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: stateColor }}
            />
            <span
              className="font-mono text-[9px] uppercase tracking-wider"
              style={{ color: DIMMER }}
            >
              {lifecycleState ?? 'unknown'} ·{' '}
              {stream.connected ? 'stream live' : 'stream offline'}
              {stream.lastState ? ` · ${stream.lastState}` : ''}
            </span>
          </div>
          <div
            className="mt-0.5 truncate font-mono text-[8px] uppercase tracking-wider"
            style={{ color: DIMMER }}
            title={terminalId}
          >
            terminal {terminalId}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal drawer"
          className="cursor-pointer rounded px-1.5 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
          style={{ color: DIM }}
        >
          ✕
        </button>
      </div>

      {/* live output */}
      <pre
        ref={outputRef}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg px-3 py-2 font-mono text-[10px] leading-relaxed"
        style={{
          background: 'rgba(7,10,17,0.6)',
          border: '1px solid rgba(0, 229, 255, 0.14)',
          color: TEXT,
        }}
        aria-live="polite"
        aria-label="Live terminal output"
      >
        {stream.output ||
          (stream.connected
            ? '— connected, awaiting output —'
            : '— connecting to terminal stream —')}
      </pre>

      {/* steer (channel message, idle-only) */}
      <div className="mt-3">
        <label
          className="font-mono text-[9px] uppercase tracking-wider"
          style={{ color: DIMMER }}
        >
          steer · message
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={steerMsg}
            onChange={(e) => setSteerMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void steer()
              }
            }}
            placeholder="Message to deliver when idle…"
            aria-label="Steer message"
            className="min-w-0 flex-1 rounded-lg px-3 py-1.5 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
            style={{
              background: 'rgba(7,10,17,0.55)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: TEXT,
            }}
          />
          <button
            type="button"
            onClick={() => void steer()}
            disabled={steerPending || steerMsg.trim().length === 0}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]',
              (steerPending || steerMsg.trim().length === 0) &&
                'cursor-not-allowed opacity-50',
            )}
            style={{
              color: CYAN,
              background: 'rgba(0, 229, 255, 0.12)',
              border: '1px solid rgba(0, 229, 255, 0.32)',
            }}
          >
            {steerPending ? '…' : 'Send'}
          </button>
        </div>
        <div
          className="mt-1 font-mono text-[8px] uppercase tracking-wider"
          style={{ color: DIMMER }}
        >
          delivered when agent next idle
        </div>
        {steerNote && (
          <div
            className="mt-1 font-mono text-[10px]"
            style={{ color: EMERALD }}
          >
            {steerNote}
          </div>
        )}
      </div>

      {/* stop / kill */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runAction('stop')}
          disabled={busy !== null}
          className={cn(
            'flex-1 cursor-pointer rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB547]',
            busy !== null && 'cursor-not-allowed opacity-50',
          )}
          style={{
            color: AMBER,
            background: 'rgba(255, 181, 71, 0.10)',
            border: '1px solid rgba(255, 181, 71, 0.32)',
          }}
        >
          {busy === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
        <button
          type="button"
          onClick={() => void runAction('kill')}
          disabled={busy !== null}
          className={cn(
            'flex-1 cursor-pointer rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B8B]',
            busy !== null && 'cursor-not-allowed opacity-50',
          )}
          style={{
            color: ROSE,
            background: 'rgba(255, 107, 139, 0.10)',
            border: '1px solid rgba(255, 107, 139, 0.32)',
          }}
        >
          {busy === 'kill' ? 'Killing…' : 'Kill'}
        </button>
      </div>

      {actionError && (
        <div
          className="mt-2 rounded-lg px-3 py-2 font-mono text-[10px]"
          style={{ ...glass(ROSE), color: ROSE }}
          aria-live="polite"
        >
          {actionError}
        </div>
      )}
    </div>
  )
}
