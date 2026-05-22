import { getIntelDb } from './db'
import { toVectorLiteral } from './llm'
import type { IntelItem } from './types'

export interface ItemAiInput {
  item_id: string
  summary: string | null
  embedding: number[]
  tags: string[]
  relevance_score: number | null
  model: string
}

export async function upsertItemAi(row: ItemAiInput): Promise<void> {
  const db = await getIntelDb()
  const { error } = await db.from('item_ai').upsert(
    {
      item_id: row.item_id,
      summary: row.summary,
      embedding: toVectorLiteral(row.embedding), // pgvector wants a string literal
      tags: row.tags,
      relevance_score: row.relevance_score,
      model: row.model,
      version: 1,
    },
    { onConflict: 'item_id' },
  )
  if (error) throw new Error(error.message)
}

export async function listUnenriched(limit: number): Promise<IntelItem[]> {
  const db = await getIntelDb()
  const { data, error } = await db.rpc('unenriched_items', { p_limit: limit })
  if (error) throw new Error(error.message)
  return (data ?? []) as IntelItem[]
}

export interface Match {
  item_id: string
  similarity: number
}

export async function matchItems(
  queryEmbedding: number[],
  k: number,
): Promise<Match[]> {
  const db = await getIntelDb()
  const { data, error } = await db.rpc('match_intel_items', {
    query_embedding: toVectorLiteral(queryEmbedding),
    match_count: k,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as Match[]
}
