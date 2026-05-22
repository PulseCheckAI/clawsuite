// Intel AI provider — local-first via Ollama.
// embed() is REQUIRED for semantic search (nomic-embed-text, 768-dim).
// enrichText() (summary/tags/relevance) is BEST-EFFORT: it needs a generation
// model (INTEL_GEN_MODEL, e.g. 'qwen2.5:3b'); if none is configured/reachable
// it returns nulls so the item still gets embedded + searchable. Phase 2b wires
// a cloud fallback for generation.

const OLLAMA = (
  process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
).replace(/\/+$/, '')
const EMBED_MODEL = process.env.INTEL_EMBED_MODEL || 'nomic-embed-text'
export const EMBED_DIM = 768
const GEN_MODEL = process.env.INTEL_GEN_MODEL || '' // '' = skip generation
const TIMEOUT_MS = 30_000

export interface GenResult {
  summary: string | null
  tags: string[]
  relevance: number | null
}

/** pgvector literal for supabase-js inserts (must be stringified '[a,b,c]'). */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

export function buildEnrichPrompt(
  title: string,
  body: string,
  profile: string,
): string {
  return [
    'You are a feed-intelligence assistant. Return STRICT JSON only:',
    '{"summary":"<=3 sentences","tags":["3-6 lowercase tags"],"relevance":0.0-1.0}',
    `Score relevance against this interest profile: ${profile}`,
    `Title: ${title}`,
    `Body: ${body.slice(0, 4000)}`,
  ].join('\n')
}

export function parseEnrichResponse(raw: string): GenResult {
  try {
    const j = JSON.parse(raw) as {
      summary?: unknown
      tags?: unknown
      relevance?: unknown
    }
    const summary = typeof j.summary === 'string' ? j.summary.trim() : null
    const tags = Array.isArray(j.tags)
      ? j.tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.toLowerCase().trim())
          .filter(Boolean)
          .slice(0, 8)
      : []
    const relevance =
      typeof j.relevance === 'number' && Number.isFinite(j.relevance)
        ? Math.max(0, Math.min(1, j.relevance))
        : null
    return { summary, tags, relevance }
  } catch {
    return { summary: null, tags: [], relevance: null }
  }
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`embed: HTTP ${res.status}`)
  const body = (await res.json()) as { embedding?: number[] }
  if (!Array.isArray(body.embedding) || body.embedding.length !== EMBED_DIM) {
    throw new Error(
      `embed: bad vector (len ${body.embedding?.length ?? 'none'})`,
    )
  }
  return body.embedding
}

export async function enrichText(
  title: string,
  body: string,
  profile: string,
): Promise<GenResult> {
  if (!GEN_MODEL) return { summary: null, tags: [], relevance: null }
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: GEN_MODEL,
        prompt: buildEnrichPrompt(title, body, profile),
        stream: false,
        format: 'json',
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { summary: null, tags: [], relevance: null }
    const body2 = (await res.json()) as { response?: string }
    return parseEnrichResponse(body2.response || '')
  } catch {
    return { summary: null, tags: [], relevance: null }
  }
}
