// Shared helper — call the Postiz REST API.
// Mirrors the discriminated-result pattern from `linkedin/_mcp.ts` so every
// Postiz API route can reuse it instead of re-implementing fetch + error
// envelopes.
//
// Env vars (read by NAME only — values are never logged):
//   POSTIZ_API_URL  — base URL of the Postiz instance (default http://localhost:5000)
//   POSTIZ_API_KEY  — bearer-style API key from the Postiz admin "API" tab
//
// API contract is taken from https://docs.postiz.com (Public API). The exact
// endpoint paths and response shapes have NOT been validated against a live
// Postiz instance in this sandbox; assumptions are listed in comments at each
// call-site so they're easy to verify when the integration is wired up.
//
// Callers:
//   src/routes/api/postiz/accounts.ts  (GET /public/v1/integrations)
//   src/routes/api/postiz/post.ts      (POST /public/v1/posts)
//   src/routes/api/postiz/scheduled.ts (GET /public/v1/posts)
//   src/routes/api/postiz/analytics.ts (GET /public/v1/analytics)
//
// Failure envelope contract (all callers normalize to this shape before
// returning from the route handler):
//   { ok: false, error: string, hint?: string, accounts?: never[], posts?: never[] }
// `accounts`/`posts` are reserved keys so the typed UI fetchers can rely
// on a stable empty-array fallback on the error path.

import Postiz from '@postiz/node'
import { maskApiKeys } from '@/server/_redact'
import { readToken } from '@/server/postiz-oauth-store'

// Browser-safe platform constants + string helpers live in a sibling module
// so the frontend can import them without dragging postiz-oauth-store →
// node:fs into the Vite bundle. Re-exported below for backwards compatibility
// with existing server callers that import from `./_client`.
import {
  POSTIZ_SUPPORTED_PLATFORMS,
  POSTIZ_FORBIDDEN_PLATFORMS,
  PLATFORM_CHAR_LIMITS,
  isForbiddenPlatform,
  stripLinkedIn,
  getCharLimit,
} from '@/shared/postiz-platforms'
import type { PostizPlatform } from '@/shared/postiz-platforms'

export {
  POSTIZ_SUPPORTED_PLATFORMS,
  POSTIZ_FORBIDDEN_PLATFORMS,
  PLATFORM_CHAR_LIMITS,
  isForbiddenPlatform,
  stripLinkedIn,
  getCharLimit,
}
export type { PostizPlatform }

const DEFAULT_URL = 'http://localhost:5000'
// Postiz Cloud's hosted API. Used as the base URL when an OAuth token is
// present AND POSTIZ_API_URL is not explicitly set. Operators on self-host
// keep POSTIZ_API_URL pointing at their own instance and use POSTIZ_API_KEY.
const DEFAULT_CLOUD_URL = 'https://api.postiz.com'

// Postiz mounts its public API at `/api/public/v1/*` (the NestJS backend is
// reverse-proxied through the Next.js frontend under `/api/*`). Requests sent
// to `/public/v1/*` directly hit the Next.js catchall and return the login
// HTML, which is why the first cut of this client got back `<!DOCTYPE html>`.
// Keep the env var pointing at the host root; this client prepends `/api`.
const API_PREFIX = '/api'

export function getPostizBaseUrl(): string {
  // Strip trailing slashes AND a trailing `/api` if the operator already
  // included it — we'll re-prepend it consistently below.
  //
  // Resolution order:
  //   1. POSTIZ_API_URL if explicitly set (operator override; respected
  //      regardless of OAuth state — useful for staging/test instances).
  //   2. https://api.postiz.com when a Cloud OAuth token is present.
  //   3. http://localhost:5000 as the self-host default.
  const explicit = process.env.POSTIZ_API_URL
  if (typeof explicit === 'string' && explicit.length > 0) {
    return explicit.replace(/\/+$/, '').replace(/\/api$/, '')
  }
  if (readToken() !== null) {
    return DEFAULT_CLOUD_URL
  }
  return DEFAULT_URL.replace(/\/+$/, '').replace(/\/api$/, '')
}

function getPostizApiKey(): string | null {
  // Cloud OAuth token wins if present. The persisted token is read on every
  // call so a Disconnect (DELETE /api/postiz/oauth) takes effect immediately
  // without a process restart.
  const oauth = readToken()
  if (oauth) return oauth.access_token
  // Local self-host static key as fallback.
  const raw = process.env.POSTIZ_API_KEY
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/**
 * SDK-shaped base URL. The `@postiz/node` SDK constructs request URLs as
 * `${path}/public/v1/...` — it does NOT prepend `/api` like our `callPostiz`
 * does. So:
 *   - Postiz Cloud (api.postiz.com) → use the URL as-is.
 *   - Self-host (e.g. http://localhost:5000) → append `/api` so the SDK lands
 *     on the NestJS backend mounted under `/api/public/v1/*` instead of the
 *     Next.js login catchall.
 *
 * Keep this in sync with `getPostizBaseUrl()` + `API_PREFIX` in this file.
 */
function getPostizSdkPath(): string {
  const base = getPostizBaseUrl()
  // URL-aware cloud detection: an operator who sets POSTIZ_API_URL with a
  // trailing slash or an embedded `/api` would bypass exact string-equality.
  // Compare hostnames (case-insensitive) so any URL pointing at api.postiz.com
  // is treated as Cloud (SDK handles routing — no /api prefix needed).
  try {
    const cloudHost = new URL(DEFAULT_CLOUD_URL).hostname.toLowerCase()
    const baseHost = new URL(base).hostname.toLowerCase()
    if (baseHost === cloudHost) return base
  } catch {
    // Malformed base URL — fall through to self-host behavior, matching the
    // pre-URL-aware behavior so we never silently change routing on bad input.
  }
  return `${base}${API_PREFIX}`
}

/**
 * Build a `@postiz/node` SDK client wired to the same auth + base URL the
 * raw `callPostiz` helper uses (OAuth token wins over POSTIZ_API_KEY).
 *
 * Returns `null` when neither credential source is configured — callers
 * should surface the same 503 envelope `callPostiz` does in that case.
 *
 * NOTE: the SDK does NOT throw on non-2xx HTTP responses; it parses the
 * body as JSON and returns whatever shape upstream sent (which could be
 * `{ message, error }` or HTML on a misroute). Callers must defensively
 * inspect the returned value rather than assume the happy-path shape.
 *
 * The Postiz SDK sends `Authorization: <apiKey>` (no `Bearer` prefix),
 * matching Postiz's public-API contract.
 */
// `@postiz/node` ships as CJS with shape `{ __esModule: true, default: <class> }`.
// Vite's SSR CJS interop can hand the default import the module-namespace object
// instead of the class, so `new Postiz()` throws "is not a constructor". Unwrap
// nested `.default` wrappers once at module load until we reach the real ctor.
function resolvePostizCtor(mod: unknown): typeof Postiz {
  let candidate: unknown = mod
  for (let i = 0; i < 3 && candidate && typeof candidate !== 'function'; i++) {
    candidate = (candidate as { default?: unknown }).default
  }
  return candidate as typeof Postiz
}
const PostizCtor = resolvePostizCtor(Postiz)

export function getPostizClient(): Postiz | null {
  const apiKey = getPostizApiKey()
  if (!apiKey) return null
  return new PostizCtor(apiKey, getPostizSdkPath())
}

/**
 * Standard "not configured" envelope used when `getPostizClient()` returns
 * null. Mirrors the shape `callPostiz` returns so route handlers can
 * normalize both paths identically.
 */
export const POSTIZ_NOT_CONFIGURED: PostizCallFailure = {
  ok: false,
  status: 503,
  error:
    'Postiz is not configured. Connect via Postiz Cloud (OAuth) or set POSTIZ_API_KEY for self-host.',
  hint:
    'Start the OAuth flow at /api/postiz/oauth/start, or for self-host ' +
    'generate an API key from the Postiz dashboard → Settings → API and ' +
    'set POSTIZ_API_KEY.',
}

/**
 * Normalize an arbitrary value returned by an SDK method into our standard
 * success/failure envelope.
 *
 * The SDK silently swallows HTTP status — a 4xx/5xx response becomes "just
 * another JSON value". We treat any shape that contains a `message` or
 * `error` string field as a failure (Postiz's standard error envelope), and
 * detect HTML reflections (login-page misroute) the same way `callPostiz`
 * does. Network errors thrown by the SDK are mapped to a 502 failure.
 *
 * WHY the message/error fields alone are sufficient signal: Postiz's
 * documented success response bodies do NOT include a `message` field —
 * `message` and `error` only appear on the standard error envelope. Earlier
 * versions of this function also required `statusCode === null || >= 400`,
 * but that allowed a `{message: '...', statusCode: 200}` response (which
 * Postiz could emit as a partial-success warning) to fall through to the
 * happy path and silently return the error object as if it were data — the
 * UI then saw an empty list with no toast. Treating any string-typed
 * `message`/`error` field as a failure prevents the silent drop.
 */
export function normalizePostizSdkResult<T>(
  value: unknown,
): PostizCallResult<T> {
  if (value === null || value === undefined) {
    return { ok: true, status: 200, data: {} as T }
  }
  // String responses (rare) — could be HTML from a misroute.
  if (typeof value === 'string') {
    const trimmed = value.trimStart().toLowerCase()
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
      return {
        ok: false,
        status: 502,
        error:
          'Postiz returned HTML (login page) instead of JSON. The request reached the Next.js frontend, not the API.',
        hint:
          `Check POSTIZ_API_URL (currently ${getPostizBaseUrl()}) — should be ` +
          'the Postiz host:port WITHOUT /api. Also confirm the API key is ' +
          'valid; an invalid/missing key can trigger the frontend to redirect to login.',
      }
    }
    return { ok: true, status: 200, data: value as unknown as T }
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Postiz error envelopes carry `{ message }` or `{ error }`. These keys
    // do NOT appear on documented success responses, so any non-empty string
    // value is a reliable failure signal — regardless of `statusCode`.
    const hasMessage = typeof obj.message === 'string' && obj.message.length > 0
    const hasErrorField = typeof obj.error === 'string' && obj.error.length > 0
    if (hasMessage || hasErrorField) {
      const message =
        (hasMessage && (obj.message as string)) ||
        (hasErrorField && (obj.error as string)) ||
        'Postiz returned an error envelope'
      const statusCode =
        typeof obj.statusCode === 'number'
          ? obj.statusCode
          : typeof obj.status === 'number'
            ? obj.status
            : null
      return {
        ok: false,
        status: statusCode ?? 502,
        error: maskApiKeys(message).slice(0, 400),
      }
    }
  }
  // Defense-in-depth: mask the success-envelope `data` field. Postiz's
  // documented success response shapes don't carry credentials, but the same
  // mask is applied on every error path here (and in `callPostiz`), and the
  // upstream body has occasionally reflected the API key on weird states
  // (e.g. server-error pages that echo the request headers). The mask is a
  // no-op unless a credential pattern is found — only then do we re-parse.
  const successJson = JSON.stringify(value)
  const masked = maskApiKeys(successJson)
  if (masked !== successJson) {
    try {
      return { ok: true, status: 200, data: JSON.parse(masked) as T }
    } catch {
      // Mask broke valid JSON (rare — only if a credential pattern overlapped
      // structural punctuation). Return the masked string typed as T so the
      // caller still sees no secret leak, even if shape is lossy.
      return { ok: true, status: 200, data: masked as unknown as T }
    }
  }
  return { ok: true, status: 200, data: value as T }
}

/**
 * Convert an SDK call throw (network error, abort, etc.) into our envelope.
 * The SDK's only documented throw path is node-fetch propagating a network
 * error — which is exactly when we want to surface a 502 with the base URL
 * for operator triage.
 */
export function postizSdkError(err: unknown): PostizCallFailure {
  const baseUrl = getPostizBaseUrl()
  const message = err instanceof Error ? err.message : String(err)
  return {
    ok: false,
    status: 502,
    error: `Postiz unreachable at ${baseUrl}: ${maskApiKeys(message)}`,
    hint:
      'Is the Postiz container running and POSTIZ_API_URL set correctly? ' +
      'Default is http://localhost:5000.',
  }
}

export interface PostizCallSuccess<T> {
  ok: true
  data: T
  status: number
}

export interface PostizCallFailure {
  ok: false
  status: number
  error: string
  hint?: string
}

export type PostizCallResult<T> = PostizCallSuccess<T> | PostizCallFailure

/**
 * Call a Postiz REST endpoint. Returns a discriminated result. Never throws.
 *
 * `path` should start with '/' and is appended to POSTIZ_API_URL. Pass body as
 * a plain object — it will be JSON-stringified for non-GET methods.
 *
 * `timeoutMs` defaults to 30s. Use a higher value for uploads or scheduled
 * posts that involve media transcoding on the Postiz side.
 */
export async function callPostiz<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown> | null,
  timeoutMs = 30_000,
): Promise<PostizCallResult<T>> {
  const apiKey = getPostizApiKey()
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error:
        'Postiz is not configured. Connect via Postiz Cloud (OAuth) or set POSTIZ_API_KEY for self-host.',
      hint:
        'Start the OAuth flow at /api/postiz/oauth/start, or for self-host ' +
        'generate an API key from the Postiz dashboard → Settings → API and ' +
        'set POSTIZ_API_KEY.',
    }
  }

  const baseUrl = getPostizBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  // Hoist the /api prefix once so callers can write `/public/v1/...` and we
  // route to the backend (not the Next.js login catchall).
  const finalPath = normalizedPath.startsWith(API_PREFIX)
    ? normalizedPath
    : `${API_PREFIX}${normalizedPath}`
  const url = `${baseUrl}${finalPath}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        // Single header by design. Postiz's public-API README shows
        // `Authorization: <apiKey>` with no `Bearer` prefix as the canonical
        // shape, and that's what we send. Previously we also sent `X-Api-Key`
        // as a belt-and-braces fallback, but two headers carrying the same
        // secret doubles the surface area for accidental reflection in error
        // bodies (server frameworks differ in which header they echo back),
        // so we keep exactly one. If a future Postiz version deprecates this
        // shape, change THIS line — don't add a second header.
        Authorization: apiKey,
        Accept: 'application/json',
        ...(body !== undefined && body !== null
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body:
        body !== undefined && body !== null && method !== 'GET'
          ? JSON.stringify(body)
          : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Postiz unreachable at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      hint:
        'Is the Postiz container running and POSTIZ_API_URL set correctly? ' +
        'Default is http://localhost:5000.',
    }
  }

  // Read body once. Some Postiz endpoints return 204 No Content on success.
  const raw = await response.text().catch(() => '')

  if (!response.ok) {
    // Detect nginx 5xx + HTML — typical signature when Postiz's frontend is
    // up but its backend container is down/unreachable. Translate to a
    // clear, actionable message instead of dumping <html><title>502...</html>
    // into the UI.
    const trimmed = raw.trimStart().toLowerCase()
    const isHtml =
      trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
    if (
      isHtml &&
      (response.status === 502 ||
        response.status === 503 ||
        response.status === 504)
    ) {
      const nginxMatch = raw.match(/nginx\/[\d.]+/i)?.[0]
      return {
        ok: false,
        status: response.status,
        error: `Postiz backend unreachable (HTTP ${response.status} from ${nginxMatch ?? 'reverse proxy'})`,
        hint:
          `The Postiz frontend at ${baseUrl} is up but its backend isn't responding. ` +
          'Common causes: (1) the Postiz backend container is stopped — run `docker compose ps` and start it if needed; ' +
          '(2) the backend is starting up — wait 15-30s and retry; ' +
          '(3) the backend env vars are wrong (DATABASE_URL / REDIS_URL).',
      }
    }
    let hint: string | undefined
    let errorMessage = `Postiz returned HTTP ${response.status}`
    if (raw.length > 0) {
      // Try to extract a Postiz-shaped { message } or { error } envelope.
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const message =
          (typeof parsed.message === 'string' && parsed.message) ||
          (typeof parsed.error === 'string' && parsed.error) ||
          null
        if (message) errorMessage = maskApiKeys(message)
        // Mask before truncation: maskApiKeys() preserves length so the
        // 400-char cap still works, and we don't want to slice through the
        // middle of a credential and leak the tail. Defense-in-depth — the
        // upstream body should never contain our key, but it has happened.
        hint = maskApiKeys(raw).slice(0, 400)
      } catch {
        hint = maskApiKeys(raw).slice(0, 400)
      }
    }
    return { ok: false, status: response.status, error: errorMessage, hint }
  }

  // Empty body → success with empty object.
  if (raw.length === 0) {
    return { ok: true, status: response.status, data: {} as T }
  }

  // Detect HTML response — happens when the request hit the Next.js
  // frontend's catchall (wrong path / wrong base URL / route not mounted)
  // instead of the NestJS API. Surface a clearer error than a JSON parse
  // failure so operators can fix POSTIZ_API_URL quickly.
  const trimmed = raw.trimStart()
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<!doctype')
  ) {
    return {
      ok: false,
      status: 502,
      error:
        'Postiz returned HTML (login page) instead of JSON. The request reached the Next.js frontend, not the API.',
      hint:
        `Check POSTIZ_API_URL (currently ${baseUrl}) — should be the Postiz host:port WITHOUT /api. ` +
        'Also confirm POSTIZ_API_KEY is valid; an invalid/missing key can trigger the frontend to redirect to login.',
    }
  }

  try {
    const data = JSON.parse(raw) as T
    return { ok: true, status: response.status, data }
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Failed to parse Postiz response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      hint: maskApiKeys(raw).slice(0, 400),
    }
  }
}
