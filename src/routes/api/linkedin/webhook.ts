// LinkedIn Webhook endpoint.
//
// LinkedIn delivers TWO things to this URL:
//   1. GET /api/linkedin/webhook?challengeCode=<uuid>
//      — issued on initial registration and every 2 hours for re-validation.
//      We must respond within 3 SECONDS with:
//        Status:       200
//        Content-Type: application/json
//        Body:         { "challengeCode": "<same>", "challengeResponse": "<hex-encoded HMACSHA256(challengeCode, LINKEDIN_CLIENT_SECRET)>" }
//
//   2. POST /api/linkedin/webhook
//      — notification payloads with header `X-LI-Signature: hmacsha256=<hex>`
//      We must:
//        - Verify the signature against `HMACSHA256(body, LINKEDIN_CLIENT_SECRET)` (constant-time compare)
//        - Deduplicate by Notification ID
//        - Return 2xx within a reasonable time
//
// Neither method requires `isAuthenticated` — LinkedIn doesn't send our
// session cookie. The signature IS the auth on POST. The GET is gated
// only by the operator knowing the URL + the clientSecret.
//
// Env vars (read by NAME only — values never logged):
//   LINKEDIN_CLIENT_SECRET — the OAuth client secret. Used as the HMAC key
//                            for both challenge response and signature
//                            verification.
//   LINKEDIN_APP_ID        — optional. Numeric app ID (e.g. "230752128").
//                            Only needed if you operate parent-child apps;
//                            LinkedIn sends `applicationId` query param in
//                            that case. Same-app deployments can ignore.
//
// Sources:
//   - https://learn.microsoft.com/en-us/linkedin/shared/api-guide/webhook-validation
//
// Notes:
//   - HTTPS-only in production (LinkedIn refuses non-HTTPS callbacks).
//     For local dev behind a Cloudflare tunnel, the tunnel terminates TLS.
//   - ngrok URLs are NOT supported by LinkedIn.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { redactError } from '@/server/_redact'

const CHALLENGE_TIMEOUT_MS = 2_500

function getClientSecret(applicationId?: string): string | null {
  // Parent-child apps: LinkedIn sends `applicationId` query param indicating
  // which app's clientSecret to use. The challenged app could be either
  // the parent OR a child. For now we only support a single app — the
  // applicationId is logged for visibility but the same LINKEDIN_CLIENT_SECRET
  // is used unconditionally.
  void applicationId
  const raw = process.env.LINKEDIN_CLIENT_SECRET
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

// Hex-encoded HMACSHA256 — exactly the format LinkedIn expects (no
// 'sha256=' / 'hmacsha256=' prefix; that prefix only appears on the
// notification POST's X-LI-Signature header).
function hmacHex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

// Notification dedup — in-memory ring buffer keyed by Notification ID.
// 5,000 entries × ~36 chars = trivial memory footprint. Survives the
// process lifetime; a restart can re-process a notification, which is
// acceptable per LinkedIn's "at-least-once" delivery contract — your
// downstream handlers should be idempotent anyway.
const DEDUP_RING_SIZE = 5_000
const seenNotificationIds: string[] = []
const seenNotificationIdsSet = new Set<string>()

function alreadyProcessed(notificationId: string): boolean {
  if (seenNotificationIdsSet.has(notificationId)) return true
  seenNotificationIds.push(notificationId)
  seenNotificationIdsSet.add(notificationId)
  if (seenNotificationIds.length > DEDUP_RING_SIZE) {
    const evicted = seenNotificationIds.shift()
    if (evicted !== undefined) seenNotificationIdsSet.delete(evicted)
  }
  return false
}

function extractNotificationId(payload: unknown): string | null {
  // LinkedIn payload shape varies by event type. Common locations:
  //   payload.id
  //   payload.notificationId
  //   payload.eventId
  //   payload.activity.id   (LeadSync style)
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  for (const key of ['id', 'notificationId', 'eventId']) {
    const v = p[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  const activity = p.activity
  if (activity && typeof activity === 'object') {
    const a = activity as Record<string, unknown>
    if (typeof a.id === 'string' && a.id.length > 0) return a.id
  }
  return null
}

export const Route = createFileRoute('/api/linkedin/webhook')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Challenge validation flow. Must complete within 3s end-to-end
        // for LinkedIn to accept the response.
        const startedAt = Date.now()
        try {
          const url = new URL(request.url)
          const challengeCode = url.searchParams.get('challengeCode')
          const applicationId =
            url.searchParams.get('applicationId') ?? undefined

          if (!challengeCode || challengeCode.length === 0) {
            return json({ error: 'Missing challengeCode' }, { status: 400 })
          }

          const secret = getClientSecret(applicationId)
          if (!secret) {
            return json(
              {
                error:
                  'LINKEDIN_CLIENT_SECRET is not configured. Webhook validation cannot proceed.',
              },
              { status: 503 },
            )
          }

          const challengeResponse = hmacHex(challengeCode, secret)

          // If we're getting close to the 3s deadline, bail with a 504 so
          // LinkedIn doesn't silently mark us as failed-but-200.
          if (Date.now() - startedAt > CHALLENGE_TIMEOUT_MS) {
            return json(
              {
                error: 'Challenge response computation exceeded budget',
              },
              { status: 504 },
            )
          }

          return json(
            {
              challengeCode,
              challengeResponse,
            },
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        } catch (err) {
          return json(
            { error: `Challenge handler error: ${redactError(err)}` },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        // Notification flow. Verify X-LI-Signature, deduplicate, return 2xx.
        try {
          const rawSig = request.headers.get('X-LI-Signature')
          if (!rawSig) {
            return json(
              { error: 'Missing X-LI-Signature header' },
              { status: 401 },
            )
          }
          // LinkedIn sends `hmacsha256=<hex>` as the header value.
          const prefix = 'hmacsha256='
          if (!rawSig.startsWith(prefix)) {
            return json(
              { error: 'X-LI-Signature prefix is malformed' },
              { status: 401 },
            )
          }
          const expectedHex = rawSig.slice(prefix.length).trim().toLowerCase()
          if (!/^[a-f0-9]{64}$/.test(expectedHex)) {
            return json(
              { error: 'X-LI-Signature hex is malformed' },
              { status: 401 },
            )
          }

          const secret = getClientSecret()
          if (!secret) {
            return json(
              {
                error:
                  'LINKEDIN_CLIENT_SECRET is not configured. Signature cannot be verified.',
              },
              { status: 503 },
            )
          }

          // Read the raw body for HMAC — must use the EXACT bytes LinkedIn
          // signed, not a re-stringified JSON.
          const rawBody = await request.text()
          const actualHex = hmacHex(rawBody, secret)

          // Constant-time compare to defeat timing side-channels. Both
          // buffers must be the same length for timingSafeEqual.
          const expectedBuf = Buffer.from(expectedHex, 'hex')
          const actualBuf = Buffer.from(actualHex, 'hex')
          if (
            expectedBuf.length !== actualBuf.length ||
            !timingSafeEqual(expectedBuf, actualBuf)
          ) {
            return json(
              { error: 'X-LI-Signature does not match computed HMAC' },
              { status: 401 },
            )
          }

          // Parse the body AFTER signature validation. Until we've verified
          // authenticity, treat the bytes as untrusted.
          let payload: unknown
          try {
            payload = JSON.parse(rawBody) as unknown
          } catch {
            return json({ error: 'Body is not valid JSON' }, { status: 400 })
          }

          // Deduplicate — LinkedIn occasionally double-delivers.
          const notificationId = extractNotificationId(payload)
          if (notificationId && alreadyProcessed(notificationId)) {
            return json(
              { ok: true, deduplicated: true, notificationId },
              { status: 200 },
            )
          }

          // TODO: persist to `audit.linkedin_webhook_events` for the UI's
          // "recent events" panel. For now, log the notification id only
          // (never the payload — it may contain PII or member data).
          if (typeof console !== 'undefined') {
            console.info('[linkedin-webhook] notification received', {
              notificationId: notificationId ?? 'unknown',
            })
          }

          return json(
            {
              ok: true,
              notificationId: notificationId ?? null,
            },
            { status: 200 },
          )
        } catch (err) {
          return json(
            { error: `Webhook handler error: ${redactError(err)}` },
            { status: 500 },
          )
        }
      },
    },
  },
})
