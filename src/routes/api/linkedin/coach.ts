// LinkedIn composer — AI coach chat endpoint.
// POST /api/linkedin/coach
//
// Wiring: this route attempts a real one-shot LLM completion using the same
// provider-resolution pattern that `src/server/debug-analyzer.ts` already
// uses successfully in this codebase. The resolution chain is:
//
//   1. OpenClaw gateway (preferred — uses the locally-configured provider).
//      Triggered when CLAWDBOT_GATEWAY_TOKEN is set AND the gateway answers
//      /health within 1s. Hits the gateway's OpenAI-compatible
//      /v1/chat/completions endpoint.
//   2. Direct Anthropic API (process.env.ANTHROPIC_API_KEY).
//   3. Direct OpenAI API (process.env.OPENAI_API_KEY).
//
// If NONE of these are available, or any of them fail, the route falls back
// to a deterministic, CONTEXT-AWARE stub that varies based on the draft's
// shape (length, hashtags, mentions, links, line breaks). The stub never
// fabricates engagement metrics — only generic, well-known LinkedIn UX
// heuristics ("under 1300 chars tends to keep engagement high", "first
// 210 chars are the hook before the See more fold", etc.).
//
// The response shape is preserved either way:
//   { ok: true, reply: { role, content, stub, nextActions } }
// Consumers (linkedin-chat-panel.tsx) render the "stub" badge based on the
// `stub` flag, so the operator can always tell whether the suggestion came
// from a real model or the heuristic fallback.
//
// What it would take to ALWAYS hit a real LLM (zero stub path):
//   - Set ANTHROPIC_API_KEY or OPENAI_API_KEY in the dashboard's process env, OR
//   - Run the OpenClaw gateway with CLAWDBOT_GATEWAY_TOKEN set and the
//     gateway's models config pointed at a usable provider (matches the
//     auto-discovery already used by /api/send + send-stream).
// No new env vars are needed beyond what `debug-analyzer.ts` already documents.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '@/server/rate-limit'
import { redactError } from '@/server/_redact'

interface CoachBody {
  message?: unknown
  draft?: unknown
  identityType?: unknown
  history?: unknown
}

interface CoachReply {
  role: 'assistant'
  content: string
  // True when no real LLM was reachable and this is a heuristic fallback.
  // The UI surfaces a clear "stub reply" badge when this is true.
  stub: boolean
  // Concrete, non-fabricated next actions / observations. Always populated
  // when stub=true so the surface has something useful; optional when a real
  // model answers (the model's prose is the primary output then).
  nextActions?: string[]
}

const COACH_SYSTEM_PROMPT =
  'You are a senior LinkedIn growth coach for B2B founders. Given a draft post and user goal, suggest concrete improvements: hooks, CTAs, hashtag picks, timing. Be specific. Never fabricate engagement metrics.'

// Gateway lookup mirrors debug-analyzer.ts so we share the operator's
// CLAWDBOT_GATEWAY_URL setting if one is configured.
function getGatewayHttpUrl(suffix: string): string {
  const envUrl =
    process.env['CLAWDBOT_GATEWAY_URL']?.trim() || 'ws://127.0.0.1:18789'
  try {
    const parsed = new URL(envUrl)
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    parsed.pathname = suffix
    return parsed.toString()
  } catch {
    return `http://127.0.0.1:18789${suffix}`
  }
}

type ProviderKind = 'gateway' | 'anthropic' | 'openai'
type ResolvedProvider = { kind: ProviderKind; apiKey: string }

async function resolveProvider(): Promise<ResolvedProvider | null> {
  // 1. Gateway probe — cheap (1s timeout) and works for any configured provider.
  const gwToken = process.env['CLAWDBOT_GATEWAY_TOKEN']?.trim()
  if (gwToken) {
    try {
      const probe = await fetch(getGatewayHttpUrl('/health'), {
        signal: AbortSignal.timeout(1000),
      }).catch(() => null)
      if (probe?.ok) {
        return { kind: 'gateway', apiKey: gwToken }
      }
    } catch {
      // fall through
    }
  }

  // 2. Direct Anthropic.
  const anthropic = process.env['ANTHROPIC_API_KEY']?.trim()
  if (anthropic) return { kind: 'anthropic', apiKey: anthropic }

  // 3. Direct OpenAI.
  const openai = process.env['OPENAI_API_KEY']?.trim()
  if (openai) return { kind: 'openai', apiKey: openai }

  return null
}

interface AnthropicResp {
  content?: Array<{ type?: string; text?: string }>
  error?: { message?: string }
}
interface OpenAIResp {
  choices?: Array<{ message?: { content?: string | null } }>
  error?: { message?: string }
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250514'
const OPENAI_MODEL = 'gpt-4o-mini'
const REQUEST_TIMEOUT_MS = 30_000
const MAX_TOKENS = 800

function buildUserPrompt(
  userMessage: string,
  draft: string,
  identityType: string,
  history: ReadonlyArray<{ role: string; content: string }>,
): string {
  const identityNote =
    identityType === 'organization'
      ? 'Posting as a company page (organization).'
      : identityType === 'person'
        ? 'Posting as a personal profile.'
        : 'Identity type not specified.'

  const historyBlock =
    history.length > 0
      ? history
          .slice(-6)
          .map((h) => `${h.role}: ${h.content}`)
          .join('\n')
      : '(no prior turns)'

  return [
    identityNote,
    '',
    'Current draft (verbatim, may be empty):',
    '---',
    draft.length > 0 ? draft : '(empty)',
    '---',
    '',
    'Recent conversation:',
    historyBlock,
    '',
    `User question: ${userMessage || '(no explicit question — give general coaching on the current draft)'}`,
  ].join('\n')
}

async function callAnthropic(
  apiKey: string,
  userPrompt: string,
): Promise<string> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = (await resp.json().catch(() => ({}))) as AnthropicResp
  if (!resp.ok) {
    throw new Error(payload.error?.message || `Anthropic ${resp.status}`)
  }
  const text = payload.content?.find(
    (b) => b.type === 'text' && typeof b.text === 'string',
  )?.text
  if (!text) throw new Error('Anthropic returned no text output')
  return text
}

async function callOpenAI(apiKey: string, userPrompt: string): Promise<string> {
  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: COACH_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = (await resp.json().catch(() => ({}))) as OpenAIResp
  if (!resp.ok) {
    throw new Error(payload.error?.message || `OpenAI ${resp.status}`)
  }
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI returned no message content')
  return text
}

async function callGateway(token: string, userPrompt: string): Promise<string> {
  const resp = await fetch(getGatewayHttpUrl('/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: COACH_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = (await resp.json().catch(() => ({}))) as OpenAIResp
  if (!resp.ok) {
    throw new Error(payload.error?.message || `Gateway ${resp.status}`)
  }
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error('Gateway returned no message content')
  return text
}

/**
 * Context-aware deterministic fallback. Looks at concrete features of the
 * draft (length, hashtags, mentions, links, line breaks) and returns a few
 * generic but plausible coaching notes. Never invents metrics — only
 * surface-level UX heuristics that are widely documented for LinkedIn.
 */
function buildStubReply(
  userMessage: string,
  draft: string,
  identityType: string,
): CoachReply {
  const notes: string[] = []
  const len = draft.length
  const hashtags = (draft.match(/(?:^|\s)#[\w-]+/g) ?? []).length
  const mentions = (draft.match(/(?:^|\s)@[\w-]+/g) ?? []).length
  const links = (draft.match(/https?:\/\/\S+/g) ?? []).length
  const lineBreaks = (draft.match(/\n/g) ?? []).length
  const firstLine = draft.split(/\r?\n/)[0] ?? ''

  if (len === 0) {
    notes.push(
      'The draft is empty. Start with a one-line hook in the first 210 characters — that is what readers see above the "See more" fold.',
    )
  } else if (len < 200) {
    notes.push(
      `Draft is ${len} chars — very short. LinkedIn allows up to 3000; consider expanding with one concrete example or data point.`,
    )
  } else if (len <= 1300) {
    notes.push(
      `Draft is ${len} chars — in the sweet spot many B2B operators aim for (under ~1300). Consider whether the first 210 chars (currently "${firstLine.slice(0, 60)}${firstLine.length > 60 ? '…' : ''}") earn the click on "See more".`,
    )
  } else if (len <= 3000) {
    notes.push(
      `Draft is ${len} chars — long-form territory. Make sure the hook line stands alone before the "See more" fold and that the body has visible structure (line breaks or numbered points).`,
    )
  } else {
    notes.push(
      `Draft is ${len} chars — LinkedIn caps personal posts at 3000. Trim before publishing.`,
    )
  }

  if (hashtags === 0 && len > 0) {
    notes.push(
      'No hashtags detected. 3–5 niche-specific tags at the end is the common pattern; avoid generic ones like #business.',
    )
  } else if (hashtags > 8) {
    notes.push(
      `Detected ${hashtags} hashtags — that is on the heavy side. Most coaches recommend 3–5; trim to the most relevant.`,
    )
  } else if (hashtags > 0) {
    notes.push(
      `Detected ${hashtags} hashtag${hashtags === 1 ? '' : 's'}. Verify each one has an active audience in your niche.`,
    )
  }

  if (links > 0) {
    notes.push(
      `Draft contains ${links} link${links === 1 ? '' : 's'}. LinkedIn de-prioritizes posts with external links in the body; consider moving the link to the first comment.`,
    )
  }

  if (mentions === 0 && identityType === 'organization') {
    notes.push(
      'Posting as a company page with no @-mentions. Tagging a person (a customer, partner, or employee) typically lifts reach more than tagging another page.',
    )
  } else if (mentions > 0) {
    notes.push(
      `Detected ${mentions} @-mention${mentions === 1 ? '' : 's'}. Make sure the tagged accounts will plausibly engage — irrelevant tags read as spammy.`,
    )
  }

  if (lineBreaks === 0 && len > 300) {
    notes.push(
      'No line breaks in a 300+ char post. Add visual whitespace every 1–2 sentences so the body is scannable on mobile.',
    )
  }

  if (userMessage.trim().length > 0) {
    notes.push(
      `Your question: "${userMessage.slice(0, 140)}${userMessage.length > 140 ? '…' : ''}" — a real LLM would address this directly. Until one is wired (see TODO at the top of src/routes/api/linkedin/coach.ts), only the deterministic checks above are available.`,
    )
  }

  const content =
    '[LLM coach not wired — see TODO in src/routes/api/linkedin/coach.ts]\n\n' +
    'No real LLM was reachable, so the coach is running its deterministic checklist on the draft instead. ' +
    'These are generic LinkedIn UX heuristics — not engagement predictions and not personalized advice.'

  return {
    role: 'assistant',
    content,
    stub: true,
    nextActions: notes,
  }
}

export const Route = createFileRoute('/api/linkedin/coach')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        // CSRF mitigation — reject any POST without application/json.
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        // Rate limit — coach hits paid LLM APIs; cap each client at
        // 10 requests per minute to prevent loop-driven wallet drain.
        const rateLimitKey = `coach:linkedin:${getClientIp(request)}`
        if (!rateLimit(rateLimitKey, 10, 60_000)) {
          return rateLimitResponse()
        }

        let body: CoachBody
        try {
          body = (await request.json()) as CoachBody
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const userMessage =
          typeof body.message === 'string' ? body.message.trim() : ''
        const draft = typeof body.draft === 'string' ? body.draft : ''
        const identityType =
          typeof body.identityType === 'string' ? body.identityType : ''

        const history: Array<{ role: string; content: string }> = []
        if (Array.isArray(body.history)) {
          for (const turn of body.history) {
            if (!turn || typeof turn !== 'object') continue
            const t = turn as Record<string, unknown>
            const role = typeof t.role === 'string' ? t.role : ''
            const content = typeof t.content === 'string' ? t.content : ''
            if ((role === 'user' || role === 'assistant') && content) {
              history.push({ role, content })
            }
          }
        }

        // Reject completely empty inputs — nothing useful to coach about.
        if (userMessage.length === 0 && draft.length === 0) {
          return json(
            {
              ok: false,
              error:
                'Provide either a draft to review or a question for the coach.',
            },
            { status: 400 },
          )
        }

        const provider = await resolveProvider()
        if (!provider) {
          return json({
            ok: true,
            reply: buildStubReply(userMessage, draft, identityType),
          })
        }

        const userPrompt = buildUserPrompt(
          userMessage,
          draft,
          identityType,
          history,
        )

        try {
          let text: string
          if (provider.kind === 'gateway') {
            text = await callGateway(provider.apiKey, userPrompt)
          } else if (provider.kind === 'anthropic') {
            text = await callAnthropic(provider.apiKey, userPrompt)
          } else {
            text = await callOpenAI(provider.apiKey, userPrompt)
          }

          const reply: CoachReply = {
            role: 'assistant',
            content: text.trim(),
            stub: false,
          }
          return json({ ok: true, reply })
        } catch (err) {
          // Any LLM failure (timeout, bad key, network) falls back to the
          // context-aware stub so the surface keeps working. The stub flag
          // tells the UI to render the "stub reply" badge.
          if (import.meta.env.DEV) {
            console.error(
              '[/api/linkedin/coach] LLM call failed, falling back to stub:',
              redactError(err),
            )
          }
          return json({
            ok: true,
            reply: buildStubReply(userMessage, draft, identityType),
          })
        }
      },
    },
  },
})
