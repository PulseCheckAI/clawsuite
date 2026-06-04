// -- /api/voice-engine/scenarios/$id/suggest-improvements -------------------
// Phase 5: Groq-powered scenario improvement suggestions.
//
// POST {days, max_transcripts_per_outcome} -> {
//   current:  ScenarioRow
//   suggested: ScenarioRow              // same shape as current
//   rationale: string                   // one-line "why this change helps"
//   change_summary: string              // one-line "what changed"
// }
//
// Pipeline:
//   1. fetch the scenario row via voice-engine /api/scenarios/:id
//   2. fetch recent calls via voice-engine /api/calls (paginated, filtered to
//      this scenario + window)
//   3. group transcripts by outcome bucket, truncate each transcript to the
//      last 20 turns, cap to max_transcripts_per_outcome rows per bucket
//   4. POST to Groq's chat-completions (openai/gpt-oss-120b, JSON-object
//      response mode) -- same auth + error-handling shape as customize-scenario
//   5. Zod-validate the response and return it to the dashboard
//
// Auth: session cookie via isAuthenticated (same as every other voice route).
// GROQ_API_KEY missing -> fail-loud 503 (parity with customize-scenario).
// ---------------------------------------------------------------------------

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { isAuthenticated } from '@/server/auth-middleware'
import { forwardToVoiceEngine, isVoiceEngineReady } from '@/server/voice-engine'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'openai/gpt-oss-120b'
const GROQ_TIMEOUT_MS = 30_000

// Pagination caps -- match the performance endpoint so the two surfaces see
// the same row population.
const PAGE_SIZE = 200
const MAX_PAGES = 3
const MAX_ROWS = PAGE_SIZE * MAX_PAGES

// Hard cap on per-turn truncation: 20 turns is plenty of signal without
// blowing the Groq context budget when we ship multiple buckets at once.
const MAX_TURNS_PER_TRANSCRIPT = 20

// -- Input schema -----------------------------------------------------------
const RequestSchema = z.object({
  days: z.number().int().min(1).max(90).default(30),
  max_transcripts_per_outcome: z.number().int().min(1).max(10).default(3),
})

// -- Output schema (what Groq must return) ----------------------------------
// The "suggested_scenario" is intentionally an open record -- the scenario
// shape varies (overlay holds the rich AI-Customizer fields, the table has
// the simple columns), and we want Groq's edits to apply equally well to
// either shape without forcing a flatten. The downstream UI is responsible
// for merging into the editor form.
const GroqResponseSchema = z.object({
  rationale: z.string().trim().min(1).max(800),
  change_summary: z.string().trim().min(1).max(400),
  suggested_scenario: z.record(z.unknown()),
})

// -- Types from upstream ----------------------------------------------------
type TranscriptTurn = { role: string; text: string }

type RawCall = {
  id?: string
  scenario_id?: string | null
  status?: string | null
  outcome?: string | null
  refusal_reason?: string | null
  duration_seconds?: number | string | null
  created_at?: string | null
  queued_at?: string | null
  transcript?: Array<TranscriptTurn> | null
}

type ScenarioRow = Record<string, unknown> & {
  id?: string
  name?: string
  description?: string | null
  overlay?: Record<string, unknown> | null
}

function rowTimestamp(r: RawCall): number | null {
  const s = r.created_at || r.queued_at
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function rowOutcome(r: RawCall): string {
  const raw = (r.outcome || r.status || 'unknown').toString().trim()
  return raw.length > 0 ? raw : 'unknown'
}

function truncateTranscript(
  t: Array<TranscriptTurn> | null | undefined,
): Array<TranscriptTurn> {
  if (!Array.isArray(t) || t.length === 0) return []
  const tail = t.slice(-MAX_TURNS_PER_TRANSCRIPT)
  // Defensive shape coerce: some rows may have other keys; we only care
  // about role + text and clamp text length so one runaway turn can't
  // blow up the prompt.
  return tail.map((turn) => ({
    role: String(turn.role || 'unknown').slice(0, 32),
    text: String(turn.text || '').slice(0, 600),
  }))
}

// -- System prompt ----------------------------------------------------------
const SYSTEM_PROMPT =
  'You are a voice-agent scenario tuner for PulseOS. The user provides a ' +
  'current scenario (JSON) plus recent call transcripts grouped by outcome. ' +
  'Propose MINIMAL, SURGICAL edits to the scenario that increase the ' +
  'success rate, drawing on what worked in the "completed" / "success" ' +
  'buckets and what failed in the "refused" / "no_answer" / "failed" / ' +
  '"objection" buckets. Return ONLY valid JSON: { rationale: string, ' +
  'change_summary: string, suggested_scenario: <same shape as input> }. ' +
  'Do not invent fields the input does not have. Do not return prose, ' +
  'markdown, or commentary. Keep the rationale to one or two sentences ' +
  'and change_summary to one sentence. If the data is too thin to make ' +
  'a confident change, return suggested_scenario identical to input and ' +
  'explain in rationale.'

function buildUserMessage(opts: {
  scenario: ScenarioRow
  byBucket: Record<string, Array<Array<TranscriptTurn>>>
  windowDays: number
  totalCalls: number
}): string {
  const lines: Array<string> = []
  lines.push(`Current scenario:`)
  lines.push(JSON.stringify(opts.scenario, null, 2))
  lines.push('')
  lines.push(
    `Window: last ${opts.windowDays} days, ${opts.totalCalls} total calls.`,
  )
  lines.push('Recent transcripts grouped by outcome (last 20 turns each):')
  // Stable bucket order: success buckets first, then everything else
  // alphabetically -- so Groq sees the "what works" examples up front.
  const known = ['completed', 'success', 'booked']
  const bucketKeys = Object.keys(opts.byBucket).sort((a, b) => {
    const aKnown = known.includes(a.toLowerCase())
    const bKnown = known.includes(b.toLowerCase())
    if (aKnown && !bKnown) return -1
    if (!aKnown && bKnown) return 1
    return a.localeCompare(b)
  })
  for (const k of bucketKeys) {
    const transcripts = opts.byBucket[k]
    lines.push('')
    lines.push(`== ${k} (${transcripts.length} sample(s)) ==`)
    transcripts.forEach((t, i) => {
      lines.push(`-- sample ${i + 1} --`)
      if (t.length === 0) {
        lines.push('(no transcript captured)')
      } else {
        for (const turn of t) {
          lines.push(`${turn.role}: ${turn.text}`)
        }
      }
    })
  }
  return lines.join('\n')
}

export const Route = createFileRoute(
  '/api/voice-engine/scenarios/$id/suggest-improvements',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
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
        const apiKey = process.env.GROQ_API_KEY?.trim()
        if (!apiKey) {
          return json(
            {
              ok: false,
              error:
                'GROQ_API_KEY not set on dashboard -- scenario suggestions are unavailable',
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

        // Parse + validate body.
        const rawBody = await request.json().catch(() => null)
        if (rawBody === null) {
          return json({ ok: false, error: 'invalid JSON' }, { status: 400 })
        }
        const parsed = RequestSchema.safeParse(rawBody)
        if (!parsed.success) {
          return json(
            {
              ok: false,
              error: 'invalid request',
              detail: parsed.error.flatten(),
            },
            { status: 400 },
          )
        }
        const { days, max_transcripts_per_outcome } = parsed.data
        const windowStartMs = Date.now() - days * 24 * 60 * 60 * 1000

        // 1. Current scenario.
        const scenarioRes = await forwardToVoiceEngine({
          path: `/api/scenarios/${encodeURIComponent(scenarioId)}`,
          method: 'GET',
        })
        if (scenarioRes.status >= 400) {
          return json(scenarioRes.body as any, { status: scenarioRes.status })
        }
        const currentScenario = scenarioRes.body as ScenarioRow | null
        if (!currentScenario || typeof currentScenario !== 'object') {
          return json(
            { ok: false, error: 'scenario not found' },
            { status: 404 },
          )
        }

        // 2. Pull recent calls + filter.
        const calls: Array<RawCall> = []
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
            return json(res.body as any, { status: res.status })
          }
          const body = res.body as { calls?: Array<RawCall> } | null
          const batch = Array.isArray(body?.calls) ? body!.calls : []
          if (batch.length === 0) break
          let outOfWindow = false
          for (const r of batch) {
            const ts = rowTimestamp(r)
            if (ts === null) continue
            if (ts < windowStartMs) {
              outOfWindow = true
              continue
            }
            if ((r.scenario_id ?? null) === scenarioId) {
              calls.push(r)
            }
            if (calls.length >= MAX_ROWS) break
          }
          if (outOfWindow) break
          if (batch.length < PAGE_SIZE) break
          if (calls.length >= MAX_ROWS) break
        }

        // 3. Bucket transcripts by outcome.
        const byBucket: Record<string, Array<Array<TranscriptTurn>>> = {}
        for (const r of calls) {
          const oc = rowOutcome(r)
          if (!byBucket[oc]) byBucket[oc] = []
          if (byBucket[oc].length >= max_transcripts_per_outcome) continue
          byBucket[oc].push(truncateTranscript(r.transcript))
        }

        // Degraded mode: zero transcripts available (calls have null
        // transcript). Tell Groq up front -- it should still propose an edit
        // based on outcome distribution alone (e.g. "objection bucket is 40%
        // -> add a rebuttal hint to opening_line").
        const anyTranscriptText = Object.values(byBucket).some((arr) =>
          arr.some((t) => t.length > 0),
        )
        const userMessageOpts = {
          scenario: currentScenario,
          byBucket: anyTranscriptText
            ? byBucket
            : // fold each bucket into empty arrays so the prompt at least
              // surfaces the outcome counts.
              Object.fromEntries(
                Object.keys(byBucket).map((k) => [
                  k,
                  byBucket[k].map(() => []),
                ]),
              ),
          windowDays: days,
          totalCalls: calls.length,
        }
        const userMessage = buildUserMessage(userMessageOpts)

        // 4. Call Groq.
        let upstream: Response
        try {
          upstream = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              model: GROQ_MODEL,
              response_format: { type: 'json_object' },
              temperature: 0.35,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
              ],
            }),
            signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
          })
        } catch (e) {
          return json(
            {
              ok: false,
              error: `groq unreachable: ${
                e instanceof Error ? e.message : String(e)
              }`,
            },
            { status: 502 },
          )
        }

        const upstreamBody = (await upstream.json().catch(() => null)) as {
          choices?: Array<{ message?: { content?: string | null } }>
          error?: { message?: string }
        } | null

        if (!upstream.ok) {
          const detail =
            upstreamBody?.error?.message ??
            upstreamBody ??
            `groq returned ${upstream.status}`
          return json(
            { ok: false, error: 'groq error', detail },
            { status: upstream.status },
          )
        }

        const raw = upstreamBody?.choices?.[0]?.message?.content ?? null
        if (!raw || typeof raw !== 'string') {
          return json(
            {
              ok: false,
              error: 'groq returned empty content',
              detail: upstreamBody,
            },
            { status: 502 },
          )
        }

        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(raw)
        } catch (e) {
          return json(
            {
              ok: false,
              error: 'groq returned invalid JSON',
              detail: { raw, parseError: String(e) },
            },
            { status: 502 },
          )
        }

        const validated = GroqResponseSchema.safeParse(parsedJson)
        if (!validated.success) {
          return json(
            {
              ok: false,
              error: 'suggestion shape failed validation',
              detail: { issues: validated.error.flatten(), raw: parsedJson },
            },
            { status: 502 },
          )
        }

        return json({
          ok: true,
          current: currentScenario,
          suggested: validated.data.suggested_scenario as ScenarioRow,
          rationale: validated.data.rationale,
          change_summary: validated.data.change_summary,
          window_days: days,
          total_calls_considered: calls.length,
          transcripts_used: anyTranscriptText,
        })
      },
    },
  },
})
