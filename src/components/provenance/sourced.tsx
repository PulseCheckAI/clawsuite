// ── <Sourced> — provenance-first UI primitive ────────────────────────────────
// Wrap any metric/value so an operator can see WHERE it came from: the exact
// origin (gateway RPC method / SQL view / provider) + freshness, revealed on
// hover/focus. Values not from a verified source render with an [unverified] tag.
// This operationalizes the no-mock / anti-hallucination contract as a visible UI
// feature — the signature PulseOS differentiator. Themed for the navy MC look.
//
// Usage:
//   <Sourced source={{ kind: 'rpc', ref: 'usage.status', freshness: ts }}>
//     {pct}% left
//   </Sourced>
// ─────────────────────────────────────────────────────────────────────────────

import { useId, useState, type ReactNode } from 'react'

export type SourceKind = 'rpc' | 'sql' | 'provider' | 'computed' | 'unverified'

export interface SourceInfo {
  /** Where the value comes from. 'unverified' (or verified:false) flags non-grounded values. */
  kind: SourceKind
  /** The exact origin: RPC method (`usage.status`), SQL view (`gold.fact_pl_periodic`), provider, or derivation. */
  ref: string
  /** When the value was produced/fetched (ISO string, epoch ms, or Date). */
  freshness?: string | number | Date | null
  /** Optional longer detail — the exact query/expression behind the value. */
  detail?: string
  /** Explicitly mark a value as NOT from a verified source. */
  verified?: boolean
}

const KIND_LABEL: Record<SourceKind, string> = {
  rpc: 'Gateway RPC',
  sql: 'Database (SQL)',
  provider: 'Provider',
  computed: 'Computed',
  unverified: 'Unverified',
}

function formatFreshness(f: SourceInfo['freshness']): string | null {
  if (f == null) return null
  const d = f instanceof Date ? f : new Date(f)
  const ms = d.getTime()
  if (Number.isNaN(ms)) return null
  const diff = Date.now() - ms
  if (diff < 0) return d.toLocaleString()
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return d.toLocaleString()
}

export function Sourced({
  children,
  source,
  className,
}: {
  children: ReactNode
  source: SourceInfo
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const unverified = source.kind === 'unverified' || source.verified === false
  const fresh = formatFreshness(source.freshness)

  return (
    <span
      className={`relative inline-flex items-center gap-1 ${className ?? ''}`}
    >
      <span className={unverified ? 'text-amber-300' : undefined}>
        {children}
      </span>
      <button
        type="button"
        aria-label={`Source: ${KIND_LABEL[source.kind]} — ${source.ref}`}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-pointer rounded text-slate-500 transition-colors hover:text-sky-300 focus:text-sky-300 focus:outline-none"
      >
        {unverified ? (
          <span className="text-[10px] font-medium leading-none text-amber-300">
            [unverified]
          </span>
        ) : (
          // small info-circle indicator (SVG, not emoji)
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="inline-block align-text-top"
          >
            <circle
              cx="8"
              cy="8"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <circle cx="8" cy="5" r="0.95" fill="currentColor" />
            <path
              d="M8 7.2v4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-white/10 bg-slate-900/95 p-3 text-left text-xs shadow-xl backdrop-blur"
        >
          <span className="block font-medium text-slate-200">
            {KIND_LABEL[source.kind]}
          </span>
          <span className="mt-1 block break-all font-mono text-[11px] text-slate-400">
            {source.ref}
          </span>
          {fresh && (
            <span className="mt-1 block text-slate-500">as of {fresh}</span>
          )}
          {source.detail && (
            <span className="mt-1 block break-all font-mono text-[10px] text-slate-500">
              {source.detail}
            </span>
          )}
          {unverified && (
            <span className="mt-1 block text-amber-300">
              Not from a verified source.
            </span>
          )}
        </span>
      )}
    </span>
  )
}
