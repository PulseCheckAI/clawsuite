// ── /api/voice-engine/customize-scenario ───────────────────────────────────
// AI Call Customizer back-end. Browser sends a natural-language prompt + the
// scenario the operator is currently editing; we call Groq's chat-completions
// endpoint with structured-output mode and return a Zod-validated scenario
// shape ready to merge into the editor form.
//
// Why Groq directly (not via voice-engine)? The Voice Hub UI is the only
// consumer, the request is purely text-in/JSON-out, and routing it through
// voice-engine would force the (HMAC + X-Org-Id) plumbing for what is, at
// its core, an LLM-shaped Zod validator. GROQ_API_KEY stays server-side;
// the browser never sees it.
//
// Mirrors the auth pattern of every other /api/voice-engine/* route:
//   - isAuthenticated(request) gate (session cookie)
//   - Fail-loud 503 if GROQ_API_KEY missing (NOT a silent fallback — this is
//     a paid path and the operator deserves to know it's misconfigured)
//   - Errors from Groq surface with their status code preserved
// ────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { isAuthenticated } from '@/server/auth-middleware'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'openai/gpt-oss-120b'
const GROQ_TIMEOUT_MS = 20_000

// ── Input ───────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required').max(4_000),
  currentScenario: z.record(z.unknown()).optional(),
})

// ── Output (the scenario shape Groq must return) ───────────────────────────
//
// These keys are deliberately a SUPERSET of the voice_scenarios columns the
// operator can edit in the form. The richer fields (opening_line, objective,
// success_criteria, tone, allowed_tools) ride in voice_scenarios.overlay /
// dynamic_variables; the columns the table has natively (name, description,
// voice_id, max_duration_seconds -> expected_duration_seconds) map 1:1 to
// real columns at save-time.

const ScenarioSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
  opening_line: z.string().trim().min(1).max(400),
  objective: z.string().trim().min(1).max(400),
  success_criteria: z.string().trim().min(1).max(400),
  tone: z.string().trim().min(1).max(80),
  voice_id: z.string().trim().min(1).max(120),
  max_duration_seconds: z
    .number()
    .int()
    .min(30)
    .max(60 * 30), // 30 min hard ceiling — matches table CHECK semantics
  allowed_tools: z.array(z.string().trim().min(1).max(80)).max(24),
})

// ── System prompt ──────────────────────────────────────────────────────────
//
// Kept terse on purpose: gpt-oss-120b follows JSON-mode instructions
// reliably and prose padding here just inflates latency.

const SYSTEM_PROMPT =
  'You convert natural-language voice-agent requests into structured ' +
  'PulseOS voice scenario JSON. Return ONLY valid JSON matching: ' +
  '{ name, description, opening_line, objective, success_criteria, tone, ' +
  'voice_id, max_duration_seconds, allowed_tools (string[]) }. ' +
  'No prose, no markdown, no commentary. If the user provided a ' +
  'currentScenario, treat it as the starting point and return the full ' +
  'updated scenario (not a diff).'

function buildUserMessage(
  prompt: string,
  currentScenario: Record<string, unknown> | undefined,
): string {
  if (!currentScenario || Object.keys(currentScenario).length === 0) {
    return prompt
  }
  return (
    `Current scenario:\n${JSON.stringify(currentScenario, null, 2)}\n\n` +
    `Operator request:\n${prompt}`
  )
}

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/voice-engine/customize-scenario')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const apiKey = process.env.GROQ_API_KEY?.trim()
        if (!apiKey) {
          return json(
            {
              ok: false,
              error:
                'GROQ_API_KEY not set on dashboard — AI Customizer is unavailable',
            },
            { status: 503 },
          )
        }

        // Parse + validate input.
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
        const { prompt, currentScenario } = parsed.data

        // Call Groq.
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
              temperature: 0.4,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                  role: 'user',
                  content: buildUserMessage(prompt, currentScenario),
                },
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
          choices?: Array<{
            message?: { content?: string | null }
          }>
          error?: { message?: string }
        } | null

        if (!upstream.ok) {
          // Surface Groq's error verbatim — operator needs to see rate-limit
          // / quota messages, not a generic "AI failed".
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

        // The model is in JSON mode but parsing can still fail if it
        // double-encoded or wrapped in markdown — be paranoid.
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

        const scenarioParsed = ScenarioSchema.safeParse(parsedJson)
        if (!scenarioParsed.success) {
          return json(
            {
              ok: false,
              error: 'scenario shape failed validation',
              detail: {
                issues: scenarioParsed.error.flatten(),
                raw: parsedJson,
              },
            },
            { status: 502 },
          )
        }

        return json({
          ok: true,
          scenario: scenarioParsed.data,
          raw,
        })
      },
    },
  },
})
