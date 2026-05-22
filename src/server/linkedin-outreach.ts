// LinkedIn Outreach Engine — the discover → resolve → draft → review pipeline.
//
// Turns scored restaurant prospects (gold.agg_prospect_scores) into a review
// queue of template/AI-drafted LinkedIn outreach (command_center.linkedin_outreach_queue).
// The operator reviews/edits/approves; the actual SEND (linkedin-cli / Linked API)
// is a separate, gated step — this module never sends.
//
// Graceful degradation by design:
//   - Person resolution uses Exa IF EXA_API_KEY is set; otherwise the person
//     fields are left null for manual entry in the review queue.
//   - Drafts are template-based (deterministic, brand-voice) and editable in
//     review; an LLM-personalization pass can layer on later behind a key.
//
// Trust boundary: callers must be authenticated (the API route enforces it);
// this module uses the service-role Supabase client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getLinkedInSupabase } from './linkedin-supabase'

const QUEUE = 'linkedin_outreach_queue'
const SCHEMA = 'command_center'

export type OutreachStatus =
  | 'draft'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'failed'

export interface OutreachItem {
  id: string
  organization_id: string
  prospect_id: string | null
  restaurant_name: string | null
  city: string | null
  state: string | null
  icp_score: number | null
  tier: string | null
  location_count: number | null
  estimated_revenue_cents: number | null
  person_name: string | null
  person_title: string | null
  linkedin_url: string | null
  resolution_source: string | null
  resolution_confidence: number | null
  connection_note: string | null
  dm_message: string | null
  draft_model: string | null
  status: OutreachStatus
  error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  approved_at: string | null
  sent_at: string | null
}

interface ProspectRow {
  prospect_id: string
  restaurant_name: string | null
  city: string | null
  state: string | null
  icp_score: number | null
  tier: string | null
  location_count: number | null
  estimated_revenue_cents: number | null
}

function orgId(): string {
  const id = process.env.PULSECHECK_DEFAULT_ORG_ID
  if (!id) throw new Error('PULSECHECK_DEFAULT_ORG_ID is not set')
  return id
}

function firstName(person: string | null): string {
  if (person && person.trim()) return person.trim().split(/\s+/)[0]
  return 'there'
}

// ── Person resolution (Exa, best-effort) ────────────────────────────────────
async function resolvePerson(p: ProspectRow): Promise<{
  person_name: string | null
  person_title: string | null
  linkedin_url: string | null
  resolution_source: string | null
  resolution_confidence: number | null
}> {
  const key = process.env.EXA_API_KEY
  const none = {
    person_name: null,
    person_title: null,
    linkedin_url: null,
    resolution_source: null,
    resolution_confidence: null,
  }
  if (!key || !p.restaurant_name) return none
  try {
    const query = `owner OR general manager OR founder of "${p.restaurant_name}" ${p.city ?? ''} ${p.state ?? ''} site:linkedin.com/in`
    const resp = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query, numResults: 5, type: 'auto' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) return none
    const data = (await resp.json()) as {
      results?: Array<{ url?: string; title?: string }>
    }
    const hit = (data.results ?? []).find((r) =>
      /linkedin\.com\/in\//i.test(r.url ?? ''),
    )
    if (!hit?.url) return none
    // Exa titles are usually "Name - Title - Company | LinkedIn".
    const parts = (hit.title ?? '').split(/[-|]/).map((s) => s.trim())
    return {
      person_name: parts[0] || null,
      person_title: parts[1] || null,
      linkedin_url: hit.url.replace(/\/+$/, ''),
      resolution_source: 'exa',
      resolution_confidence: 0.5, // heuristic — operator verifies in review
    }
  } catch {
    return none
  }
}

// ── Drafting (template-first, brand voice) ───────────────────────────────────
function draftTemplate(
  p: ProspectRow,
  person: { person_name: string | null },
): { connection_note: string; dm_message: string } {
  const name = firstName(person.person_name)
  const restaurant = p.restaurant_name ?? 'your restaurant'
  const locs =
    p.location_count && p.location_count > 1
      ? ` (${p.location_count} locations)`
      : ''
  // Connection note — LinkedIn caps at 300 chars.
  let note = `Hi ${name} — I work with multi-location restaurant operators on closing food & labor margin leaks. Saw ${restaurant}${locs} and thought it'd be worth connecting.`
  if (note.length > 300) note = note.slice(0, 297) + '…'
  // DM — sent after the connection is accepted.
  const dm = `Thanks for connecting, ${name}. Quick context: PulseCheck reads ${restaurant}'s POS data and flags exactly where margin is leaking — food cost, labor, prime cost — before it hits the P&L. Most operators we look at are quietly losing 2-4 points. Worth a 15-minute look at your numbers?`
  return { connection_note: note, dm_message: dm }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function listQueue(opts?: {
  status?: OutreachStatus
}): Promise<OutreachItem[]> {
  const sb: SupabaseClient = await getLinkedInSupabase()
  let q = sb
    .schema(SCHEMA)
    .from(QUEUE)
    .select('*')
    .eq('organization_id', orgId())
    .order('icp_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (opts?.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) throw new Error(`listQueue failed: ${error.message}`)
  return (data ?? []) as OutreachItem[]
}

export async function generateQueue(opts?: {
  limit?: number
  createdBy?: string
}): Promise<{ generated: number; skipped: number; items: OutreachItem[] }> {
  const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 50)
  const sb = await getLinkedInSupabase()
  const org = orgId()

  // 1. Candidate prospects: warm tier OR genuinely multi-unit (3+ locations) —
  //    the segment where a findable decision-maker actually exists.
  const { data: rawCandidates, error: candErr } = await sb
    .schema('gold')
    .from('agg_prospect_scores')
    .select(
      'prospect_id, restaurant_name, city, state, icp_score, tier, location_count, estimated_revenue_cents',
    )
    .or('tier.eq.warm,location_count.gte.3')
    .order('icp_score', { ascending: false, nullsFirst: false })
    .limit(limit * 3)
  if (candErr) throw new Error(`prospect read failed: ${candErr.message}`)
  const candidates = (rawCandidates ?? []) as ProspectRow[]

  // 2. Exclude prospects already queued (draft/approved). The partial-unique
  //    index backs this; pre-filtering avoids noisy conflict errors.
  const { data: pending } = await sb
    .schema(SCHEMA)
    .from(QUEUE)
    .select('prospect_id')
    .eq('organization_id', org)
    .in('status', ['draft', 'approved'])
  const taken = new Set(
    (pending ?? []).map((r) => (r as { prospect_id: string }).prospect_id),
  )

  const fresh = candidates
    .filter((c) => !taken.has(c.prospect_id))
    .slice(0, limit)
  const skipped = candidates.length - fresh.length

  // 3. Resolve + draft + build rows.
  const rows = []
  for (const p of fresh) {
    const person = await resolvePerson(p)
    const draft = draftTemplate(p, person)
    rows.push({
      organization_id: org,
      prospect_id: p.prospect_id,
      restaurant_name: p.restaurant_name,
      city: p.city,
      state: p.state,
      icp_score: p.icp_score,
      tier: p.tier,
      location_count: p.location_count,
      estimated_revenue_cents: p.estimated_revenue_cents,
      ...person,
      connection_note: draft.connection_note,
      dm_message: draft.dm_message,
      draft_model: 'template-v1',
      status: 'draft' as const,
      created_by: opts?.createdBy ?? 'system',
    })
  }

  if (rows.length === 0) return { generated: 0, skipped, items: [] }

  const { data: inserted, error: insErr } = await sb
    .schema(SCHEMA)
    .from(QUEUE)
    .insert(rows)
    .select('*')
  if (insErr) throw new Error(`queue insert failed: ${insErr.message}`)
  return {
    generated: inserted?.length ?? 0,
    skipped,
    items: (inserted ?? []) as OutreachItem[],
  }
}

const EDITABLE_STATUSES: OutreachStatus[] = [
  'draft',
  'approved',
  'rejected',
  'sent',
  'failed',
]

export async function updateItem(
  id: string,
  patch: {
    connection_note?: string
    dm_message?: string
    person_name?: string
    person_title?: string
    linkedin_url?: string
    status?: OutreachStatus
  },
): Promise<OutreachItem> {
  const sb = await getLinkedInSupabase()
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (typeof patch.connection_note === 'string')
    update.connection_note = patch.connection_note.slice(0, 300)
  if (typeof patch.dm_message === 'string')
    update.dm_message = patch.dm_message.slice(0, 1900)
  if (typeof patch.person_name === 'string')
    update.person_name = patch.person_name
  if (typeof patch.person_title === 'string')
    update.person_title = patch.person_title
  if (typeof patch.linkedin_url === 'string') {
    update.linkedin_url = patch.linkedin_url
    update.resolution_source = 'manual'
  }
  if (patch.status) {
    if (!EDITABLE_STATUSES.includes(patch.status))
      throw new Error(`invalid status: ${patch.status}`)
    update.status = patch.status
    if (patch.status === 'approved')
      update.approved_at = new Date().toISOString()
    if (patch.status === 'sent') update.sent_at = new Date().toISOString()
  }
  const { data, error } = await sb
    .schema(SCHEMA)
    .from(QUEUE)
    .update(update)
    .eq('id', id)
    .eq('organization_id', orgId())
    .select('*')
    .single()
  if (error) throw new Error(`updateItem failed: ${error.message}`)
  return data as OutreachItem
}
