// ── voice-engine server bridge ──────────────────────────────────────────────
// Single source of truth for talking to pulseos-voice-engine
// (FastAPI on http://127.0.0.1:8130 in prod / pm2). The browser MUST NOT
// hit voice-engine directly — the engine's auth requires HMAC + X-Org-Id
// headers that we never want to ship to the browser. Every voice-hub
// surface goes browser → /api/voice-engine/* → forwardToVoiceEngine() →
// voice-engine.
//
// Auth attached server-side:
//   X-Webhook-Token  : process.env.VOICE_HUB_HMAC_SECRET
//   X-Org-Id         : process.env.VOICE_HUB_ORG_ID
//
// Both required outside DEV. If either is missing in prod we fail-loud with
// a 503 so a misconfigured deploy can't silently mis-route or read the
// wrong tenant.
//
// Body org cross-check: when a forwarded POST/PUT body carries
// `organization_id`, the voice-engine enforces it must match X-Org-Id
// (HMAC path). We pass the body through untouched; mismatch → 403 surfaces
// to the browser as the engine returned it. No transformation done here.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_BASE = 'http://127.0.0.1:8130'

export interface VoiceEngineForwardOpts {
  path: string // e.g. "/api/calls?org=...&limit=50"
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown // serialized as JSON if present
  // Optional per-request timeout (ms). Default 15 s — generous enough for
  // /voices/clone (uploads to portable-tts) without hanging the dashboard
  // if voice-engine itself is wedged.
  timeoutMs?: number
}

export interface VoiceEngineResult {
  status: number
  body: unknown // already-parsed JSON when the engine returned JSON; else string
  contentType: string | null
}

function envBaseUrl(): string {
  const raw = process.env.VOICE_ENGINE_URL?.trim()
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : DEFAULT_BASE
}

function envOrgId(): string | undefined {
  return process.env.VOICE_HUB_ORG_ID?.trim() || undefined
}

function envHmacSecret(): string | undefined {
  return process.env.VOICE_HUB_HMAC_SECRET?.trim() || undefined
}

/** True when forwarding is safe: secret + org are set. Demo (dev) tolerates
 * missing creds — the engine itself runs in `AGENT_MODE=demo` locally. */
export function isVoiceEngineReady():
  | { ok: true }
  | { ok: false; reason: string } {
  const isDev = process.env.NODE_ENV !== 'production'
  if (isDev) return { ok: true }
  if (!envOrgId()) {
    return { ok: false, reason: 'VOICE_HUB_ORG_ID not set' }
  }
  if (!envHmacSecret()) {
    return { ok: false, reason: 'VOICE_HUB_HMAC_SECRET not set' }
  }
  return { ok: true }
}

/**
 * Forward a request to voice-engine and return the parsed result.
 *
 * Never throws on non-2xx from the engine — we propagate {status, body} so
 * the dashboard route can surface refusal_reason / detail strings to the
 * caller. We DO throw on network failure / timeout, because those are not
 * application-level errors the dashboard should retry without operator
 * intervention.
 */
export async function forwardToVoiceEngine(
  opts: VoiceEngineForwardOpts,
): Promise<VoiceEngineResult> {
  const base = envBaseUrl()
  const url = `${base}${opts.path.startsWith('/') ? '' : '/'}${opts.path}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  const orgId = envOrgId()
  const hmac = envHmacSecret()
  if (orgId) headers['X-Org-Id'] = orgId
  if (hmac) headers['X-Webhook-Token'] = hmac

  let bodyInit: BodyInit | undefined
  if (opts.body !== undefined && opts.body !== null) {
    headers['Content-Type'] = 'application/json'
    bodyInit = JSON.stringify(opts.body)
  }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body: bodyInit,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }

  const contentType = res.headers.get('content-type')
  let parsed: unknown
  if (contentType?.includes('application/json')) {
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
  } else {
    parsed = await res.text()
  }
  return { status: res.status, body: parsed, contentType }
}

/** Org id the server is currently bound to (or undefined). The browser
 * client uses this to populate `organization_id` body fields without
 * round-tripping a separate fetch. */
export function getServerOrgId(): string | undefined {
  return envOrgId()
}
