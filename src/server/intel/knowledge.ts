// Bridge to the LightRAG server (graph + vector RAG over feeds + vault).
// The LightRAG server runs separately (os/lightrag-server, Ollama backend);
// this is a thin HTTP client. Phase 1 surfaces ask + ingest + health.

const LIGHTRAG = (
  process.env.LIGHTRAG_BASE_URL || 'http://localhost:9621'
).replace(/\/+$/, '')
const KEY = process.env.LIGHTRAG_API_KEY || ''

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (KEY) h.Authorization = `Bearer ${KEY}`
  return h
}

export type RagMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix'

export async function knowledgeHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${LIGHTRAG}/health`, {
      signal: AbortSignal.timeout(5_000),
    })
    return r.ok
  } catch {
    return false
  }
}

export async function askKnowledge(
  query: string,
  mode: RagMode = 'hybrid',
  timeoutMs = 120_000,
): Promise<string> {
  const res = await fetch(`${LIGHTRAG}/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ query, mode }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `lightrag /query HTTP ${res.status} ${detail.slice(0, 200)}`,
    )
  }
  const body = (await res.json()) as { response?: string; answer?: string }
  return body.response ?? body.answer ?? ''
}

// Ingest one document; LightRAG extracts entities/relations + chunks async.
export async function ingestText(
  text: string,
  fileSource?: string,
): Promise<void> {
  const res = await fetch(`${LIGHTRAG}/documents/text`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      text,
      ...(fileSource ? { file_source: fileSource } : {}),
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `lightrag /documents/text HTTP ${res.status} ${detail.slice(0, 200)}`,
    )
  }
}
