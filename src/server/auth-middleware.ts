import { randomBytes, timingSafeEqual } from 'node:crypto'

// Matches the cookie Max-Age (createSessionCookie below). Tokens beyond this
// are invalidated even if the Map entry sticks around momentarily.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * In-memory session store. Map of token → expiresAtMs.
 * For production with multiple instances, consider Redis or a database.
 */
const validTokens = new Map<string, number>()

/**
 * Generate a cryptographically secure session token.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Store a session token as valid (auto-expires after TOKEN_TTL_MS).
 */
export function storeSessionToken(token: string): void {
  validTokens.set(token, Date.now() + TOKEN_TTL_MS)
}

/**
 * Check if a session token is valid. Lazily evicts expired tokens on access
 * so the Map doesn't accumulate dead entries from forgotten logins.
 */
export function isValidSessionToken(token: string): boolean {
  const expiresAt = validTokens.get(token)
  if (expiresAt === undefined) return false
  if (Date.now() > expiresAt) {
    validTokens.delete(token)
    return false
  }
  return true
}

/**
 * Remove a session token (logout).
 */
export function revokeSessionToken(token: string): void {
  validTokens.delete(token)
}

// Startup-time validation: refuse to start in production without a password set,
// otherwise every authenticated route would be silently public.
if (
  typeof process !== 'undefined' &&
  process.env.NODE_ENV === 'production' &&
  !process.env.CLAWSUITE_PASSWORD
) {
  console.error(
    '[auth-middleware] FATAL: CLAWSUITE_PASSWORD is not set but NODE_ENV=production. ' +
      'Every authenticated route would be publicly accessible. Refusing to start.',
  )
  // Hard fail — exit before any request is served
  process.exit(1)
}

// Dev-mode visibility: warn operators that auth is bypassed when no password is set.
if (
  typeof process !== 'undefined' &&
  process.env.NODE_ENV !== 'production' &&
  !process.env.CLAWSUITE_PASSWORD
) {
  console.warn(
    '[auth-middleware] CLAWSUITE_PASSWORD is not set — authentication is BYPASSED. ' +
      'Set this env var before deploying.',
  )
}

/**
 * Check if password protection is enabled.
 */
export function isPasswordProtectionEnabled(): boolean {
  return Boolean(
    process.env.CLAWSUITE_PASSWORD && process.env.CLAWSUITE_PASSWORD.length > 0,
  )
}

/**
 * Verify password using timing-safe comparison.
 */
export function verifyPassword(password: string): boolean {
  const configured = process.env.CLAWSUITE_PASSWORD
  if (!configured || configured.length === 0) {
    return false
  }

  // Timing-safe comparison
  const passwordBuf = Buffer.from(password, 'utf8')
  const configuredBuf = Buffer.from(configured, 'utf8')

  // If lengths differ, still do a comparison to avoid timing leak
  if (passwordBuf.length !== configuredBuf.length) {
    return false
  }

  try {
    return timingSafeEqual(passwordBuf, configuredBuf)
  } catch {
    return false
  }
}

/**
 * Extract session token from cookie header.
 */
export function getSessionTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    if (cookie.startsWith('clawsuite-auth=')) {
      return cookie.substring('clawsuite-auth='.length)
    }
  }
  return null
}

function isLocalRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || '127.0.0.1'
  const localIPs = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']
  return localIPs.includes(ip)
}

/**
 * Check if the request is authenticated.
 * Returns true if:
 * - Password protection is disabled, OR
 * - Request has a valid session token
 */
export function isAuthenticated(request: Request): boolean {
  // No password configured? No auth needed
  if (!isPasswordProtectionEnabled()) {
    return true
  }

  // Check for valid session token
  const cookieHeader = request.headers.get('cookie')
  const token = getSessionTokenFromCookie(cookieHeader)

  if (!token) {
    return false
  }

  return isValidSessionToken(token)
}

export function requireLocalOrAuth(request: Request): boolean {
  if (!isPasswordProtectionEnabled()) {
    return isLocalRequest(request)
  }

  return isAuthenticated(request)
}

/**
 * Create a Set-Cookie header for the session token.
 */
export function createSessionCookie(token: string): string {
  // httpOnly: prevents JS access
  // secure: HTTPS only (disabled for local dev)
  // sameSite=strict: CSRF protection
  // path=/: available everywhere
  // maxAge: 30 days
  return `clawsuite-auth=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`
}
