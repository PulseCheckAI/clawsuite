/**
 * octogent-api.ts — same-origin client for the proxied Octogent terminal API.
 *
 * All requests go through the PulseOS dashboard proxy (PROXY_ROUTES in
 * src/server/security-headers.mjs):
 *   prefix '/octogent/api', stripPrefix '/octogent' → upstream /api/...
 *   auth: true (session cookie), ws: true (the /ws sub-path streams).
 *
 * Conventions mirror gateway-api.ts: AbortController + timeout, readError(),
 * ok-false handling, same-origin credentials. Throws Error on failure so React
 * Query / callers can surface the message.
 *
 * Scope note: these endpoints operate ONLY on Octogent terminal IDs
 * (kind:'octogent' pucks). Gateway sessions and cron jobs live in a disjoint
 * id namespace and MUST NOT be passed here — see fake_to_avoid in the spec.
 */

const OCTOGENT_BASE = '/octogent'

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>
    if (typeof payload.error === 'string') return payload.error
    if (typeof payload.message === 'string') return payload.message
    return JSON.stringify(payload)
  } catch {
    const text = await response.text().catch(() => '')
    return text || response.statusText || 'Octogent request failed'
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

async function ogPost<T>(
  path: string,
  body: Record<string, unknown> | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${OCTOGENT_BASE}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    > & { ok?: boolean; error?: string }
    if (!response.ok || payload.ok === false) {
      const message =
        typeof payload.error === 'string' && payload.error.trim().length > 0
          ? payload.error
          : await readError(response)
      throw new Error(message)
    }
    return payload as T
  } catch (error) {
    if (isAbortError(error)) throw new Error('Request timed out')
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

// ── Spawn a NEW terminal at a department ────────────────────────────────────
// POST /octogent/api/terminals → upstream POST /api/terminals.
// tentacleId targets the department/scope; this SPAWNS a fresh agent there
// (never moves/teleports an existing one — tentacleId is immutable upstream).
export type SpawnTerminalInput = {
  workspaceMode: 'shared' | 'worktree'
  tentacleId?: string
  initialPrompt?: string
  displayName?: string
}

export type SpawnTerminalResponse = {
  ok?: boolean
  error?: string
  // Upstream returns the created terminal snapshot; shape is best-effort.
  terminal?: { id?: string; displayName?: string; tentacleId?: string | null }
  id?: string
  [key: string]: unknown
}

export async function spawnTerminal(
  input: SpawnTerminalInput,
): Promise<SpawnTerminalResponse> {
  const body: Record<string, unknown> = {
    workspaceMode: input.workspaceMode,
  }
  if (input.tentacleId) body.tentacleId = input.tentacleId
  if (input.initialPrompt && input.initialPrompt.trim())
    body.initialPrompt = input.initialPrompt.trim()
  if (input.displayName && input.displayName.trim())
    body.displayName = input.displayName.trim()
  return ogPost<SpawnTerminalResponse>('/api/terminals', body, 30_000)
}

// ── Stop / Kill a terminal ──────────────────────────────────────────────────
export type TerminalActionResponse = {
  ok?: boolean
  error?: string
  [key: string]: unknown
}

export async function stopTerminal(
  terminalId: string,
): Promise<TerminalActionResponse> {
  return ogPost<TerminalActionResponse>(
    `/api/terminals/${encodeURIComponent(terminalId)}/stop`,
    undefined,
    12_000,
  )
}

export async function killTerminal(
  terminalId: string,
): Promise<TerminalActionResponse> {
  return ogPost<TerminalActionResponse>(
    `/api/terminals/${encodeURIComponent(terminalId)}/kill`,
    undefined,
    12_000,
  )
}

// ── Channel message (octogent-puck "steer when idle") ───────────────────────
// POST /octogent/api/channels/:id/messages → upstream /api/channels/:id/messages.
// Delivery is best-effort: the upstream only delivers when the target agent is
// next idle. Callers MUST surface that constraint in the UI (no fake "sent").
export type ChannelMessageResponse = {
  ok?: boolean
  error?: string
  [key: string]: unknown
}

export async function sendChannelMessage(
  channelId: string,
  content: string,
  fromTerminalId?: string,
): Promise<ChannelMessageResponse> {
  const body: Record<string, unknown> = { content }
  if (fromTerminalId) body.fromTerminalId = fromTerminalId
  return ogPost<ChannelMessageResponse>(
    `/api/channels/${encodeURIComponent(channelId)}/messages`,
    body,
    12_000,
  )
}
