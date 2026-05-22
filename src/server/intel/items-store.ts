import { getIntelDb } from './db'
import type { IntelItem, NewIntelItem } from './types'

// Upsert ignoring duplicates on the (source_id, link) unique constraint.
// Returns the number of NEW rows inserted.
export async function insertItems(rows: NewIntelItem[]): Promise<number> {
  if (rows.length === 0) return 0
  const db = await getIntelDb()
  const { data, error } = await db
    .from('items')
    .upsert(rows, { onConflict: 'source_id,link', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

export interface ListItemsOpts {
  sourceId?: string
  folder?: string
  unreadOnly?: boolean
  savedOnly?: boolean
  limit?: number
}

export async function listItems(
  opts: ListItemsOpts = {},
): Promise<IntelItem[]> {
  const db = await getIntelDb()
  let q = db
    .from('items')
    .select('*, item_ai(summary,tags,relevance_score)')
    .order('fetched_at', { ascending: false })
  if (opts.sourceId) q = q.eq('source_id', opts.sourceId)
  if (opts.unreadOnly) q = q.eq('read', false)
  if (opts.savedOnly) q = q.eq('saved', true)
  q = q.limit(Math.min(Math.max(opts.limit ?? 50, 1), 200))
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as IntelItem[]
}

export async function setItemState(
  id: string,
  patch: { read?: boolean; saved?: boolean },
): Promise<IntelItem> {
  const db = await getIntelDb()
  const { data, error } = await db
    .from('items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as IntelItem
}
