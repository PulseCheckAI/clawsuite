// ── System > Security & Exposure ─────────────────────────────────────────────
// Live exposure posture for the dashboard — most importantly whether auth is
// BYPASSED (every route public). Fast in-process signals from /api/security/posture,
// rendered as severity rows with <Sourced> provenance. Themed for the navy MC look.
// (A deeper, async `openclaw security audit` checkId view is a future enhancement.)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { Sourced } from '@/components/provenance/sourced'

interface Posture {
  nodeEnv: string
  passwordProtection: boolean
  authBypassed: boolean
  multiUser: boolean
  allowedOrigins: string | null
}

type Sev = 'critical' | 'warn' | 'ok' | 'info'

const SEV_TEXT: Record<Sev, string> = {
  critical: 'text-rose-400',
  warn: 'text-amber-300',
  ok: 'text-emerald-300',
  info: 'text-slate-400',
}
const SEV_DOT: Record<Sev, string> = {
  critical: 'bg-rose-400',
  warn: 'bg-amber-300',
  ok: 'bg-emerald-400',
  info: 'bg-slate-500',
}

interface RowDef {
  label: string
  value: string
  sev: Sev
  hint?: string
}

function rowsFor(p: Posture): RowDef[] {
  return [
    {
      label: 'Authentication',
      value: p.authBypassed ? 'BYPASSED — every route is public' : 'Required',
      sev: p.authBypassed ? 'critical' : 'ok',
      hint: p.authBypassed
        ? 'No CLAWSUITE_PASSWORD set. Set it (and/or enable multi-user) before exposing.'
        : undefined,
    },
    {
      label: 'Environment',
      value: p.nodeEnv,
      sev: p.nodeEnv === 'production' ? 'ok' : 'warn',
      hint:
        p.nodeEnv === 'production'
          ? undefined
          : 'Dev mode — switch to the prod build before going online (see DEPLOY-CUTOVER.md).',
    },
    {
      label: 'Multi-user accounts',
      value: p.multiUser ? 'enabled' : 'disabled (single password)',
      sev: 'info',
    },
    {
      label: 'Allowed origins',
      value: p.allowedOrigins ?? 'not set',
      sev: p.allowedOrigins ? 'ok' : 'info',
    },
  ]
}

export function SecurityScreen() {
  const [posture, setPosture] = useState<Posture | null>(null)
  const [ts, setTs] = useState<number>(Date.now())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/security/posture')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d.ok) {
          setPosture(d.posture as Posture)
          setTs(d.ts as number)
        } else {
          setError(d.error || 'Failed to load posture')
        }
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const rows = posture ? rowsFor(posture) : []
  const critical = rows.filter((r) => r.sev === 'critical').length
  const warn = rows.filter((r) => r.sev === 'warn').length

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">
          Security &amp; Exposure
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Live exposure posture for this dashboard. Fix criticals before putting
          it on the internet.
        </p>
      </header>

      <div className="max-w-2xl rounded-xl border border-white/10 bg-white/[0.03] p-5">
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-white/[0.04]"
              />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span
                className={
                  critical > 0
                    ? 'text-rose-400'
                    : warn > 0
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                }
              >
                {critical > 0
                  ? `${critical} critical`
                  : warn > 0
                    ? `${warn} warning${warn > 1 ? 's' : ''}`
                    : 'No exposure issues'}
              </span>
            </div>
            <div>
              {rows.map((r) => (
                <div
                  key={r.label}
                  className="border-t border-white/5 py-3 first:border-t-0"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[r.sev]}`}
                      />
                      <span className="text-sm text-slate-300">{r.label}</span>
                    </div>
                    <Sourced
                      source={{
                        kind: 'rpc',
                        ref: '/api/security/posture',
                        freshness: ts,
                      }}
                    >
                      <span className={`text-sm ${SEV_TEXT[r.sev]}`}>
                        {r.value}
                      </span>
                    </Sourced>
                  </div>
                  {r.hint && (
                    <p className="ml-[18px] mt-1 text-xs text-slate-500">
                      {r.hint}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
