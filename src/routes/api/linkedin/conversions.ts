// LinkedIn Conversions API — submit conversion events.
// POST /api/linkedin/conversions
//
// Wraps LinkedIn's POST /rest/conversionEvents endpoint. Required headers
// on the upstream call:
//   Authorization:             Bearer <LINKEDIN_ADS_ACCESS_TOKEN>
//   LinkedIn-Version:          202508
//   X-Restli-Protocol-Version: 2.0.0
//   Content-Type:              application/json
//
// The bearer token is an ADS-permission token (distinct from a user OAuth
// token). It must be associated with an ad account that has access to the
// conversion rule referenced in `conversion` URN.
//
// Payload shape (per the user's payload builder spec):
//   {
//     conversion:           "urn:lla:llaPartnerConversion:<id>",
//     conversionHappenedAt: number (epoch ms),
//     user: {
//       userIds: [{ idValue: <hashed>, idType: "SHA256_EMAIL" | ... }, ...]
//     },
//     conversionValue?: { currencyCode: "USD", amount: "50.0" },
//     eventId?: string  // for dedup
//   }
//
// Env vars (read by NAME only — values never logged):
//   LINKEDIN_ADS_ACCESS_TOKEN — ads-permission OAuth token
//   LINKEDIN_API_VERSION      — optional, defaults to "202508"
//
// Sources:
//   - LinkedIn developer docs: marketing/conversions-api
//   - User-provided payload builder reference

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '@/server/rate-limit'
import { maskApiKeys, redactError } from '@/server/_redact'

// Conservative allowlist of LinkedIn user-id types. Cited from the
// payload-builder UI the user pasted; should be cross-checked against
// the current LinkedIn-Version when in doubt. The point is to reject
// invented idTypes BEFORE forwarding to LinkedIn.
const ALLOWED_ID_TYPES = new Set([
  'SHA256_EMAIL',
  'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID',
  'ACXIOM_ID',
  'ORACLE_MOAT_ID',
] as const)

type AllowedIdType = typeof ALLOWED_ID_TYPES extends Set<infer T> ? T : never

interface UserIdInput {
  idValue: string
  idType: AllowedIdType
}

interface ConversionEventInput {
  conversion: string
  conversionHappenedAt: number
  user: { userIds: UserIdInput[] }
  conversionValue?: { currencyCode: string; amount: string }
  eventId?: string
}

const URN_REGEX = /^urn:lla:llaPartnerConversion:[A-Za-z0-9_-]+$/

function getAdsToken(): string | null {
  const raw = process.env.LINKEDIN_ADS_ACCESS_TOKEN
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

function getApiVersion(): string {
  return process.env.LINKEDIN_API_VERSION || '202508'
}

function validatePayload(
  body: unknown,
): { ok: true; payload: ConversionEventInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.conversion !== 'string' || !URN_REGEX.test(b.conversion)) {
    return {
      ok: false,
      error:
        'conversion must be a URN matching "urn:lla:llaPartnerConversion:<id>"',
    }
  }
  if (
    typeof b.conversionHappenedAt !== 'number' ||
    !Number.isFinite(b.conversionHappenedAt) ||
    b.conversionHappenedAt <= 0
  ) {
    return {
      ok: false,
      error: 'conversionHappenedAt must be a positive epoch-ms number',
    }
  }
  if (!b.user || typeof b.user !== 'object') {
    return { ok: false, error: 'user object is required' }
  }
  const user = b.user as Record<string, unknown>
  if (!Array.isArray(user.userIds) || user.userIds.length === 0) {
    return {
      ok: false,
      error: 'user.userIds must be a non-empty array',
    }
  }
  const normalizedUserIds: UserIdInput[] = []
  for (const entry of user.userIds) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'user.userIds entries must be objects' }
    }
    const e = entry as Record<string, unknown>
    if (typeof e.idValue !== 'string' || e.idValue.length === 0) {
      return {
        ok: false,
        error: 'user.userIds[].idValue must be a non-empty string',
      }
    }
    if (
      typeof e.idType !== 'string' ||
      !ALLOWED_ID_TYPES.has(e.idType as AllowedIdType)
    ) {
      return {
        ok: false,
        error: `user.userIds[].idType must be one of: ${Array.from(ALLOWED_ID_TYPES).join(', ')}`,
      }
    }
    normalizedUserIds.push({
      idValue: e.idValue,
      idType: e.idType as AllowedIdType,
    })
  }

  let conversionValue: ConversionEventInput['conversionValue']
  if (b.conversionValue !== undefined && b.conversionValue !== null) {
    if (typeof b.conversionValue !== 'object') {
      return { ok: false, error: 'conversionValue must be an object' }
    }
    const cv = b.conversionValue as Record<string, unknown>
    if (typeof cv.currencyCode !== 'string' || cv.currencyCode.length !== 3) {
      return {
        ok: false,
        error: 'conversionValue.currencyCode must be ISO-4217 3-char string',
      }
    }
    if (typeof cv.amount !== 'string' || cv.amount.length === 0) {
      return {
        ok: false,
        error: 'conversionValue.amount must be a non-empty string',
      }
    }
    conversionValue = {
      currencyCode: cv.currencyCode,
      amount: cv.amount,
    }
  }

  let eventId: string | undefined
  if (b.eventId !== undefined && b.eventId !== null) {
    if (typeof b.eventId !== 'string' || b.eventId.length === 0) {
      return {
        ok: false,
        error: 'eventId, if provided, must be a non-empty string',
      }
    }
    eventId = b.eventId
  }

  const payload: ConversionEventInput = {
    conversion: b.conversion,
    conversionHappenedAt: b.conversionHappenedAt,
    user: { userIds: normalizedUserIds },
  }
  if (conversionValue) payload.conversionValue = conversionValue
  if (eventId) payload.eventId = eventId
  return { ok: true, payload }
}

export const Route = createFileRoute('/api/linkedin/conversions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const rateLimitKey = `conversions:${getClientIp(request)}`
        if (!rateLimit(rateLimitKey, 20, 60_000)) {
          return rateLimitResponse()
        }

        const adsToken = getAdsToken()
        if (!adsToken) {
          return json(
            {
              ok: false,
              error:
                'LINKEDIN_ADS_ACCESS_TOKEN is not configured. Generate an ads-permission OAuth token and set the env var.',
            },
            { status: 503 },
          )
        }

        let body: unknown
        try {
          body = (await request.json()) as unknown
        } catch (err) {
          return json(
            { ok: false, error: `Invalid JSON body: ${redactError(err)}` },
            { status: 400 },
          )
        }

        const validated = validatePayload(body)
        if (!validated.ok) {
          return json({ ok: false, error: validated.error }, { status: 400 })
        }

        let upstream: Response
        try {
          upstream = await fetch(
            'https://api.linkedin.com/rest/conversionEvents',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${adsToken}`,
                'LinkedIn-Version': getApiVersion(),
                'X-Restli-Protocol-Version': '2.0.0',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(validated.payload),
              signal: AbortSignal.timeout(15_000),
            },
          )
        } catch (err) {
          return json(
            {
              ok: false,
              error: `LinkedIn API unreachable: ${redactError(err)}`,
              hint: 'Check network egress + LinkedIn API status.',
            },
            { status: 502 },
          )
        }

        const raw = await upstream.text().catch(() => '')
        if (!upstream.ok) {
          let upstreamMessage: string | undefined
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            if (typeof parsed.message === 'string') {
              upstreamMessage = parsed.message
            } else if (typeof parsed.error === 'string') {
              upstreamMessage = parsed.error
            }
          } catch {
            // leave undefined
          }
          return json(
            {
              ok: false,
              error:
                upstreamMessage || `LinkedIn returned HTTP ${upstream.status}`,
              // Scrub the upstream body before forwarding to UI — it may
              // echo our Authorization header back in error envelopes.
              hint: maskApiKeys(raw.slice(0, 400)),
              status: upstream.status,
            },
            {
              status:
                upstream.status >= 400 && upstream.status < 500 ? 400 : 502,
            },
          )
        }

        if (raw.length === 0) {
          return json({ ok: true }, { status: 200 })
        }
        try {
          const parsed = JSON.parse(raw) as unknown
          return json({ ok: true, response: parsed }, { status: 200 })
        } catch {
          return json(
            { ok: true, response: { raw: raw.slice(0, 400) } },
            { status: 200 },
          )
        }
      },
    },
  },
})
