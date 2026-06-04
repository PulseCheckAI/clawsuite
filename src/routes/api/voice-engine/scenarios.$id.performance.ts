// -- /api/voice-engine/scenarios/$id/performance ----------------------------
// Phase 5: outcome aggregation for a single voice scenario.
//
// GET ?days=30 (1..90) -> {
//   scenario_id, window_days, total_calls,
//   by_outcome: Record<string,number>,
//   success_rate: 0..1, avg_duration_seconds, median_duration_seconds,
//   deflection_count, filler_swap_count, last_updated
// }
//
// deflection_count vs filler_swap_count — these are SEPARATE signals; we do
// not collapse them. deflection_count counts final-turn refusals (the
// faithfulness gate refused to say the number). filler_swap_count counts
// pre-tool figure swaps (the gate replaced a number in the pre-tool filler
// with a neutral phrase, but the actual tool call still ran). Trust
// deflection_count as the real refusal signal; filler_swap_count is benign
// hygiene we track to know how often the model wants to pre-state numbers.
//
// Why we proxy /api/calls (not hit Supabase directly): every other voice
// surface in this dashboard talks to voice-engine, which owns the RLS-safe
// org context + HMAC plumbing. Hitting Supabase here would bypass that and
// would need its own service-role key wiring (which dashboard does not have
// today for the voice schema). The voice-engine /api/calls endpoint already
// returns the rows we need, just unfiltered by scenario; we paginate + filter
// in this handler.
//
// Volume sanity: at 200/page * 3 pages = 600 calls per window. A scenario
// firing >600 times in 90 days is a power-user case worth a dedicated SQL
// path; until then this is plenty for the loop.
// ---------------------------------------------------------------------------

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  forwardToVoiceEngine,
  getServerOrgId,
  isVoiceEngineReady,
} from '@/server/voice-engine'

// Outcomes that count as "success" when the org hasn't set a per-org list.
// Conservative defaults; the operator can override via
// organizations.voice_config.success_outcomes (string[]) on the Settings page.
// Resolution order at request time:
//   org.voice_config.success_outcomes  (non-empty string[]; lowercased)
//   → DEFAULT_SUCCESS_OUTCOMES         (this constant; preserves Phase-5 behavior)
const DEFAULT_SUCCESS_OUTCOMES: ReadonlyArray<string> = [
  'completed',
  'success',
  'booked',
]

// Matches the same slug regex the Settings page validates on save.
const OUTCOME_SLUG_RE = /^[a-z0-9_]{1,32}$/

/** Pull voice_config.success_outcomes off the org via the engine proxy.
 * Returns the picked allowlist + a normalized array of the strings we'll
 * echo back to the UI. Falls back silently on any error / malformed shape —
 * we never want a misconfigured jsonb to 500 the performance panel. */
async function resolveSuccessOutcomes(): Promise<{
  allowlist: Set<string>
  outcomes: Array<string>
}> {
  const fallback = (): { allowlist: Set<string>; outcomes: Array<string> } => ({
    allowlist: new Set<string>(DEFAULT_SUCCESS_OUTCOMES),
    outcomes: [...DEFAULT_SUCCESS_OUTCOMES],
  })
  const orgId = getServerOrgId()
  if (!orgId) return fallback()
  try {
    const res = await forwardToVoiceEngine({
      path: `/api/org/${encodeURIComponent(orgId)}/voice-config`,
      method: 'GET',
      timeoutMs: 5_000,
    })
    if (res.status >= 400) return fallback()
    const body = res.body as { voice_config?: unknown } | null
    const cfg = body?.voice_config
    if (!cfg || typeof cfg !== 'object') return fallback()
    const raw = (cfg as Record<string, unknown>).success_outcomes
    if (!Array.isArray(raw) || raw.length === 0) return fallback()
    const cleaned: Array<string> = []
    const seen = new Set<string>()
    for (const v of raw) {
      if (typeof v !== 'string') continue
      const slug = v.trim().toLowerCase()
      if (!OUTCOME_SLUG_RE.test(slug)) continue
      if (seen.has(slug)) continue
      seen.add(slug)
      cleaned.push(slug)
    }
    if (cleaned.length === 0) return fallback()
    return { allowlist: new Set<string>(cleaned), outcomes: cleaned }
  } catch {
    return fallback()
  }
}

// status values we treat as deflections (agent refused to engage). Matches
// the gated_refused path on /api/calls/place + the explicit "refused" status
// from the voice_calls CHECK constraint.
const DEFLECTION_STATUSES = new Set<string>(['refused', 'gated_refused'])

// Hard ceiling on how many call rows we will pull per scenario per window.
// 3 pages * 200 (voice-engine /api/calls max page size) = 600 rows. The
// handler stops fetching once any of: (a) no more rows, (b) we crossed the
// window boundary in created_at, (c) we hit MAX_ROWS.
const PAGE_SIZE = 200
const MAX_PAGES = 3
const MAX_ROWS = PAGE_SIZE * MAX_PAGES

type RawCall = {
  id?: string
  scenario_id?: string | null
  status?: string | null
  outcome?: string | null
  refusal_reason?: string | null
  duration_seconds?: number | string | null
  // voice-engine returns created_at on every voice_calls row even though the
  // table column is `queued_at` -- it aliases in the response shape. We read
  // both and prefer whichever is present.
  created_at?: string | null
  queued_at?: string | null
  // Phase-5.1 hook: voice_calls already has a deflection_count column in
  // some envs; if present we honor it, else fall back to status-based
  // detection (DEFLECTION_STATUSES above).
  deflection_count?: number | null
  // Phase-5.2: separate counter (SEPARATE from deflection_count). Tracks
  // pre-tool filler figure swaps performed by grounding.ground_filler.
  // Column landed on prod in voice-engine commit d215410 (NOT NULL DEFAULT 0).
  // Older rows / older voice-engine builds may omit it -> coalesce to 0
  // downstream so the panel degrades cleanly.
  filler_swap_count?: number | null
}

function clampDays(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 30
  if (n < 1) return 1
  if (n > 90) return 90
  return Math.floor(n)
}

function rowTimestamp(r: RawCall): number | null {
  const s = r.created_at || r.queued_at
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function rowDuration(r: RawCall): number | null {
  const v = r.duration_seconds
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function rowOutcome(r: RawCall): string {
  // Prefer the explicit `outcome` column; if absent, fall back to `status`.
  // Empty string -> "unknown" so the bar chart doesn't render a blank label.
  const raw = (r.outcome || r.status || 'unknown').toString().trim()
  return raw.length > 0 ? raw : 'unknown'
}

function isDeflection(r: RawCall): boolean {
  if (typeof r.deflection_count === 'number' && r.deflection_count > 0) {
    return true
  }
  const status = (r.status || '').toString().trim().toLowerCase()
  if (DEFLECTION_STATUSES.has(status)) return true
  // refusal_reason populated even when status doesn't say so -> still a
  // deflection (matches the audit-trail semantics on voice-engine's place
  // handler).
  if (r.refusal_reason && r.refusal_reason.toString().trim().length > 0) {
    return true
  }
  return false
}

function median(nums: Array<number>): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

export const Route = createFileRoute(
  '/api/voice-engine/scenarios/$id/performance',
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ready = isVoiceEngineReady()
        if (!ready.ok) {
          return json(
            {
              ok: false,
              error: `voice-engine not configured: ${ready.reason}`,
            },
            { status: 503 },
          )
        }

        const scenarioId = String(params.id || '').trim()
        if (!scenarioId) {
          return json(
            { ok: false, error: 'missing scenario id' },
            { status: 400 },
          )
        }
        const url = new URL(request.url)
        const days = clampDays(url.searchParams.get('days'))
        const windowStartMs = Date.now() - days * 24 * 60 * 60 * 1000

        // Resolve per-org success allowlist BEFORE we tally — same window,
        // same request lifecycle, one extra ~5ms upstream call. Falls back
        // to DEFAULT_SUCCESS_OUTCOMES on any failure (see resolver above).
        const { allowlist: successAllowlist, outcomes: successOutcomes } =
          await resolveSuccessOutcomes()

        // Pull rows page by page, newest first. Stop early if we cross the
        // window boundary -- voice-engine /api/calls returns rows ordered by
        // created_at DESC.
        const rows: Array<RawCall> = []
        let stoppedAtWindow = false
        let upstreamStatus = 200
        for (let page = 0; page < MAX_PAGES; page++) {
          const qs = new URLSearchParams({
            limit: String(PAGE_SIZE),
            offset: String(page * PAGE_SIZE),
          }).toString()
          const res = await forwardToVoiceEngine({
            path: `/api/calls?${qs}`,
            method: 'GET',
          })
          if (res.status >= 400) {
            // Propagate upstream error verbatim so the dashboard sees the
            // real reason (e.g. 503 if Supabase is unreachable).
            return json(res.body as any, { status: res.status })
          }
          upstreamStatus = res.status
          const body = res.body as { calls?: Array<RawCall> } | null
          const batch = Array.isArray(body?.calls) ? body!.calls : []
          if (batch.length === 0) break
          for (const r of batch) {
            const ts = rowTimestamp(r)
            if (ts === null) continue
            if (ts < windowStartMs) {
              stoppedAtWindow = true
              continue
            }
            if ((r.scenario_id ?? null) === scenarioId) {
              rows.push(r)
            }
            if (rows.length >= MAX_ROWS) break
          }
          // Short-circuit: if the LAST row of the batch is older than the
          // window we won't find any newer rows in subsequent pages.
          const last = batch[batch.length - 1]
          const lastTs = last ? rowTimestamp(last) : null
          if (lastTs !== null && lastTs < windowStartMs) {
            stoppedAtWindow = true
            break
          }
          if (batch.length < PAGE_SIZE) break
          if (rows.length >= MAX_ROWS) break
        }

        const total = rows.length
        const byOutcome: Record<string, number> = {}
        const durations: Array<number> = []
        let successCount = 0
        let deflectionCount = 0
        let fillerSwapCount = 0
        for (const r of rows) {
          const oc = rowOutcome(r)
          byOutcome[oc] = (byOutcome[oc] ?? 0) + 1
          if (successAllowlist.has(oc.toLowerCase())) successCount++
          if (isDeflection(r)) deflectionCount++
          // Sum filler_swap_count across the window (same shape as
          // deflection_count above, but a SEPARATE signal — never collapse
          // the two). Defensive coalesce: missing column on older rows or
          // older voice-engine builds returns 0, keeping the panel
          // showing 0 instead of NaN.
          fillerSwapCount += Number(r.filler_swap_count ?? 0)
          const d = rowDuration(r)
          if (d !== null) durations.push(d)
        }
        const successRate = total > 0 ? successCount / total : 0
        const avgDuration =
          durations.length > 0
            ? durations.reduce((s, n) => s + n, 0) / durations.length
            : 0
        const medDuration = median(durations)

        return json(
          {
            ok: true,
            scenario_id: scenarioId,
            window_days: days,
            total_calls: total,
            by_outcome: byOutcome,
            success_rate: Number(successRate.toFixed(4)),
            avg_duration_seconds: Number(avgDuration.toFixed(2)),
            median_duration_seconds: Number(medDuration.toFixed(2)),
            deflection_count: deflectionCount,
            filler_swap_count: fillerSwapCount,
            // Per-org (or default) outcome allowlist used to compute
            // success_rate above. UI surfaces this so the operator can see
            // what "success" means in this org right now.
            success_outcomes: successOutcomes,
            last_updated: new Date().toISOString(),
            // Diagnostic: did we stop because we ran out of rows in window,
            // or did we hit MAX_ROWS / page exhaustion? Useful for the UI
            // to show a "showing first N" hint if needed.
            window_complete: stoppedAtWindow || total < MAX_ROWS,
          },
          { status: upstreamStatus },
        )
      },
    },
  },
})
