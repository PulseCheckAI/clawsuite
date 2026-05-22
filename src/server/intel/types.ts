// Shared intel.* row + input shapes. Column names match the Phase 1 migration.

export type SourceKind = 'rsshub' | 'rss' | 'email'

export interface IntelSource {
  id: string
  label: string
  kind: SourceKind
  route_or_url: string
  folder: string | null
  interest_weight: number
  enabled: boolean
  last_polled_at: string | null
  last_status: string | null
  created_at: string
}

export interface IntelItem {
  id: string
  source_id: string
  title: string
  link: string
  author: string | null
  pub_date: string | null
  raw_snippet: string
  full_text: string | null
  lang: string | null
  dedupe_hash: string
  read: boolean
  saved: boolean
  fetched_at: string
  // Optional embedded AI enrichment (present when joined via item_ai).
  item_ai?: ItemAiBrief | null
}

export interface ItemAiBrief {
  summary: string | null
  tags: string[]
  relevance_score: number | null
}

// Input shape for inserting a freshly-fetched item (DB fills id/read/saved/fetched_at).
export interface NewIntelItem {
  source_id: string
  title: string
  link: string
  author: string | null
  pub_date: string | null
  raw_snippet: string
  dedupe_hash: string
}
