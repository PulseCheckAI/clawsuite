// ── voice-api browser client ────────────────────────────────────────────────
// Typed wrapper around /api/voice-engine/* — the TanStack Start server-side
// proxy that attaches the HMAC + X-Org-Id voice-engine expects. The browser
// NEVER sees those secrets; we ride the existing session cookie.
//
// Errors:
//   - Network failures throw VoiceApiError(status: 0)
//   - HTTP non-2xx throw VoiceApiError(status, detail)
//     The `detail` is the engine's `{detail: "..."}` body when present, or
//     the raw text body otherwise. NEVER swallowed.
// ────────────────────────────────────────────────────────────────────────────

// ── Schema types (mirror voice-engine pydantic + table columns) ────────────
//
// Kept narrow — additive fields the engine adds later just appear as unknown
// extras on the row (we use `extends Record<string, unknown>` for response
// shapes so a new column doesn't make the dashboard refuse to render).

export interface VoiceCallRow extends Record<string, unknown> {
  id: string
  organization_id: string
  lead_id: string | null
  phone: string | null
  scenario_id: string | null
  transport: string | null
  direction: 'outbound' | 'inbound' | null
  status:
    | 'pending'
    | 'placed'
    | 'connected'
    | 'completed'
    | 'failed'
    | 'gated_refused'
    | string
  refusal_reason: string | null
  overlay: Record<string, unknown> | null
  per_call_overlay: Record<string, unknown> | null
  twilio_call_sid: string | null
  duration_seconds: number | null
  audio_url: string | null
  whisper_verify_result: WhisperVerifyResult | null
  transcript: Array<TranscriptMessage> | null
  created_at: string // ISO 8601
  updated_at: string | null
}

export interface WhisperVerifyResult {
  passed: boolean
  similarity?: number | null
  detail?: string | null
}

export interface TranscriptMessage {
  role: 'caller' | 'agent' | 'system' | string
  text: string
  ts?: string // ISO 8601 if engine provides it
}

export interface PlaceCallRequest {
  lead_id: string
  organization_id: string
  phone: string // E.164
  scenario_id?: string | null
  overlay?: Record<string, unknown> | null
  transport?: 'twilio' | 'livekit' | string
}

export interface PlaceCallResponse {
  call_id: string | null
  status: string
  refusal_reason?: string | null
}

export interface ListCallsFilters {
  org?: string
  status?: VoiceCallRow['status']
  direction?: VoiceCallRow['direction']
  limit?: number
  offset?: number
}

export interface ListCallsResponse {
  calls: Array<VoiceCallRow>
  limit: number
  offset: number
  count: number
}

export interface VoiceScenarioRow extends Record<string, unknown> {
  id: string
  organization_id: string
  name: string
  description: string | null
  overlay: Record<string, unknown>
  created_at: string
  updated_at: string | null
}

export interface CreateScenarioRequest {
  organization_id: string
  name: string
  description?: string | null
  overlay: Record<string, unknown>
}

export interface UpdateScenarioRequest {
  name?: string
  description?: string | null
  overlay?: Record<string, unknown>
}

export interface PromoteScenarioRequest {
  name: string
  description?: string | null
}

export interface PromoteScenarioResponse {
  scenario_id: string | null
  name: string | null
}

export interface BuiltinVoice {
  id?: string
  name?: string
  [extra: string]: unknown
}

export interface ClonedVoiceRow extends Record<string, unknown> {
  id: string
  organization_id: string
  display_name: string
  source_path: string
  consent_recorded_at: string
  created_at: string
}

/**
 * Canonical public.voice_library row shape per migration
 * 20260525180000_voice_hub_foundation.sql. NOTE: voice-engine still writes
 * `source_path` (drift vs migration `source_audio_url`); both keys are
 * optional here so either upstream shape parses cleanly. The dashboard
 * prefers source_audio_url then falls back to source_path. */
export interface VoiceLibraryRow extends Record<string, unknown> {
  id: string
  organization_id: string
  display_name: string
  voice_id?: string | null // provider-side handle (e.g. Hume custom voice id)
  source_audio_url?: string | null // canonical column
  source_path?: string | null // drift alias (voice-engine writes this)
  consent_recorded_at: string // ISO 8601
  consent_recorded_by?: string | null
  created_at: string // ISO 8601
}

/** Per-org voice hub settings, persisted in
 * public.organizations.voice_config (jsonb). All keys are optional so the
 * settings page can ship a draft that only sets some of them. */
export interface OrgVoiceConfig {
  default_provider?: 'voice-engine' | 'hume-evi' | 'grok'
  default_voice_id?: string | null
  default_scenario_id?: string | null
  tcpa_outbound_window?: {
    start: string // "HH:MM"
    end: string // "HH:MM"
  } | null
  max_call_seconds?: number
  /** Per-org allowlist of outcome slugs that count as "success" when
   * computing per-scenario success_rate. Each entry must match
   * /^[a-z0-9_]{1,32}$/. When unset / empty / malformed, the performance
   * endpoint falls back to ['completed', 'success', 'booked']. */
  success_outcomes?: Array<string>
  // jsonb is open-shape -- any extra keys the org stores survive a save.
  [extra: string]: unknown
}

export interface ListVoicesResponse {
  kokoro: Array<BuiltinVoice>
  xtts: Array<BuiltinVoice>
  cloned: Array<ClonedVoiceRow>
}

export interface CloneVoiceRequest {
  organization_id: string
  display_name: string
  source_audio_b64?: string
  source_audio_url?: string
  consent_recorded_at: string // ISO 8601
}

export interface VoiceConfigResponse {
  organization_id: string
  voice_config: Record<string, unknown>
}

export interface UpdateVoiceConfigRequest {
  patch: Record<string, unknown>
}

// ── AI Customizer (Groq-direct) ─────────────────────────────────────────────
//
// Shape mirrors the Zod schema in
// src/routes/api/voice-engine/customize-scenario.ts. Keep them in sync — the
// server is the source of truth; this typedef just shadows it.

export interface AIScenarioDraft {
  name: string
  description: string
  opening_line: string
  objective: string
  success_criteria: string
  tone: string
  voice_id: string
  max_duration_seconds: number
  allowed_tools: Array<string>
}

export interface CustomizeScenarioRequest {
  prompt: string
  currentScenario?: Record<string, unknown>
}

export interface CustomizeScenarioResponse {
  ok: true
  scenario: AIScenarioDraft
  raw: string
}

// ── Phase 5: scenario performance + improvement suggestions ────────────────
//
// Shapes mirror the JSON returned by:
//   /api/voice-engine/scenarios/$id/performance           (GET)
//   /api/voice-engine/scenarios/$id/suggest-improvements  (POST)
// Both endpoints set ok: true on success and ok: false with an error string
// on failure. We keep the optimistic shape here -- the request helper throws
// VoiceApiError on non-2xx so callers only see the success shape.

export interface ScenarioPerformance {
  ok: true
  scenario_id: string
  window_days: number
  total_calls: number
  by_outcome: Record<string, number>
  success_rate: number // 0..1
  avg_duration_seconds: number
  median_duration_seconds: number
  deflection_count: number
  /** Pre-tool filler figure-swap tally. SEPARATE signal from
   * deflection_count — never collapse the two. deflection_count = the
   * faithfulness gate refused the final data turn. filler_swap_count = the
   * gate replaced a number in the pre-tool filler with a neutral phrase,
   * and the actual tool call still ran (benign hygiene). Old voice-engine
   * builds or pre-2026-05-25 rows that lack the column coalesce to 0 in
   * the aggregator. */
  filler_swap_count: number
  /** The outcome allowlist used to compute success_rate for this response.
   * Sourced from organizations.voice_config.success_outcomes when set,
   * else the engine's default set. UI uses this to tell the operator
   * what counts as success right now. */
  success_outcomes: Array<string>
  last_updated: string // ISO 8601
  window_complete: boolean
}

export interface ScenarioSuggestion {
  ok: true
  current: VoiceScenarioRow & Record<string, unknown>
  suggested: VoiceScenarioRow & Record<string, unknown>
  rationale: string
  change_summary: string
  window_days: number
  total_calls_considered: number
  transcripts_used: boolean
}

export interface SuggestImprovementsRequest {
  days: number
  maxTranscriptsPerOutcome: number
}

// ── Error type ──────────────────────────────────────────────────────────────

export class VoiceApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? `voice-api error (status ${status})`)
    this.name = 'VoiceApiError'
    this.status = status
    this.detail = detail
  }
}

// ── Internals ───────────────────────────────────────────────────────────────

function joinQuery(filters: Record<string, unknown> | undefined): string {
  if (!filters) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  let body: BodyInit | undefined
  if (init?.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers,
      body: body ?? init?.body,
      credentials: 'same-origin',
    })
  } catch (e) {
    throw new VoiceApiError(
      0,
      e instanceof Error ? e.message : String(e),
      `network failure calling ${path}`,
    )
  }
  const contentType = res.headers.get('content-type') ?? ''
  const parsed: unknown = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text()
  if (!res.ok) {
    const detail =
      parsed &&
      typeof parsed === 'object' &&
      'detail' in (parsed as Record<string, unknown>)
        ? (parsed as { detail: unknown }).detail
        : parsed
    throw new VoiceApiError(
      res.status,
      detail,
      `voice-api ${path} → ${res.status}`,
    )
  }
  return parsed as T
}

// ── Public client ───────────────────────────────────────────────────────────

export class VoiceApiClient {
  private readonly basePath: string

  constructor(basePath = '/api/voice-engine') {
    this.basePath = basePath.replace(/\/$/, '')
  }

  // ── calls ────────────────────────────────────────────────────────────────

  placeCall(req: PlaceCallRequest): Promise<PlaceCallResponse> {
    return request<PlaceCallResponse>(`${this.basePath}/calls`, {
      method: 'POST',
      json: req,
    })
  }

  getCall(id: string): Promise<VoiceCallRow> {
    return request<VoiceCallRow>(
      `${this.basePath}/calls/${encodeURIComponent(id)}`,
    )
  }

  listCalls(filters?: ListCallsFilters): Promise<ListCallsResponse> {
    return request<ListCallsResponse>(
      `${this.basePath}/calls${joinQuery(filters as Record<string, unknown>)}`,
    )
  }

  promoteScenario(
    callId: string,
    req: PromoteScenarioRequest,
  ): Promise<PromoteScenarioResponse> {
    return request<PromoteScenarioResponse>(
      `${this.basePath}/calls/${encodeURIComponent(callId)}/promote-scenario`,
      { method: 'POST', json: req },
    )
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  listScenarios(orgId?: string): Promise<{
    scenarios: Array<VoiceScenarioRow>
    limit: number
    offset: number
    count: number
  }> {
    return request(`${this.basePath}/scenarios${joinQuery({ org: orgId })}`)
  }

  createScenario(req: CreateScenarioRequest): Promise<VoiceScenarioRow> {
    return request<VoiceScenarioRow>(`${this.basePath}/scenarios`, {
      method: 'POST',
      json: req,
    })
  }

  getScenario(id: string): Promise<VoiceScenarioRow> {
    return request<VoiceScenarioRow>(
      `${this.basePath}/scenarios/${encodeURIComponent(id)}`,
    )
  }

  updateScenario(
    id: string,
    patch: UpdateScenarioRequest,
  ): Promise<VoiceScenarioRow> {
    return request<VoiceScenarioRow>(
      `${this.basePath}/scenarios/${encodeURIComponent(id)}`,
      { method: 'PUT', json: patch },
    )
  }

  deleteScenario(
    id: string,
  ): Promise<{ deleted: boolean; scenario_id: string }> {
    return request(`${this.basePath}/scenarios/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  // ── voices ───────────────────────────────────────────────────────────────

  listVoices(orgId?: string): Promise<ListVoicesResponse> {
    return request<ListVoicesResponse>(
      `${this.basePath}/voices${joinQuery({ org: orgId })}`,
    )
  }

  /** JSON-body clone (legacy shape) — voice-engine's CloneVoiceBody
   * pydantic model. Kept for callers that already pre-encoded the audio. */
  cloneVoice(req: CloneVoiceRequest): Promise<ClonedVoiceRow> {
    return request<ClonedVoiceRow>(`${this.basePath}/voices`, {
      method: 'POST',
      json: req,
    })
  }

  /** Phase 4 multipart upload — pass a FormData with fields:
   *   audio       File   (wav or mp3, max 10MB)
   *   name        string ([A-Za-z0-9 _-]{2,64})
   *   provider    'hume' | 'xtts'
   *   description string (optional, max 600 chars)
   *
   * Sends to /api/voice-engine/voices/clone, which validates, base64-encodes
   * the audio, and forwards to voice-engine's /voices/clone (which itself
   * uploads to portable-tts and inserts a public.voice_library row).
   * Returns the new row. */
  async cloneVoiceMultipart(formData: FormData): Promise<VoiceLibraryRow> {
    let res: Response
    try {
      res = await fetch(`${this.basePath}/voices/clone`, {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
        // NOTE: do NOT set Content-Type -- the browser sets the multipart
        // boundary automatically. Setting it manually corrupts the body.
      })
    } catch (e) {
      throw new VoiceApiError(
        0,
        e instanceof Error ? e.message : String(e),
        'network failure calling /voices/clone',
      )
    }
    const contentType = res.headers.get('content-type') ?? ''
    const parsed: unknown = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text()
    if (!res.ok) {
      const detail =
        parsed &&
        typeof parsed === 'object' &&
        ('error' in (parsed as Record<string, unknown>) ||
          'detail' in (parsed as Record<string, unknown>))
          ? ((parsed as { error?: unknown; detail?: unknown }).error ??
            (parsed as { detail?: unknown }).detail)
          : parsed
      throw new VoiceApiError(
        res.status,
        detail,
        `voice-api /voices/clone → ${res.status}`,
      )
    }
    return parsed as VoiceLibraryRow
  }

  /** Phase 4 preview synthesis. Returns the audio bytes as a Blob ready
   * to feed into URL.createObjectURL() + <audio src=...>. The server
   * looks up the voice (tenant-scoped through voice-engine), calls
   * portable-tts for synthesis, and pipes the raw bytes back. */
  async previewVoice(id: string, text: string): Promise<Blob> {
    const qs = new URLSearchParams({ text })
    let res: Response
    try {
      res = await fetch(
        `${this.basePath}/voices/${encodeURIComponent(id)}/preview?${qs.toString()}`,
        { credentials: 'same-origin' },
      )
    } catch (e) {
      throw new VoiceApiError(
        0,
        e instanceof Error ? e.message : String(e),
        'network failure calling /voices/.../preview',
      )
    }
    if (!res.ok) {
      // Server returns JSON {error: "..."} for error cases; surface the
      // detail so the dashboard can render it inline.
      const contentType = res.headers.get('content-type') ?? ''
      const parsed: unknown = contentType.includes('application/json')
        ? await res.json().catch(() => null)
        : await res.text()
      const detail =
        parsed &&
        typeof parsed === 'object' &&
        ('error' in (parsed as Record<string, unknown>) ||
          'detail' in (parsed as Record<string, unknown>))
          ? ((parsed as { error?: unknown; detail?: unknown }).error ??
            (parsed as { detail?: unknown }).detail)
          : parsed
      throw new VoiceApiError(
        res.status,
        detail,
        `voice-api preview → ${res.status}`,
      )
    }
    return await res.blob()
  }

  getVoiceConfig(orgId: string): Promise<VoiceConfigResponse> {
    return request<VoiceConfigResponse>(
      `${this.basePath}/org/${encodeURIComponent(orgId)}/voice-config`,
    )
  }

  updateVoiceConfig(
    orgId: string,
    patch: UpdateVoiceConfigRequest,
  ): Promise<VoiceConfigResponse> {
    return request<VoiceConfigResponse>(
      `${this.basePath}/org/${encodeURIComponent(orgId)}/voice-config`,
      { method: 'PUT', json: patch },
    )
  }

  /** Phase 4 typed convenience: fetch the org's voice_config narrowed
   * to OrgVoiceConfig. The underlying column is jsonb so unknown extras
   * survive (see [extra: string]: unknown on OrgVoiceConfig). */
  async getOrgVoiceConfig(orgId: string): Promise<OrgVoiceConfig> {
    const res = await this.getVoiceConfig(orgId)
    return (res.voice_config ?? {}) as OrgVoiceConfig
  }

  /** Phase 4 typed convenience: full-replace the org's voice_config.
   * voice-engine's PUT is a MERGE (jsonb concat), so to truly replace we
   * send the full document; the merge semantics are what enable
   * "discard" -> "save again" without losing unrelated keys. */
  async setOrgVoiceConfig(
    orgId: string,
    config: OrgVoiceConfig,
  ): Promise<OrgVoiceConfig> {
    const res = await this.updateVoiceConfig(orgId, {
      patch: config as Record<string, unknown>,
    })
    return (res.voice_config ?? {}) as OrgVoiceConfig
  }

  // ── AI Customizer (Groq-direct) ──────────────────────────────────────────
  // Calls /api/voice-engine/customize-scenario which itself forwards to Groq
  // server-side (key never reaches the browser). The server returns a
  // Zod-validated AIScenarioDraft; we just shape the request payload.

  customizeScenario(
    prompt: string,
    current?: Record<string, unknown>,
  ): Promise<CustomizeScenarioResponse> {
    const body: CustomizeScenarioRequest = { prompt }
    if (current !== undefined) body.currentScenario = current
    return request<CustomizeScenarioResponse>(
      `${this.basePath}/customize-scenario`,
      { method: 'POST', json: body },
    )
  }

  // ── Phase 5: performance + suggestion writeback loop ────────────────────
  //
  // getScenarioPerformance: aggregate outcomes over the last N days for a
  // single scenario. Server filters voice_calls.scenario_id and computes
  // success_rate / avg_duration / deflection_count from the raw rows.
  //
  // suggestScenarioImprovements: Groq-powered scenario tuning. Server pulls
  // recent transcripts grouped by outcome and asks the model for a minimal
  // edit; returns {current, suggested, rationale, change_summary} that the
  // UI side-by-side-diff can render. The operator must explicitly hit Apply
  // to write the suggested shape back via updateScenario().

  getScenarioPerformance(
    scenarioId: string,
    days: number,
  ): Promise<ScenarioPerformance> {
    const qs = joinQuery({ days })
    return request<ScenarioPerformance>(
      `${this.basePath}/scenarios/${encodeURIComponent(scenarioId)}/performance${qs}`,
    )
  }

  suggestScenarioImprovements(
    scenarioId: string,
    opts: SuggestImprovementsRequest,
  ): Promise<ScenarioSuggestion> {
    return request<ScenarioSuggestion>(
      `${this.basePath}/scenarios/${encodeURIComponent(scenarioId)}/suggest-improvements`,
      {
        method: 'POST',
        json: {
          days: opts.days,
          max_transcripts_per_outcome: opts.maxTranscriptsPerOutcome,
        },
      },
    )
  }
}

/** Shared client instance — same surface as every other dashboard module's
 * api-client pattern (e.g. cron-api.ts, gateway-api.ts). */
export const voiceApi = new VoiceApiClient()

// ── Media (remotion-studio render server) ───────────────────────────────────
//
// Lives in this file (not a sibling media-api.ts) so the dashboard has ONE
// browser client module. The mediaApi const is namespace-scoped exactly
// like voiceApi — same import path (@/lib/voice-api), same error type
// (VoiceApiError), same `request()` helper for non-blob calls.
//
// Why no fresh module: keeps mental model lean — every typed proxy lives
// at @/lib/voice-api, regardless of which sidecar it talks to. The
// /api/media/* routes themselves remain physically separate from
// /api/voice-engine/*, so the boundary stays clean at the HTTP layer.
//
// Composition catalog: mirrored as a string literal type so the form code
// gets autocomplete without importing the zod schema from
// os/remotion-studio (which lives in a separate package).

export type CompositionId =
  | 'MarginLeakRecap'
  | 'WeeklyKpiRecap'
  | 'OutreachHook'

/** Job ring-buffer row from render.mjs (see render.mjs:47-58). started_at
 * + finished_at are Date.now() milliseconds (NOT ISO strings) — the UI's
 * relative-time formatter must handle both. */
export interface RenderJob extends Record<string, unknown> {
  id: string // RFC4122 v4 UUID
  composition_id: CompositionId | string
  status: 'queued' | 'rendering' | 'done' | 'failed' | string
  url?: string | null // e.g. "/renders/MarginLeakRecap-<uuid>.mp4"
  error?: string | null
  started_at: number // unix ms
  finished_at?: number | null // unix ms; absent while queued/rendering
}

export type RenderServiceStatus = 'up' | 'down' | 'degraded'

export interface ListWalkthroughsResponse {
  jobs: Array<RenderJob>
  render_service_status: RenderServiceStatus
  /** Present when render_service_status === 'degraded' (upstream returned
   * non-2xx) or 'down' (network failure). */
  upstream_status?: number
  upstream_body?: string | null
  error?: string
}

export interface RenderWalkthroughRequest {
  composition_id: CompositionId
  props: Record<string, unknown>
  output_format?: 'mp4'
}

export interface RenderWalkthroughResponse {
  job_id: string
  status: 'queued'
}

export interface RenderStatusResponse {
  /** Job id when the upstream returned a job row; absent on the synthetic
   * 'unknown' degraded shape that mediaApi.getRenderStatus emits when the
   * render service is unreachable. */
  id?: string
  /** 'unknown' is the synthetic value mediaApi.getRenderStatus returns
   * when the dedicated /render-status proxy answers 503 (render service
   * down). It is NEVER emitted by the render server itself; callers can
   * branch on it to render a degraded state without try/catch ceremony. */
  status: RenderJob['status'] | 'unknown'
  url?: string | null
  error?: string | null
}

// ── Render-server WebSocket event stream ────────────────────────────────────
//
// Push channel that replaces the 5s /jobs poll + the 1.5s /jobs/:id poll.
// Wire shape mirrors render.mjs's broadcasts at /jobs/subscribe (see file
// header). Browser-side wrapper is mediaApi.subscribeToJobs() below; the
// route file at /api/media/subscribe (when wired) proxies the upgrade.
//
// Fallback path: when the WS handshake fails (no proxy on this dashboard
// build, render server down, or origin policy mismatch) the helper falls
// back to the 5s poll on listWalkthroughs() so the panel still updates,
// degraded. It retries the WS upgrade in the background every 30s and
// switches over seamlessly when it lands.

export type JobStreamEvent =
  | { type: 'snapshot'; jobs: Array<RenderJob> }
  | { type: 'job'; job: RenderJob }
  | { type: 'heartbeat'; ts: string }
  | { type: 'shutdown' }
  | { type: 'pong' }
  | { type: 'error'; code: string }

export interface JobSubscriptionOptions {
  /** Override the WS URL. Default = same-origin proxy at
   * `${location.origin}/api/media/subscribe` (ws/wss derived from page
   * scheme). Tests + power users can point this directly at the render
   * server (`ws://127.0.0.1:8140/jobs/subscribe`). */
  url?: string
  /** Override the fallback REST polling interval. */
  pollIntervalMs?: number
}

export class MediaApiClient {
  private readonly basePath: string

  constructor(basePath = '/api/media') {
    this.basePath = basePath.replace(/\/$/, '')
  }

  /** Full walkthrough list + render service status pill data. NEVER
   * throws on render-server-down: the server returns 200 with an empty
   * jobs[] + render_service_status='down' so the panel can render. Only
   * a true non-2xx from OUR proxy (e.g. 401 unauth) throws VoiceApiError. */
  listWalkthroughs(): Promise<ListWalkthroughsResponse> {
    return request<ListWalkthroughsResponse>(`${this.basePath}/walkthroughs`)
  }

  renderWalkthrough(
    input: RenderWalkthroughRequest,
  ): Promise<RenderWalkthroughResponse> {
    return request<RenderWalkthroughResponse>(`${this.basePath}/render`, {
      method: 'POST',
      json: input,
    })
  }

  /** Per-job status. Hits the dedicated /api/media/render-status/:jobId
   * proxy (NOT the cached /walkthroughs list-poll) so callers get the
   * live upstream value, not a 5s-stale snapshot.
   *
   * Endpoint contract:
   *   * 2xx → upstream { id, status, url?, error? } pass-through.
   *   * 404 → upstream said "no such job" (aged out of the 200-item
   *     ring buffer). Throws VoiceApiError(404) so callers branch.
   *   * 503 → render service unreachable. Returns the synthetic
   *     { status: 'unknown', error: 'service_unreachable' } shape so
   *     the UI can render a degraded state WITHOUT a try/catch ceremony.
   *
   * Path is /render-status/ (not /walkthroughs/$id or /status/$id) to
   * avoid colliding with the existing /api/media/status/$jobId, which
   * is wired to the Wan2GP adapter (unrelated job system). */
  async getRenderStatus(jobId: string): Promise<RenderStatusResponse> {
    try {
      return await request<RenderStatusResponse>(
        `${this.basePath}/render-status/${encodeURIComponent(jobId)}`,
      )
    } catch (e) {
      if (e instanceof VoiceApiError && e.status === 503) {
        // Degraded shape — caller can switch on `status === 'unknown'`
        // and render "render service offline" without unwrapping a
        // thrown error.
        return { status: 'unknown', error: 'service_unreachable' }
      }
      throw e
    }
  }

  /** Browser-side helper for <video src=…> and <a download href=…>.
   * Returns the same-origin path that hits stream.$jobId.ts. */
  streamUrl(jobId: string): string {
    return `${this.basePath}/stream/${encodeURIComponent(jobId)}`
  }

  /** Cheap liveness ping — listWalkthroughs() already returns
   * render_service_status so the status pill can derive from that, but a
   * standalone /health is useful for the "Refresh service" diagnostic. */
  async renderHealth(): Promise<{ ok: boolean }> {
    try {
      const list = await this.listWalkthroughs()
      return { ok: list.render_service_status === 'up' }
    } catch {
      return { ok: false }
    }
  }

  /**
   * Subscribe to job-lifecycle events from the render server's WebSocket
   * push channel. Returns an unsubscribe fn that tears down the WS, any
   * reconnect timers, and the fallback poller.
   *
   * Behaviour:
   *   * On open                  → drains a snapshot event to handler
   *   * On every status change   → 'job' event (queued → rendering → done|failed)
   *   * On a 60s heartbeat gap   → forces reconnect (renders/heartbeat is 30s,
   *                                so two missed beats = router/proxy went away)
   *   * On WS handshake failure  → falls back to listWalkthroughs() polling and
   *                                attempts WS reconnect every 30s
   *   * On server shutdown frame → waits 2s, reconnects with exponential backoff
   *
   * Handler MUST be idempotent on a 'job' event for the same id (upsert,
   * don't append); the server resends queued/rendering states freely.
   */
  subscribeToJobs(
    handler: (event: JobStreamEvent) => void,
    opts: JobSubscriptionOptions = {},
  ): () => void {
    const url = opts.url ?? defaultJobsSubscribeUrl()
    const pollMs = opts.pollIntervalMs ?? 5_000

    let stopped = false
    let ws: WebSocket | null = null
    let backoffMs = 2_000
    const MAX_BACKOFF_MS = 30_000
    let heartbeatTimer: number | null = null
    let reconnectTimer: number | null = null
    let pollTimer: number | null = null
    let usingFallbackPoll = false

    const clearHeartbeat = () => {
      if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer)
        heartbeatTimer = null
      }
    }
    const armHeartbeat = () => {
      clearHeartbeat()
      // 60s gap (two missed 30s beats) → force reconnect.
      heartbeatTimer = window.setTimeout(() => {
        try {
          ws?.close(4000, 'heartbeat-timeout')
        } catch {
          /* socket already gone */
        }
      }, 60_000)
    }
    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }
    const clearPoll = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
      usingFallbackPoll = false
    }

    const startFallbackPoll = () => {
      if (usingFallbackPoll || stopped) return
      usingFallbackPoll = true
      const tick = async () => {
        if (stopped) return
        try {
          const res = await this.listWalkthroughs()
          handler({ type: 'snapshot', jobs: res.jobs })
        } catch {
          /* keep trying — fallback poller must not throw */
        }
      }
      void tick()
      pollTimer = window.setInterval(tick, pollMs)
    }

    const connect = () => {
      if (stopped) return
      clearReconnect()
      let next: WebSocket
      try {
        next = new WebSocket(url)
      } catch {
        // Constructor throw (e.g. malformed URL) → fall back + retry.
        startFallbackPoll()
        reconnectTimer = window.setTimeout(connect, MAX_BACKOFF_MS)
        return
      }
      ws = next

      next.onopen = () => {
        backoffMs = 2_000 // reset backoff on healthy open
        clearPoll() // WS took over; drop the fallback path
        armHeartbeat()
      }
      next.onmessage = (ev) => {
        let msg: JobStreamEvent
        try {
          msg = JSON.parse(
            typeof ev.data === 'string' ? ev.data : '',
          ) as JobStreamEvent
        } catch {
          return // server should never send non-JSON; ignore
        }
        if (msg.type === 'heartbeat') armHeartbeat()
        handler(msg)
        if (msg.type === 'shutdown') {
          // Server going away — let it close us; we'll reconnect on close.
          try {
            next.close(1000, 'server-shutdown')
          } catch {
            /* already closing */
          }
        }
      }
      next.onerror = () => {
        // Don't act here; close handler does the retry/fallback logic.
      }
      next.onclose = () => {
        clearHeartbeat()
        ws = null
        if (stopped) return
        // While we're disconnected, keep the panel alive via REST.
        startFallbackPoll()
        // Exponential backoff, capped at 30s.
        const wait = backoffMs
        backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2)
        reconnectTimer = window.setTimeout(connect, wait)
      }
    }

    connect()

    return () => {
      stopped = true
      clearReconnect()
      clearHeartbeat()
      clearPoll()
      try {
        ws?.close(1000, 'client-unsubscribe')
      } catch {
        /* socket already gone */
      }
      ws = null
    }
  }
}

/** Resolve the same-origin proxy URL for the render-server jobs subscribe
 * channel. Uses wss:// when the page is https, ws:// otherwise. */
function defaultJobsSubscribeUrl(): string {
  if (typeof window === 'undefined') {
    // SSR path — not used (the subscribe call is browser-only) but keep
    // safe so any accidental import-time access doesn't crash.
    return 'ws://127.0.0.1:3010/api/media/subscribe'
  }
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/api/media/subscribe`
}

export const mediaApi = new MediaApiClient()
