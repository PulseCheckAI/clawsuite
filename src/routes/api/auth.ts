import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import {
  verifyPassword,
  generateSessionToken,
  storeSessionToken,
  createSessionCookie,
  isPasswordProtectionEnabled,
  getSessionTokenFromCookie,
  revokeSessionToken,
} from '../../server/auth-middleware'
import {
  isMultiUserEnabled,
  verifyUserCredentials,
  attachSessionUser,
} from '../../server/auth-users'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

const AuthSchema = z.object({
  // email is used only in multi-user mode; the legacy shared-password flow omits it.
  email: z.string().email().max(320).optional(),
  password: z.string().max(1000),
})

export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        // If password protection is disabled, reject auth attempts
        if (!isPasswordProtectionEnabled()) {
          return json(
            { ok: false, error: 'Authentication not required' },
            { status: 400 },
          )
        }

        // Rate limit: max 5 auth attempts per minute per IP
        const ip = getClientIp(request)
        if (!rateLimit(`auth:${ip}`, 5, 60_000)) {
          return rateLimitResponse()
        }

        try {
          const raw = await request.json().catch(() => ({}))
          const parsed = AuthSchema.safeParse(raw)

          if (!parsed.success) {
            return json(
              { ok: false, error: 'Invalid request' },
              { status: 400 },
            )
          }

          const { email, password } = parsed.data

          // Multi-user mode: verify the user's own email + password via Supabase
          // Auth, then mint our opaque session token + attach identity/role/org.
          if (isMultiUserEnabled() && email) {
            const user = await verifyUserCredentials(email, password)
            if (!user) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
              return json(
                { ok: false, error: 'Invalid credentials' },
                { status: 401 },
              )
            }
            const token = generateSessionToken()
            storeSessionToken(token)
            attachSessionUser(token, user)
            return json(
              { ok: true, user: { email: user.email, role: user.role } },
              {
                status: 200,
                headers: { 'Set-Cookie': createSessionCookie(token) },
              },
            )
          }

          // Legacy shared-password flow (perimeter / break-glass).
          // Verify password
          const valid = verifyPassword(password)

          if (!valid) {
            // Add small delay to prevent brute force
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return json(
              { ok: false, error: 'Invalid password' },
              { status: 401 },
            )
          }

          // Generate session token
          const token = generateSessionToken()
          storeSessionToken(token)

          // Return success with Set-Cookie header
          return json(
            { ok: true },
            {
              status: 200,
              headers: {
                'Set-Cookie': createSessionCookie(token),
              },
            },
          )
        } catch (err) {
          if (import.meta.env.DEV) console.error('[/api/auth] Error:', err)
          return json(
            { ok: false, error: 'Authentication failed' },
            { status: 500 },
          )
        }
      },
      // Logout — revoke the session token + clear the auth cookie.
      DELETE: async ({ request }) => {
        const token = getSessionTokenFromCookie(request.headers.get('cookie'))
        if (token) revokeSessionToken(token)
        return json(
          { ok: true },
          {
            status: 200,
            headers: {
              'Set-Cookie':
                'clawsuite-auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
            },
          },
        )
      },
    },
  },
})
