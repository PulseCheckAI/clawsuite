// ── System > Gateway RPC Console (read-only) ─────────────────────────────────
// Inspect the live OpenClaw Gateway via its WebSocket RPC catalog — read-only
// methods only (the /api/gateway/rpc backend allowlists them). Every result is
// tagged with <Sourced> provenance (the exact RPC method + timestamp), making the
// "every number is click-to-source" principle concrete. Themed for the navy MC look.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { Sourced } from '@/components/provenance/sourced'

interface RpcResult {
  method: string
  ts: number
  result: unknown
}

function Panel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

export function RpcConsoleScreen() {
  const [methods, setMethods] = useState<string[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<RpcResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/gateway/rpc')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d.ok) setMethods(d.methods as string[])
        else setError(d.error || 'Failed to load methods')
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const call = useCallback(async (method: string) => {
    setBusy(method)
    setActive(method)
    setError(null)
    try {
      const r = await fetch('/api/gateway/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) {
        setError(d.error || `Failed (${r.status})`)
        setResult(null)
      } else {
        setResult({ method: d.method, ts: d.ts, result: d.result })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setBusy(null)
    }
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-100">
          Gateway RPC Console
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Read-only inspection of the live OpenClaw gateway. Results are
          source-tagged.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* Method list */}
        <Panel className="overflow-y-auto">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Methods
          </h2>
          {!methods && !error ? (
            <div className="space-y-1.5" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-7 animate-pulse rounded bg-white/[0.04]"
                />
              ))}
            </div>
          ) : !methods ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : (
            <ul className="space-y-0.5">
              {methods.map((m) => (
                <li key={m}>
                  <button
                    type="button"
                    onClick={() => void call(m)}
                    disabled={busy === m}
                    className={`w-full cursor-pointer truncate rounded px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                      active === m
                        ? 'bg-sky-500/15 text-sky-200'
                        : 'text-slate-300 hover:bg-white/[0.05]'
                    } disabled:opacity-50`}
                  >
                    {busy === m ? `${m} …` : m}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Result */}
        <Panel className="flex min-h-0 flex-col">
          {error && active ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : !result ? (
            <p className="m-auto text-sm text-slate-500">
              Select a method to call the gateway.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 text-sm text-slate-300">
                <Sourced
                  source={{
                    kind: 'rpc',
                    ref: result.method,
                    freshness: result.ts,
                  }}
                >
                  <span className="font-mono text-sky-200">
                    {result.method}
                  </span>
                </Sourced>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {JSON.stringify(result.result, null, 2)}
              </pre>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
