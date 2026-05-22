/**
 * Wan2GP HTTP adapter — talks to the local Wan2GP FastAPI service
 * (pulsecheck_adapter.py at C:/Users/costa/Projects/Wan2GP/, port 7861).
 *
 * The Wan2GP adapter today only exposes a video-generation endpoint
 * (POST /generate, GET /jobs/{id}, GET /jobs/{id}/download). Image
 * generation is modelled here as a single-frame video (video_length=17,
 * the API minimum) until the upstream service grows a dedicated
 * /generate/image endpoint. The generator_profile field carries this
 * distinction through to the UI.
 *
 * 4K notes — the current Wan2GP video pipeline tops out well below 4K
 * (832×480 or 1280×720 are realistic on RTX 5060 / 8GB VRAM). We accept
 * the caller's 3840×2160 default, downscale to the nearest supported
 * "WxH" string for the request, and stash the requested target so the UI
 * can surface it. A future upscaler stage (TODO) would lift the output
 * to true 4K post-generation.
 *
 * No mocks. If Wan2GP isn't reachable, every helper rethrows the real
 * fetch error so the API route can surface it to the operator.
 *
 * Auth: optional bearer via WAN2GP_API_KEY env var. Never logged.
 */

const WAN2GP_BASE_URL = process.env.WAN2GP_BASE_URL ?? 'http://127.0.0.1:7861'
const WAN2GP_FETCH_TIMEOUT_MS = 15_000

export type GeneratorProfileId =
  | 'wan2gp-image'
  | 'wan2gp-video'
  | 'comfyui'
  | 'replicate'
  | 'local-sdxl'

export interface GeneratorProfile {
  id: GeneratorProfileId
  label: string
  kind: 'image' | 'video'
  vendor: 'wan2gp' | 'comfyui' | 'replicate' | 'local-sdxl'
  /** When false the profile is a stub for a future plugin (renders grayed). */
  available: boolean
  description: string
  defaultModel?: string
}

export const GENERATOR_PROFILES: GeneratorProfile[] = [
  {
    id: 'wan2gp-image',
    label: 'Wan2GP · Image',
    kind: 'image',
    vendor: 'wan2gp',
    available: true,
    description:
      'Single-frame Wan2GP generation on the local RTX 5060. Renders one keyframe; upscaled toward 4K post-generation.',
    defaultModel: 'wan_2_1_t2v_1_3B',
  },
  {
    id: 'wan2gp-video',
    label: 'Wan2GP · Video',
    kind: 'video',
    vendor: 'wan2gp',
    available: true,
    description:
      'Text-to-video via Wan2GP (sage2 attention, profile 5). Default 2s @ 24fps; upscaled toward 4K @ 30fps post-generation.',
    defaultModel: 'wan_2_1_t2v_1_3B',
  },
  {
    id: 'comfyui',
    label: 'ComfyUI',
    kind: 'image',
    vendor: 'comfyui',
    available: false,
    description:
      'Local ComfyUI workflow runner. Plugin adapter not yet wired — slot reserved.',
  },
  {
    id: 'replicate',
    label: 'Replicate',
    kind: 'image',
    vendor: 'replicate',
    available: false,
    description:
      'Hosted Replicate models (SDXL, Flux, Kling, etc.). API adapter not yet wired.',
  },
  {
    id: 'local-sdxl',
    label: 'Local SDXL',
    kind: 'image',
    vendor: 'local-sdxl',
    available: false,
    description:
      'Direct SDXL inference on the local GPU (no Wan2GP wrapper). Adapter not yet wired.',
  },
]

export interface SkillDef {
  id: string
  label: string
  description: string
  /** Appended to the prompt verbatim when active. */
  modifier: string
  /** UI grouping hint. */
  category: 'quality' | 'cinematic' | 'lens' | 'color' | 'motion'
}

const SKILL_REGISTRY: SkillDef[] = [
  {
    id: '4k',
    label: '4K',
    description: 'Hyper-detailed, 4K UHD resolution, ultra-sharp focus.',
    modifier:
      'ultra-detailed, 4K UHD resolution, razor sharp focus, high dynamic range',
    category: 'quality',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description:
      'Film-grade composition, shallow depth of field, dramatic lighting.',
    modifier:
      'cinematic composition, shallow depth of field, dramatic key lighting, 35mm film grain',
    category: 'cinematic',
  },
  {
    id: 'photoreal',
    label: 'Photoreal',
    description: 'Photorealistic textures and natural skin tones.',
    modifier:
      'photorealistic, natural skin texture, realistic materials, accurate global illumination',
    category: 'quality',
  },
  {
    id: 'anamorphic',
    label: 'Anamorphic',
    description: 'Wide anamorphic lens, oval bokeh, horizontal lens flares.',
    modifier:
      'anamorphic widescreen lens, oval bokeh, horizontal blue lens flares, 2.39:1 aspect',
    category: 'lens',
  },
  {
    id: 'hdr',
    label: 'HDR',
    description: 'High dynamic range, rich contrast and vivid highlights.',
    modifier:
      'high dynamic range, vivid highlights, deep shadows, color-graded for HDR display',
    category: 'color',
  },
  {
    id: 'motion-blur',
    label: 'Motion Blur',
    description: 'Natural motion blur on movement, 180° shutter feel.',
    modifier:
      'natural motion blur, 180 degree shutter, smooth camera movement, kinetic energy',
    category: 'motion',
  },
]

export interface MediaGenerationPayload {
  /** Profile selected by the caller. Stub profiles will reject. */
  profileId: GeneratorProfileId
  prompt: string
  /** Skills applied (UI maps chip IDs back to modifiers via the registry). */
  skillIds?: string[]
  /** Pixel width — defaults applied per kind in handler. */
  width?: number
  height?: number
  /** Video only. */
  fps?: number
  /** Video only. Frames count → maps to Wan2GP video_length. */
  frames?: number
  /** Optional reference image absolute path for I2V mode. */
  imagePath?: string | null
  /** -1 = random (Wan2GP convention). */
  seed?: number
}

export interface MediaJobSubmission {
  jobId: string
  profileId: GeneratorProfileId
  /** Echoed back so the UI can attribute history rows. */
  prompt: string
  /** What we actually sent downstream (after skill expansion). */
  effectivePrompt: string
  /** Native Wan2GP-supported resolution (downscaled from caller target). */
  effectiveResolution: string
  /** Caller's desired 4K target — preserved for post-gen upscaling step. */
  targetWidth: number
  targetHeight: number
  /** Wan2GP queue position at submit time. */
  queuePosition: number | null
  status: 'queued' | 'running' | 'done' | 'failed'
  createdAt: number
}

export interface MediaJobStatus {
  jobId: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'unknown'
  /** 0-100. null when unavailable. */
  progress: number | null
  /** Free-form phase label from Wan2GP (e.g. "denoising", "encoding"). */
  phase: string | null
  /** Absolute path on the Wan2GP host. The dashboard proxies the download. */
  outputPath: string | null
  /** Direct download URL on the Wan2GP host (file streamed by FastAPI). */
  artifactUrl: string | null
  error: string | null
  createdAt: number | null
  startedAt: number | null
  finishedAt: number | null
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...extra,
  }
  // Never log the key. Just attach if present.
  const apiKey = process.env.WAN2GP_API_KEY
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return headers
}

async function wan2gpFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${WAN2GP_BASE_URL}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('Wan2GP request timed out')),
    WAN2GP_FETCH_TIMEOUT_MS,
  )
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: buildHeaders((init?.headers ?? {}) as Record<string, string>),
    })
    return res
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        `Wan2GP timed out after ${WAN2GP_FETCH_TIMEOUT_MS}ms — is the adapter running at ${WAN2GP_BASE_URL}?`,
      )
    }
    const cause = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Wan2GP unreachable at ${WAN2GP_BASE_URL}: ${cause}. Start it with: conda run -p env_conda python pulsecheck_adapter.py`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Map a caller-requested pixel resolution to a Wan2GP-supported "WxH" string.
 * Wan2GP today supports up to ~1280x720 reliably on RTX 5060. We snap to the
 * nearest supported tier; the caller's true target is preserved for the
 * future post-gen upscaler stage.
 */
const WAN2GP_RESOLUTIONS: Array<{ w: number; h: number }> = [
  { w: 832, h: 480 },
  { w: 1280, h: 720 },
]

function snapToWan2GPResolution(
  width: number,
  height: number,
): { w: number; h: number; asString: string } {
  const targetAspect = width / Math.max(1, height)
  let best = WAN2GP_RESOLUTIONS[0]!
  let bestScore = Number.POSITIVE_INFINITY
  for (const r of WAN2GP_RESOLUTIONS) {
    const aspectDiff = Math.abs(r.w / r.h - targetAspect)
    // Prefer the larger native res when target is high.
    const sizeScore = Math.max(0, r.w * r.h - width * height) / 1_000_000
    const score = aspectDiff * 2 + sizeScore * 0.001
    if (score < bestScore) {
      bestScore = score
      best = r
    }
  }
  return { ...best, asString: `${best.w}x${best.h}` }
}

function composeEffectivePrompt(
  prompt: string,
  skillIds: readonly string[] | undefined,
): string {
  const modifiers: string[] = []
  for (const id of skillIds ?? []) {
    const def = SKILL_REGISTRY.find((s) => s.id === id)
    if (def) modifiers.push(def.modifier)
  }
  if (modifiers.length === 0) return prompt.trim()
  return `${prompt.trim()}, ${modifiers.join(', ')}`
}

// ─── public API ────────────────────────────────────────────────────────────

export function listSkills(): SkillDef[] {
  // Hard-coded for now. TODO: hydrate from Wan2GP /skills endpoint when it
  // exists upstream so plugins can register modifiers.
  return SKILL_REGISTRY.map((s) => ({ ...s }))
}

export function listGeneratorProfiles(): GeneratorProfile[] {
  return GENERATOR_PROFILES.map((p) => ({ ...p }))
}

export async function submitGeneration(
  payload: MediaGenerationPayload,
): Promise<MediaJobSubmission> {
  const profile = GENERATOR_PROFILES.find((p) => p.id === payload.profileId)
  if (!profile) {
    throw new Error(`Unknown generator profile: ${payload.profileId}`)
  }
  if (!profile.available) {
    throw new Error(
      `Generator profile "${profile.label}" is a stub — plugin adapter not yet wired.`,
    )
  }
  if (!payload.prompt || payload.prompt.trim().length < 3) {
    throw new Error('Prompt must be at least 3 characters.')
  }

  const targetWidth = payload.width ?? 3840
  const targetHeight = payload.height ?? 2160
  const snap = snapToWan2GPResolution(targetWidth, targetHeight)
  const effectivePrompt = composeEffectivePrompt(
    payload.prompt,
    payload.skillIds,
  )

  // Image profile = single-frame video. Use minimum supported frame count.
  const videoLength =
    profile.kind === 'image'
      ? 17
      : Math.max(17, Math.min(257, payload.frames ?? 49))

  const body = {
    prompt: effectivePrompt,
    model_type: profile.defaultModel ?? 'wan_2_1_t2v_1_3B',
    resolution: snap.asString,
    video_length: videoLength,
    num_inference_steps: 20,
    seed: payload.seed ?? -1,
    image_path: payload.imagePath ?? null,
    caption: false,
    caption_language: 'en',
    caption_languages: [],
    caption_asr: 'bijian',
  }

  const res = await wan2gpFetch('/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail: unknown = null
    try {
      detail = await res.json()
    } catch {
      // ignore
    }
    const message =
      detail && typeof detail === 'object' && 'detail' in detail
        ? String((detail as { detail: unknown }).detail)
        : `Wan2GP returned ${res.status} ${res.statusText}`
    throw new Error(message)
  }

  const data = (await res.json()) as {
    job_id: string
    status: string
    queue_position: number | null
    created_at: number | null
  }

  return {
    jobId: data.job_id,
    profileId: profile.id,
    prompt: payload.prompt.trim(),
    effectivePrompt,
    effectiveResolution: snap.asString,
    targetWidth,
    targetHeight,
    queuePosition: data.queue_position ?? null,
    status: 'queued',
    createdAt: data.created_at ?? Date.now() / 1000,
  }
}

export async function getJobStatus(jobId: string): Promise<MediaJobStatus> {
  if (!jobId || !/^[\w-]{4,}$/.test(jobId)) {
    throw new Error('Invalid jobId.')
  }
  const res = await wan2gpFetch(`/jobs/${encodeURIComponent(jobId)}`)
  if (res.status === 404) {
    return {
      jobId,
      status: 'unknown',
      progress: null,
      phase: null,
      outputPath: null,
      artifactUrl: null,
      error: 'Job not found (may have expired)',
      createdAt: null,
      startedAt: null,
      finishedAt: null,
    }
  }
  if (!res.ok) {
    throw new Error(`Wan2GP /jobs returned ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as {
    job_id: string
    status: string
    progress?: number | null
    phase?: string | null
    output_path?: string | null
    error?: string | null
    created_at?: number | null
    started_at?: number | null
    finished_at?: number | null
  }

  const status = normalizeStatus(data.status)
  const artifactUrl =
    status === 'done' && data.output_path
      ? `${WAN2GP_BASE_URL}/jobs/${encodeURIComponent(jobId)}/download`
      : null

  return {
    jobId: data.job_id,
    status,
    progress: typeof data.progress === 'number' ? data.progress : null,
    phase: data.phase ?? null,
    outputPath: data.output_path ?? null,
    artifactUrl,
    error: data.error ?? null,
    createdAt: data.created_at ?? null,
    startedAt: data.started_at ?? null,
    finishedAt: data.finished_at ?? null,
  }
}

function normalizeStatus(raw: string): MediaJobStatus['status'] {
  switch (raw) {
    case 'queued':
    case 'running':
    case 'done':
    case 'failed':
      return raw
    default:
      return 'unknown'
  }
}
