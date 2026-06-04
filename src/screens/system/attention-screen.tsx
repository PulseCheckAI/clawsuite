// ── Needs You Now — attention queue (headline) ───────────────────────────────
// The attention-inversion surface: a single AI-ranked feed of what needs the
// operator NOW, aggregated across modules by /api/attention. Each item is
// source-tagged (<Sourced>) and drills into the relevant module. Auto-refreshes.
// Themed for the navy MC look; honest "all clear" empty state.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Sourced } from '@/components/provenance/sourced'

type Severity = 'critical' | 'warn' | 'info'

interface Item {
  id: string
  severity: Severity
  title: string
  detail?: string
  source: string
  to?: string
}

const ACCENT: Record<Severity, { dot: string; border: string; label: string }> =
  {
    critical: {
      dot: 'bg-rose-400',
      border: 'border-rose-400/30',
      label: 'text-rose-300',
    },
    warn: {
      dot: 'bg-amber-300',
      border: 'border-amber-300/30',
      label: 'text-amber-200',
    },
    info: {
      dot: 'bg-slate-500',
      border: 'border-white/10',
      label: 'text-slate-300',
    },
  }

export function AttentionScreen() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Item[] | null>(null)
  const [ts, setTs] = useState<number>(Date.now())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/attention')
      const d = await r.json()
      if (d.ok) {
        setItems(d.items as Item[])
        setTs(d.ts as number)
        setError(null)
      } else {
        setError(d.error || 'Failed to load')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 30_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            Needs You Now
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Ranked across every module — the system surfaces what matters so you
            don&apos;t have to hunt for it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="cursor-pointer text-xs text-slate-400 transition-colors hover:text-slate-200"
        >
          Refresh
        </button>
      </header>

      <div className="max-w-3xl space-y-2">
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-white/[0.04]"
              />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : !items || items.length === 0 ? (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-6 text-center">
            <p className="text-sm font-medium text-emerald-300">All clear</p>
            <p className="mt-1 text-xs text-slate-400">
              Nothing needs your attention right now.
            </p>
          </div>
        ) : (
          items.map((it) => {
            const a = ACCENT[it.severity]
            const clickable = Boolean(it.to)
            return (
              <div
                key={it.id}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={
                  clickable ? () => void navigate({ to: it.to! }) : undefined
                }
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter') void navigate({ to: it.to! })
                      }
                    : undefined
                }
                className={`rounded-xl border ${a.border} bg-white/[0.03] p-4 transition-colors ${
                  clickable ? 'cursor-pointer hover:bg-white/[0.05]' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.dot}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-100">
                        {it.title}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide ${a.label}`}
                      >
                        {it.severity}
                      </span>
                    </div>
                    {it.detail && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {it.detail}
                      </p>
                    )}
                    <div className="mt-1.5 text-[11px] text-slate-500">
                      <Sourced
                        source={{ kind: 'rpc', ref: it.source, freshness: ts }}
                      >
                        <span>source</span>
                      </Sourced>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
