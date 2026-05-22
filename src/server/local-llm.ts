/**
 * Local LLM discovery — Ollama, LM Studio, llama.cpp / OpenAI-compatible runners.
 *
 * Each runner is probed independently with a short timeout. If a runner is
 * unreachable we return an empty `models` array and `reachable: false` rather
 * than throwing, so the UI can render an honest empty state.
 *
 * No model names are fabricated. Only what each runner returns from its own
 * catalog endpoint is surfaced. If `/api/tags` returns `{models: []}` the user
 * sees an empty section with a helper string telling them how to pull a model.
 *
 * Callers:
 *   - src/routes/api/models.ts          — merges local models into /api/models
 *   - src/routes/api/llm/local.ts       — dedicated /api/llm/local endpoint
 */

export type LocalModel = {
  /** Fully-qualified id used by the gateway and downstream pickers, e.g. "ollama/qwen3:32b". */
  id: string
  /** Provider slug — currently "ollama" or "lmstudio". */
  provider: string
  /** Bare model identifier as returned by the runner, e.g. "qwen3:32b". */
  model: string
  /** Friendly display name. */
  displayName: string
  /** Family / parameter-size hint when the runner exposes it. Otherwise omitted. */
  family?: string
}

export type LocalRunnerResult = {
  provider: string
  displayName: string
  baseUrl: string
  reachable: boolean
  /** Empty array on unreachable; never null. */
  models: LocalModel[]
  /** Helper string for the UI when reachable && models.length === 0. */
  emptyHint?: string
  /** Set when reachable === false to describe the failure. Never leaks secrets. */
  error?: string
}

const DISCOVERY_TIMEOUT_MS = 2000

function ollamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434'
}

function lmStudioBaseUrl(): string {
  return process.env.LMSTUDIO_BASE_URL?.trim() || 'http://localhost:1234'
}

/**
 * fetch with AbortSignal.timeout. Returns null on any failure (DNS, ECONNREFUSED,
 * timeout, non-200). Never throws.
 */
async function safeFetch(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    })
    return response.ok ? response : null
  } catch {
    return null
  }
}

// ── Ollama ──────────────────────────────────────────────────────────────────

type OllamaTagEntry = {
  name?: string
  model?: string
  details?: {
    family?: string
    parameter_size?: string
  }
}

type OllamaTagsResponse = {
  models?: OllamaTagEntry[]
}

export async function discoverOllamaModels(): Promise<LocalRunnerResult> {
  const baseUrl = ollamaBaseUrl()
  const provider = 'ollama'
  const displayName = 'Ollama (Local)'

  const response = await safeFetch(`${baseUrl}/api/tags`)
  if (!response) {
    return {
      provider,
      displayName,
      baseUrl,
      reachable: false,
      models: [],
      error: 'Ollama not reachable',
    }
  }

  let payload: OllamaTagsResponse | null = null
  try {
    const raw: unknown = await response.json()
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('models' in raw) ||
      !Array.isArray((raw as { models: unknown }).models)
    ) {
      return {
        provider,
        displayName,
        baseUrl,
        reachable: true,
        models: [],
        error: 'Invalid response from Ollama /api/tags',
      }
    }
    payload = raw as OllamaTagsResponse
  } catch {
    return {
      provider,
      displayName,
      baseUrl,
      reachable: true,
      models: [],
      error: 'Invalid response from Ollama /api/tags',
    }
  }

  const entries = Array.isArray(payload?.models) ? payload.models : []
  const models: LocalModel[] = []
  for (const entry of entries) {
    const modelName = entry.model || entry.name
    if (!modelName) continue
    const family = entry.details?.family
    const params = entry.details?.parameter_size
    const familyLabel = family && params ? `${family} ${params}` : family
    const cleanName = modelName.replace(/:latest$/, '')
    models.push({
      id: `${provider}/${modelName}`,
      provider,
      model: modelName,
      displayName: `Local: ${cleanName}`,
      ...(familyLabel ? { family: familyLabel } : {}),
    })
  }

  return {
    provider,
    displayName,
    baseUrl,
    reachable: true,
    models,
    ...(models.length === 0
      ? {
          emptyHint:
            'No local models. Run `ollama pull <model>` (replace `<model>` with e.g. `qwen3:32b`, `llama3.1:8b`) to populate.',
        }
      : {}),
  }
}

// ── LM Studio (OpenAI-compatible /v1/models) ────────────────────────────────

type OpenAIModelEntry = {
  id?: string
  object?: string
}

type OpenAIModelsResponse = {
  data?: OpenAIModelEntry[]
}

export async function discoverLmStudioModels(): Promise<LocalRunnerResult> {
  const baseUrl = lmStudioBaseUrl()
  const provider = 'lmstudio'
  const displayName = 'LM Studio (Local)'

  const response = await safeFetch(`${baseUrl}/v1/models`)
  if (!response) {
    return {
      provider,
      displayName,
      baseUrl,
      reachable: false,
      models: [],
      error: 'LM Studio not reachable',
    }
  }

  let payload: OpenAIModelsResponse | null = null
  try {
    const raw: unknown = await response.json()
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('data' in raw) ||
      !Array.isArray((raw as { data: unknown }).data)
    ) {
      return {
        provider,
        displayName,
        baseUrl,
        reachable: true,
        models: [],
        error: 'Invalid response from LM Studio /v1/models',
      }
    }
    payload = raw as OpenAIModelsResponse
  } catch {
    return {
      provider,
      displayName,
      baseUrl,
      reachable: true,
      models: [],
      error: 'Invalid response from LM Studio /v1/models',
    }
  }

  const entries = Array.isArray(payload?.data) ? payload.data : []
  const models: LocalModel[] = []
  for (const entry of entries) {
    if (!entry.id) continue
    models.push({
      id: `${provider}/${entry.id}`,
      provider,
      model: entry.id,
      displayName: `Local: ${entry.id}`,
    })
  }

  return {
    provider,
    displayName,
    baseUrl,
    reachable: true,
    models,
    ...(models.length === 0
      ? {
          emptyHint:
            'No models loaded in LM Studio. Open LM Studio and load a model to populate.',
        }
      : {}),
  }
}

// ── Aggregate ───────────────────────────────────────────────────────────────

let cachedDiscovery: { timestamp: number; result: LocalRunnerResult[] } | null =
  null
let inFlightDiscovery: Promise<LocalRunnerResult[]> | null = null
const DISCOVERY_CACHE_TTL_MS = 15_000

/**
 * Discover every configured local runner in parallel. Cached for 15s to avoid
 * hammering the runners on every /api/models call (chat composer, conductor,
 * agent modals all refetch on focus / interval).
 *
 * Concurrency-safe: simultaneous callers during a cache miss share a single
 * in-flight Promise rather than each kicking off their own discovery pass.
 */
export async function discoverAllLocalRunners(
  force = false,
): Promise<LocalRunnerResult[]> {
  const now = Date.now()
  if (
    !force &&
    cachedDiscovery &&
    now - cachedDiscovery.timestamp < DISCOVERY_CACHE_TTL_MS
  ) {
    return cachedDiscovery.result
  }

  if (!force && inFlightDiscovery) {
    return inFlightDiscovery
  }

  inFlightDiscovery = Promise.all([
    discoverOllamaModels(),
    discoverLmStudioModels(),
  ]).finally(() => {
    inFlightDiscovery = null
  })

  const results = await inFlightDiscovery
  cachedDiscovery = { timestamp: Date.now(), result: results }
  return results
}

/**
 * Flatten local-runner results into entries shaped like the gateway's models
 * array (`{id, provider, name}`) so they can be concatenated into /api/models
 * with zero client-side patching.
 */
export function localModelsAsCatalogEntries(
  results: LocalRunnerResult[],
): Array<{ id: string; provider: string; name: string; family?: string }> {
  const out: Array<{
    id: string
    provider: string
    name: string
    family?: string
  }> = []
  for (const runner of results) {
    if (!runner.reachable) continue
    for (const model of runner.models) {
      out.push({
        id: model.id,
        provider: model.provider,
        name: model.displayName,
        ...(model.family ? { family: model.family } : {}),
      })
    }
  }
  return out
}
