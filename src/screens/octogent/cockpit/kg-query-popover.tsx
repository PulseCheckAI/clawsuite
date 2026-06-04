/**
 * KgQueryPopover — inline read-only query box for the Knowledge Graph anchor.
 *
 * Real contract: POST /api/intel/ask { q, mode } (src/routes/api/intel/ask.ts),
 * auth-gated, returns { ok, query, mode, answer }. Backed by askKnowledge() →
 * LightRAG POST /query. This is strictly a READ path — there is NO write-back
 * mechanism, so this component never animates a "write pulse" and never claims
 * to mutate the graph (see fake_to_avoid).
 *
 * Degraded mode: if useLightragStatus().healthy === false, submit is disabled
 * and we surface the health payload (status / pipeline_busy) instead of faking
 * an answer. Per-document status counts are MCP-only (not on the HTTP proxy),
 * so we deliberately do NOT show doc counts — health payload only.
 *
 * Liquid Glass theme matches engine-floor-live.tsx tokens.
 */
import { type CSSProperties, useState } from 'react'
import { useLightragStatus } from '@/hooks/use-lightrag-status'
import { cn } from '@/lib/utils'

const CYAN = '#00E5FF'
const ROSE = '#FF6B8B'
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

const MODES = ['hybrid', 'mix', 'local', 'global', 'naive'] as const
type Mode = (typeof MODES)[number]

type AskResponse = {
  ok?: boolean
  query?: string
  mode?: string
  answer?: string
  error?: string
}

export function KgQueryPopover({ onClose }: { onClose: () => void }) {
  const lightrag = useLightragStatus()
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<Mode>('hybrid')
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const canSubmit = lightrag.healthy && q.trim().length > 0 && !pending

  async function submit() {
    const query = q.trim()
    if (!query || !lightrag.healthy) return
    setPending(true)
    setError(null)
    setAnswer(null)
    try {
      const res = await fetch('/api/intel/ask', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query, mode }),
      })
      const payload = (await res.json().catch(() => ({}))) as AskResponse
      if (!res.ok || payload.ok === false) {
        setError(payload.error || `Query failed (${res.status})`)
        return
      }
      setAnswer(
        payload.answer && payload.answer.trim()
          ? payload.answer
          : '(empty answer)',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="absolute z-30 w-[360px] max-w-[88vw] rounded-2xl p-4"
      role="dialog"
      aria-label="Knowledge Graph query"
      style={{
        left: '50%',
        top: '24%',
        transform: 'translateX(-50%)',
        ...glass(CYAN, true),
        color: TEXT,
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: CYAN }}
        >
          Knowledge Graph · query
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close query box"
          className="cursor-pointer rounded px-1.5 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
          style={{ color: DIM }}
        >
          ✕
        </button>
      </div>

      {!lightrag.healthy ? (
        <div
          className="rounded-lg px-3 py-2 font-mono text-[11px]"
          style={{ ...glass(ROSE), color: ROSE }}
          aria-live="polite"
        >
          LightRAG unavailable — read query disabled.
          <div className="mt-1 text-[10px]" style={{ color: DIMMER }}>
            status: {lightrag.payload?.status ?? 'unknown'}
            {lightrag.payload?.pipeline_busy ? ' · pipeline busy' : ''}
          </div>
        </div>
      ) : (
        <>
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            rows={3}
            placeholder="Ask the knowledge graph…"
            aria-label="Knowledge graph question"
            className="w-full resize-none rounded-lg px-3 py-2 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
            style={{
              background: 'rgba(7,10,17,0.55)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: TEXT,
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <label
              className="font-mono text-[10px] uppercase tracking-wider"
              style={{ color: DIMMER }}
            >
              mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              aria-label="Query mode"
              className="cursor-pointer rounded px-2 py-1 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
              style={{
                background: 'rgba(7,10,17,0.7)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: TEXT,
              }}
            >
              {MODES.map((m) => (
                <option key={m} value={m} style={{ background: '#0D131D' }}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className={cn(
                'ml-auto cursor-pointer rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]',
                !canSubmit && 'cursor-not-allowed opacity-50',
              )}
              style={{
                color: canSubmit ? CYAN : DIMMER,
                background: canSubmit
                  ? 'rgba(0, 229, 255, 0.12)'
                  : 'transparent',
                border: `1px solid ${canSubmit ? 'rgba(0, 229, 255, 0.32)' : 'rgba(255,255,255,0.10)'}`,
              }}
            >
              {pending ? 'Querying…' : 'Ask'}
            </button>
          </div>
          {lightrag.payload?.pipeline_busy && (
            <div
              className="mt-2 font-mono text-[10px]"
              style={{ color: AMBER }}
            >
              pipeline busy — ingestion in progress, answers may lag
            </div>
          )}
        </>
      )}

      {error && (
        <div
          className="mt-3 rounded-lg px-3 py-2 font-mono text-[11px]"
          style={{ ...glass(ROSE), color: ROSE }}
          aria-live="polite"
        >
          {error}
        </div>
      )}

      {answer && (
        <div
          className="mt-3 max-h-[240px] overflow-y-auto whitespace-pre-wrap rounded-lg px-3 py-2 font-mono text-[11px] leading-relaxed"
          style={{
            background: 'rgba(7,10,17,0.55)',
            border: '1px solid rgba(0, 229, 255, 0.18)',
            color: TEXT,
          }}
          aria-live="polite"
        >
          {answer}
        </div>
      )}
    </div>
  )
}
