import { getIntelDb } from './db'
import type { IntelSource, SourceKind } from './types'

export interface NewSource {
  label: string
  kind: SourceKind
  route_or_url: string
  folder?: string | null
  interest_weight?: number
  enabled?: boolean
}

export async function listSources(): Promise<IntelSource[]> {
  const db = await getIntelDb()
  const { data, error } = await db
    .from('sources')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as IntelSource[]
}

export async function listEnabledSources(): Promise<IntelSource[]> {
  const db = await getIntelDb()
  const { data, error } = await db
    .from('sources')
    .select('*')
    .eq('enabled', true)
  if (error) throw new Error(error.message)
  return (data ?? []) as IntelSource[]
}

export async function createSource(input: NewSource): Promise<IntelSource> {
  const db = await getIntelDb()
  const { data, error } = await db
    .from('sources')
    .insert({
      label: input.label,
      kind: input.kind,
      route_or_url: input.route_or_url,
      folder: input.folder ?? null,
      interest_weight: input.interest_weight ?? 0.5,
      enabled: input.enabled ?? true,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as IntelSource
}

export async function createSources(inputs: NewSource[]): Promise<number> {
  if (inputs.length === 0) return 0
  const db = await getIntelDb()
  const { data, error } = await db
    .from('sources')
    .insert(
      inputs.map((i) => ({
        label: i.label,
        kind: i.kind,
        route_or_url: i.route_or_url,
        folder: i.folder ?? null,
        interest_weight: i.interest_weight ?? 0.5,
        enabled: i.enabled ?? true,
      })),
    )
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

export async function updateSource(
  id: string,
  patch: Partial<NewSource>,
): Promise<IntelSource> {
  const db = await getIntelDb()
  const { data, error } = await db
    .from('sources')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as IntelSource
}

export async function deleteSource(id: string): Promise<void> {
  const db = await getIntelDb()
  const { error } = await db.from('sources').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function markPolled(id: string, status: string): Promise<void> {
  const db = await getIntelDb()
  await db
    .from('sources')
    .update({ last_polled_at: new Date().toISOString(), last_status: status })
    .eq('id', id)
}
