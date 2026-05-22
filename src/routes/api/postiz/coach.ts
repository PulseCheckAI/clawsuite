// Postiz composer — AI coach chat endpoint.
// POST /api/postiz/coach
//
// Mirrors the 3-tier LLM resolution from src/routes/api/linkedin/coach.ts:
//   1. OpenClaw gateway (preferred — uses operator's configured provider).
//      Triggered when CLAWDBOT_GATEWAY_TOKEN is set AND /health responds.
//   2. Direct Anthropic API (process.env.ANTHROPIC_API_KEY).
//   3. Direct OpenAI API (process.env.OPENAI_API_KEY).
//
// When no provider is reachable OR a real LLM call fails, we fall back to a
// deterministic, CONTEXT-AWARE stub. The stub returns generic multi-platform
// UX heuristics ONLY — never fabricates engagement metrics.
//
// LinkedIn is explicitly scoped OUT of this coach's domain. If the operator
// includes 'linkedin' in the target platforms, we return an error pointing
// them at the LinkedIn module. (The LinkedIn surface has its own coach.)
//
// Response shape (matches linkedin/coach.ts so the chat panel can be reused):
//   { ok: true, reply: { role: 'assistant', content, stub, nextActions? } }
//
// Called from: src/screens/postiz/postiz-chat-panel.tsx.

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
import { getCharLimit, isForbiddenPlatform } from './_client'

interface CoachBody {
  message?: unknown
  draft?: unknown
  platforms?: unknown
  history?: unknown
}

interface CoachReply {
  role: 'assistant'
  content: string
  stub: boolean
  nextActions?: string[]
}

const COACH_SYSTEM_PROMPT =
  'You are a senior multi-platform social media coach. Given a draft post and target platforms (NOT including LinkedIn — that is a different module), suggest concrete improvements: per-platform hooks, character-count fitting, hashtag strategy, scheduling windows. Never fabricate engagement metrics.'

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

  const anthropic = process.env['ANTHROPIC_API_KEY']?.trim()
  if (anthropic) return { kind: 'anthropic', apiKey: anthropic }

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
  platforms: string[],
  history: ReadonlyArray<{ role: string; content: string }>,
): string {
  const platformLine =
    platforms.length > 0
      ? `Target platforms: ${platforms.join(', ')}`
      : 'No target platforms specified.'

  const limitsBlock =
    platforms.length > 0
      ? platforms
          .map((p) => `  ${p}: ${getCharLimit(p).toLocaleString()} char limit`)
          .join('\n')
      : '(no limits to show — no platforms specified)'

  const historyBlock =
    history.length > 0
      ? history
          .slice(-6)
          .map((h) => `${h.role}: ${h.content}`)
          .join('\n')
      : '(no prior turns)'

  return [
    platformLine,
    '',
    'Per-platform character limits:',
    limitsBlock,
    '',
    'Current draft (verbatim, may be empty):',
    '---',
    draft.length > 0 ? draft : '(empty)',
    '---',
    '',
    'Recent conversation:',
    historyBlock,
    '',
    `User question: ${userMessage || '(no explicit question — give general coaching on the current draft for the chosen platforms)'}`,
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
 * draft (length, hashtags, mentions, links, line breaks) and the target
 * platforms' character limits. Returns generic UX heuristics — never invents
 * metrics or platform-algorithm predictions.
 */
function buildStubReply(
  userMessage: string,
  draft: string,
  platforms: string[],
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
      'The draft is empty. Lead with a one-line hook — the first ~100 characters carry the most weight on every platform.',
    )
  } else {
    const overLimit = platforms
      .map((p) => ({ p, limit: getCharLimit(p) }))
      .filter(({ limit }) => len > limit)
    if (overLimit.length > 0) {
      notes.push(
        `Draft is ${len} chars. Over the limit for: ${overLimit
          .map(({ p, limit }) => `${p} (${limit})`)
          .join(', ')}. Trim, split, or drop the affected platform.`,
      )
    } else if (platforms.length > 0) {
      const tightest = platforms.reduce<{ p: string; limit: number } | null>(
        (acc, p) => {
          const limit = getCharLimit(p)
          if (!acc || limit < acc.limit) return { p, limit }
          return acc
        },
        null,
      )
      if (tightest) {
        notes.push(
          `Draft is ${len} chars — fits all selected platforms. Tightest budget is ${tightest.p} at ${tightest.limit.toLocaleString()} chars (${tightest.limit - len} remaining).`,
        )
      }
    }
  }

  if (firstLine.length > 0) {
    notes.push(
      `Opening line: "${firstLine.slice(0, 80)}${firstLine.length > 80 ? '…' : ''}" — verify it carries the hook on its own; truncation on X, Threads, and Bluesky will eat the rest.`,
    )
  }

  if (hashtags === 0 && len > 0) {
    if (platforms.some((p) => p === 'instagram' || p === 'tiktok')) {
      notes.push(
        'No hashtags detected. Instagram and TikTok still surface posts via tag clusters — 3–8 niche tags is the common pattern.',
      )
    } else if (platforms.includes('x')) {
      notes.push(
        'No hashtags detected. On X, 1–2 well-targeted tags is the sweet spot; more reads as spam.',
      )
    } else {
      notes.push(
        'No hashtags detected. Consider 2–4 niche tags appropriate to each platform; avoid generic ones like #business.',
      )
    }
  } else if (hashtags > 10) {
    notes.push(
      `Detected ${hashtags} hashtags — heavy. Instagram tolerates up to ~30, but X/Threads/Bluesky/Mastodon do not. Trim platform-by-platform.`,
    )
  }

  if (links > 0) {
    if (platforms.includes('instagram') || platforms.includes('tiktok')) {
      notes.push(
        `${links} link${links === 1 ? '' : 's'} in the body. Instagram and TikTok do not make in-caption links clickable; move them to the first comment or your bio.`,
      )
    } else {
      notes.push(
        `${links} link${links === 1 ? '' : 's'} in the body. On X and Threads, surface posts with bare links get downranked; consider a quote-link or a thread reply.`,
      )
    }
  }

  if (lineBreaks === 0 && len > 300) {
    notes.push(
      'No line breaks in a 300+ char post. Add whitespace every 1–2 sentences so the body is scannable on mobile.',
    )
  }

  if (mentions > 0) {
    notes.push(
      `Detected ${mentions} @-mention${mentions === 1 ? '' : 's'}. Confirm the handles exist on EACH selected platform — the same name on X and Threads is often two different accounts.`,
    )
  }

  if (platforms.length > 1) {
    notes.push(
      'Multi-platform post: consider whether one draft truly fits all selected platforms. Per-platform variants typically outperform a single broadcast.',
    )
  }

  notes.push(
    'Scheduling: most B2B audiences engage on Tue–Thu mornings (local time). Verify against your own historical data before treating this as advice.',
  )

  if (userMessage.trim().length > 0) {
    notes.push(
      `Your question: "${userMessage.slice(0, 140)}${userMessage.length > 140 ? '…' : ''}" — a real LLM would address this directly. Until one is wired (set ANTHROPIC_API_KEY / OPENAI_API_KEY, or run the OpenClaw gateway), only the deterministic checks above are available.`,
    )
  }

  const content =
    '[LLM coach not wired — see TODO in src/routes/api/postiz/coach.ts]\n\n' +
    'No real LLM was reachable, so the coach is running its deterministic checklist on the draft instead. ' +
    'These are generic multi-platform UX heuristics — not engagement predictions and not platform-algorithm advice.'

  return {
    role: 'assistant',
    content,
    stub: true,
    nextActions: notes,
  }
}

export const Route = createFileRoute('/api/postiz/coach')({
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
        const rateLimitKey = `coach:postiz:${getClientIp(request)}`
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

        const platforms: string[] = []
        if (Array.isArray(body.platforms)) {
          for (const p of body.platforms) {
            if (typeof p === 'string' && p.length > 0) {
              platforms.push(p)
            }
          }
        }

        // LinkedIn scope-out: this coach is for the multi-platform module
        // ONLY. If the operator targets LinkedIn here, redirect them.
        const linkedinHit = platforms.find((p) => isForbiddenPlatform(p))
        if (linkedinHit) {
          return json(
            {
              ok: false,
              error:
                'This coach does not advise on LinkedIn — use the dedicated LinkedIn module for LinkedIn-specific guidance.',
              forbidden: linkedinHit,
            },
            { status: 400 },
          )
        }

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
            reply: buildStubReply(userMessage, draft, platforms),
          })
        }

        const userPrompt = buildUserPrompt(
          userMessage,
          draft,
          platforms,
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
          if (import.meta.env.DEV) {
            console.error(
              '[/api/postiz/coach] LLM call failed, falling back to stub:',
              redactError(err),
            )
          }
          return json({
            ok: true,
            reply: buildStubReply(userMessage, draft, platforms),
          })
        }
      },
    },
  },
})
