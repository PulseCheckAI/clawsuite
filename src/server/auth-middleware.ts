import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Matches the cookie Max-Age (createSessionCookie below). Tokens beyond this
// are invalidated even if the Map entry sticks around momentarily.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * In-memory session store. Map of token → expiresAtMs.
 * For production with multiple instances, consider Redis or a database.
 */
const validTokens = new Map<string, number>()

// ── Optional durable sessions (integrity audit D1) ───────────────────────────
// By default sessions live only in memory, so a restart/reboot logs everyone
// out. Set CLAWSUITE_PERSIST_SESSIONS=1 (production only) to flush the token map
// to a 0600 file so the 30-day sessions survive a restart. Strictly best-effort
// and graceful: ANY file error falls back to in-memory behavior, so it can never
// regress auth. Never active under `vite` (build/dev).
const isViteRuntime =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv.some((a) => a.includes('vite'))
const SESSION_PERSIST =
  typeof process !== 'undefined' &&
  process.env.CLAWSUITE_PERSIST_SESSIONS === '1' &&
  process.env.NODE_ENV === 'production' &&
  !isViteRuntime
const SESSION_FILE =
  (typeof process !== 'undefined' && process.env.CLAWSUITE_SESSION_FILE) ||
  join(homedir(), '.clawsuite-sessions.json')

let flushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSessionFlush(): void {
  if (!SESSION_PERSIST || flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      const now = Date.now()
      const obj: Record<string, number> = {}
      for (const [token, exp] of validTokens) if (exp > now) obj[token] = exp
      writeFileSync(SESSION_FILE, JSON.stringify(obj), { mode: 0o600 })
    } catch {
      // best-effort only; never throw from the auth path
    }
  }, 1000)
  if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref()
}

// Rehydrate persisted sessions on startup (prod + flag only; graceful).
if (SESSION_PERSIST) {
  try {
    const obj = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Record<
      string,
      number
    >
    const now = Date.now()
    for (const [token, exp] of Object.entries(obj)) {
      if (typeof exp === 'number' && exp > now) validTokens.set(token, exp)
    }
  } catch {
    // no file / unreadable / bad JSON → start empty (in-memory behavior)
  }
}

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
  scheduleSessionFlush()
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
  scheduleSessionFlush()
}

// Startup-time validation: refuse to START in production without a password set,
// otherwise every authenticated route would be silently public. This must fire at
// SERVER RUNTIME (node dist/server/server.js) but NOT during `vite build`, which
// also evaluates server modules with NODE_ENV=production — exiting there would
// abort the build. Detect the vite build/dev process via argv and skip then.
const isViteProcess =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv.some((a) => a.includes('vite'))

if (
  typeof process !== 'undefined' &&
  process.env.NODE_ENV === 'production' &&
  !process.env.CLAWSUITE_PASSWORD &&
  !isViteProcess
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
