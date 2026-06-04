// ── /api/twilio/hume-voice — Twilio voice webhook proxy → Hume phone relay ─
// Twilio number's Voice URL (set in Twilio Console) points here. We:
//   1. Validate X-Twilio-Signature against TWILIO_AUTH_TOKEN (HMAC-SHA1 of
//      `${publicUrl}${k1}${v1}${k2}${v2}...` over alphabetically-sorted form
//      params).  Forged requests never reach the relay.
//   2. Forward the original urlencoded body + headers to the local phone
//      relay (127.0.0.1:8211/twiml).  The relay re-validates with the same
//      shared secret as defence-in-depth (configured via the same
//      TWILIO_AUTH_TOKEN env on its side).
//   3. Return the relay's TwiML response verbatim (Content-Type: text/xml).
//
// Auth model: no dashboard session check — Twilio is the principal here,
// authenticated by the HMAC signature.
// ────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto'

import { createFileRoute } from '@tanstack/react-router'

const PHONE_RELAY_URL = (
  process.env.HUME_PHONE_RELAY_URL?.trim() || 'http://127.0.0.1:8211'
).replace(/\/$/, '')

const FORWARD_TIMEOUT_MS = 8_000

/**
 * Verify Twilio's HMAC-SHA1 request signature.
 *
 * Twilio signs:  publicUrl  +  concat(sortedKeys, value) of form fields.
 * Reference: https://www.twilio.com/docs/usage/security#validating-requests
 */
function verifyTwilioSignature(opts: {
  authToken: string
  signature: string
  publicUrl: string
  form: Record<string, string>
}): boolean {
  const sortedKeys = Object.keys(opts.form).sort()
  let payload = opts.publicUrl
  for (const k of sortedKeys) payload += k + opts.form[k]
  const expected = createHmac('sha1', opts.authToken)
    .update(Buffer.from(payload, 'utf-8'))
    .digest('base64')
  const a = Buffer.from(expected, 'utf-8')
  const b = Buffer.from(opts.signature, 'utf-8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function publicUrlFromRequest(request: Request): string {
  // Prefer an explicit PUBLIC_DASHBOARD_URL so we validate against the same
  // URL Twilio actually hit (cloudflared origin), not the local host.
  const explicit = process.env.PUBLIC_DASHBOARD_URL?.trim()
  if (explicit) {
    return `${explicit.replace(/\/$/, '')}/api/twilio/hume-voice`
  }
  // Fallback: trust X-Forwarded-Proto/Host (cloudflared sets these).
  const proto =
    request.headers.get('x-forwarded-proto') ||
    new URL(request.url).protocol.replace(':', '')
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    new URL(request.url).host
  return `${proto}://${host}/api/twilio/hume-voice`
}

export const Route = createFileRoute('/api/twilio/hume-voice')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || ''
        const skipValidation =
          process.env.SKIP_TWILIO_VALIDATION?.toLowerCase() === 'true'

        // Read raw body once — we need it both for signature validation and
        // for the forwarded POST. (Twilio sends application/x-www-form-urlencoded.)
        const bodyText = await request.text()
        const form: Record<string, string> = {}
        for (const [k, v] of new URLSearchParams(bodyText)) form[k] = v

        if (!skipValidation) {
          if (!authToken) {
            console.error('[twilio/hume-voice] TWILIO_AUTH_TOKEN unset')
            return new Response('twilio auth not configured', { status: 500 })
          }
          const signature = request.headers.get('x-twilio-signature') || ''
          if (!signature) {
            return new Response('missing x-twilio-signature', { status: 403 })
          }
          const ok = verifyTwilioSignature({
            authToken,
            signature,
            publicUrl: publicUrlFromRequest(request),
            form,
          })
          if (!ok) {
            console.warn('[twilio/hume-voice] invalid signature, refusing')
            return new Response('invalid signature', { status: 403 })
          }
        }

        // Forward to the local phone relay. Pass the original signature
        // header through so the relay can re-validate (defence in depth)
        // and the original Content-Type so its form parser works.
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS)
        let relayRes: Response
        try {
          relayRes = await fetch(`${PHONE_RELAY_URL}/twiml`, {
            method: 'POST',
            headers: {
              'Content-Type':
                request.headers.get('content-type') ||
                'application/x-www-form-urlencoded',
              'X-Twilio-Signature':
                request.headers.get('x-twilio-signature') || '',
              // Tell the relay which public URL Twilio hit so its own
              // signature validation passes (it would otherwise see
              // 127.0.0.1:8211 and reject).
              'X-Original-Url': publicUrlFromRequest(request),
            },
            body: bodyText,
            signal: controller.signal,
          })
        } catch (err) {
          console.error('[twilio/hume-voice] relay fetch failed:', err)
          // Return a safe TwiML so the caller doesn't hear silence.
          const apology =
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<Response><Say>We are sorry, our voice system is temporarily unavailable. Please try again shortly.</Say><Hangup /></Response>'
          return new Response(apology, {
            status: 200,
            headers: { 'Content-Type': 'text/xml' },
          })
        } finally {
          clearTimeout(timer)
        }

        const relayBody = await relayRes.text()
        return new Response(relayBody, {
          status: relayRes.status,
          headers: {
            'Content-Type': relayRes.headers.get('content-type') || 'text/xml',
          },
        })
      },
    },
  },
})
