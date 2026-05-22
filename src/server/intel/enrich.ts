// Enrich one intel item: embed (required) + summary/tags/relevance (best-effort).
// Item stays readable + searchable even if generation is unavailable.

import { embed, enrichText } from './llm'
import { upsertItemAi } from './item-ai-store'

const INTEREST_PROFILE =
  process.env.INTEL_INTEREST_PROFILE ||
  'restaurant operations; margin / food cost / labor cost; restaurant technology (POS, Toast, Square); AI agents; vertical SaaS; founder + GTM ops'

export interface EnrichTarget {
  id: string
  title: string
  raw_snippet: string
  full_text: string | null
}

export interface EnrichResult {
  itemId: string
  embedded: boolean
  summarized: boolean
  error?: string
}

export async function enrichItem(item: EnrichTarget): Promise<EnrichResult> {
  const body = item.full_text || item.raw_snippet || ''
  const text = [item.title, body].filter(Boolean).join('\n\n').slice(0, 8000)
  if (!text.trim()) {
    return {
      itemId: item.id,
      embedded: false,
      summarized: false,
      error: 'empty',
    }
  }

  let vector: number[]
  try {
    vector = await embed(text)
  } catch (e) {
    return {
      itemId: item.id,
      embedded: false,
      summarized: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const gen = await enrichText(item.title, body, INTEREST_PROFILE)

  try {
    await upsertItemAi({
      item_id: item.id,
      summary: gen.summary,
      embedding: vector,
      tags: gen.tags,
      relevance_score: gen.relevance,
      model: gen.summary ? 'ollama:gen+nomic-embed-text' : 'nomic-embed-text',
    })
  } catch (e) {
    return {
      itemId: item.id,
      embedded: true,
      summarized: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  return { itemId: item.id, embedded: true, summarized: Boolean(gen.summary) }
}

export async function enrichBatch(
  items: EnrichTarget[],
): Promise<EnrichResult[]> {
  const out: EnrichResult[] = []
  for (const it of items) out.push(await enrichItem(it))
  return out
}
