// PulseOS GraphQL gateway — schema (Track A, P1 proof slice: Intel).
//
// Code-first via Pothos. Resolvers wrap the EXISTING intel server stores
// (src/server/intel/*) so data is real and single-sourced with the REST layer —
// no duplicated query logic, no mock data. See:
//   docs/graphql-gateway-architecture.md
//   docs/pulseos-unification-program.md  (Track A)
//
// Intel.* is GLOBAL content (service-role, not tenant-scoped — intel/db.ts is the
// trust boundary), so context carries only the auth flag + N+1 loaders. Tenant
// scoping arrives with the Margin slice.

import SchemaBuilder from '@pothos/core'
import DataLoader from 'dataloader'
import { listSources, listEnabledSources } from '@/server/intel/sources-store'
import { listItems } from '@/server/intel/items-store'
import { getIntelDb } from '@/server/intel/db'
import type { IntelSource, IntelItem, ItemAiBrief } from '@/server/intel/types'
import {
  askKnowledge,
  knowledgeHealth,
  type RagMode,
} from '@/server/intel/knowledge'
import { listMarginLeaks, type MarginLeak } from '@/server/margin/leaks-store'
import { listMarginOps, type MarginSnapshot } from '@/server/margin/ops-store'

export interface GraphQLContext {
  authed: boolean
  loaders: { sourceById: DataLoader<string, IntelSource | null> }
}

// One batched fetch of sources-by-id per request — kills the N+1 on
// IntelItem.source when a query selects `items { source { ... } }`.
export function makeLoaders(): GraphQLContext['loaders'] {
  return {
    sourceById: new DataLoader<string, IntelSource | null>(async (ids) => {
      const db = await getIntelDb()
      const { data, error } = await db
        .from('sources')
        .select('*')
        .in('id', ids as string[])
      if (error) throw new Error(error.message)
      const byId = new Map((data as IntelSource[]).map((s) => [s.id, s]))
      return ids.map((id) => byId.get(id) ?? null)
    }),
  }
}

const builder = new SchemaBuilder<{
  Context: GraphQLContext
  Scalars: { DateTime: { Input: string; Output: string } }
}>({})

// ISO-8601 pass-through. Postgres already hands us ISO strings; the scalar just
// validates shape on input and forwards on output.
builder.scalarType('DateTime', {
  serialize: (value) => value as string,
  parseValue: (value) => {
    if (typeof value !== 'string') {
      throw new Error('DateTime must be an ISO 8601 string')
    }
    return value
  },
})

function requireAuth(ctx: GraphQLContext): void {
  if (!ctx.authed) throw new Error('Unauthorized')
}

const ItemAiBriefRef = builder.objectRef<ItemAiBrief>('ItemAiBrief').implement({
  description: 'AI enrichment attached to an intel item (when available).',
  fields: (t) => ({
    summary: t.exposeString('summary', { nullable: true }),
    tags: t.exposeStringList('tags'),
    relevanceScore: t.exposeFloat('relevance_score', { nullable: true }),
  }),
})

const IntelSourceRef = builder.objectRef<IntelSource>('IntelSource').implement({
  description: 'A configured intel feed source (RSSHub / RSS / email).',
  fields: (t) => ({
    id: t.exposeID('id'),
    label: t.exposeString('label'),
    kind: t.exposeString('kind'),
    routeOrUrl: t.exposeString('route_or_url'),
    folder: t.exposeString('folder', { nullable: true }),
    interestWeight: t.exposeFloat('interest_weight'),
    enabled: t.exposeBoolean('enabled'),
    lastPolledAt: t.expose('last_polled_at', {
      type: 'DateTime',
      nullable: true,
    }),
    lastStatus: t.exposeString('last_status', { nullable: true }),
    createdAt: t.expose('created_at', { type: 'DateTime' }),
  }),
})

const IntelItemRef = builder.objectRef<IntelItem>('IntelItem').implement({
  description: 'A single fetched intel item (article / post).',
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    link: t.exposeString('link'),
    author: t.exposeString('author', { nullable: true }),
    pubDate: t.expose('pub_date', { type: 'DateTime', nullable: true }),
    snippet: t.exposeString('raw_snippet'),
    lang: t.exposeString('lang', { nullable: true }),
    read: t.exposeBoolean('read'),
    saved: t.exposeBoolean('saved'),
    fetchedAt: t.expose('fetched_at', { type: 'DateTime' }),
    ai: t.field({
      type: ItemAiBriefRef,
      nullable: true,
      resolve: (item) => item.item_ai ?? null,
    }),
    source: t.field({
      type: IntelSourceRef,
      nullable: true,
      description: 'Parent source, batched via DataLoader (no N+1).',
      resolve: (item, _args, ctx) =>
        ctx.loaders.sourceById.load(item.source_id),
    }),
  }),
})

const RagModeEnum = builder.enumType('RagMode', {
  description: 'LightRAG retrieval mode.',
  values: ['naive', 'local', 'global', 'hybrid', 'mix'] as const,
})

interface IntelAnswerShape {
  answer: string
  mode: RagMode
}

const IntelAnswerRef = builder
  .objectRef<IntelAnswerShape>('IntelAnswer')
  .implement({
    description:
      'An answer from the knowledge base (LightRAG graph + vector RAG).',
    fields: (t) => ({
      answer: t.exposeString('answer'),
      mode: t.field({ type: RagModeEnum, resolve: (a) => a.mode }),
    }),
  })

const MarginLeakRef = builder.objectRef<MarginLeak>('MarginLeak').implement({
  description:
    'A detected margin leak (tenant-scoped) from platinum.margin_leak_daily.',
  fields: (t) => ({
    id: t.exposeID('id'),
    organizationId: t.exposeID('organization_id'),
    locationId: t.exposeID('location_id', { nullable: true }),
    leakDate: t.expose('leak_date', { type: 'DateTime' }),
    domain: t.exposeString('domain'),
    subCategory: t.exposeString('sub_category', { nullable: true }),
    severity: t.exposeString('severity'),
    confidence: t.exposeFloat('confidence', { nullable: true }),
    // Money is BIGINT cents; exposed as Float to avoid GraphQL Int 32-bit overflow.
    leakAmountCents: t.field({
      type: 'Float',
      nullable: true,
      resolve: (l) =>
        l.leak_amount_cents == null ? null : Number(l.leak_amount_cents),
    }),
    annualizedCents: t.field({
      type: 'Float',
      nullable: true,
      resolve: (l) =>
        l.annualized_cents == null ? null : Number(l.annualized_cents),
    }),
    estimatedRecoveryCents: t.field({
      type: 'Float',
      nullable: true,
      resolve: (l) =>
        l.estimated_recovery_cents == null
          ? null
          : Number(l.estimated_recovery_cents),
    }),
    difficulty: t.exposeString('difficulty', { nullable: true }),
    timeToImpact: t.exposeString('time_to_impact', { nullable: true }),
    description: t.exposeString('description', { nullable: true }),
    prescription: t.exposeString('prescription', { nullable: true }),
  }),
})

// BIGINT cents → Float (avoid GraphQL Int 32-bit overflow).
const centsToFloat = (v: number | null): number | null =>
  v == null ? null : Number(v)

const MarginSnapshotRef = builder
  .objectRef<MarginSnapshot>('MarginSnapshot')
  .implement({
    description:
      'A per-location daily margin snapshot (tenant-scoped) from gold.v_margin_ops.',
    fields: (t) => ({
      organizationId: t.exposeID('organization_id'),
      locationId: t.exposeID('location_id', { nullable: true }),
      metricDate: t.expose('metric_date', { type: 'DateTime' }),
      netSalesCents: t.field({
        type: 'Float',
        nullable: true,
        resolve: (r) => centsToFloat(r.net_sales_cents),
      }),
      cogsCents: t.field({
        type: 'Float',
        nullable: true,
        resolve: (r) => centsToFloat(r.cogs_cents),
      }),
      laborCostCents: t.field({
        type: 'Float',
        nullable: true,
        resolve: (r) => centsToFloat(r.labor_cost_cents),
      }),
      foodCostPct: t.exposeFloat('food_cost_pct', { nullable: true }),
      laborCostPct: t.exposeFloat('labor_cost_pct', { nullable: true }),
      primeCostPct: t.exposeFloat('prime_cost_pct', { nullable: true }),
      foodCostGrade: t.exposeString('food_cost_grade', { nullable: true }),
      laborCostGrade: t.exposeString('labor_cost_grade', { nullable: true }),
      primeCostGrade: t.exposeString('prime_cost_grade', { nullable: true }),
      marginHealthScore: t.exposeFloat('margin_health_score', {
        nullable: true,
      }),
      estNetMarginPct: t.exposeFloat('est_net_margin_pct', { nullable: true }),
      operatingProfitCents: t.field({
        type: 'Float',
        nullable: true,
        resolve: (r) => centsToFloat(r.operating_profit_cents),
      }),
      transactionCount: t.exposeInt('transaction_count', { nullable: true }),
      guestCount: t.exposeInt('guest_count', { nullable: true }),
    }),
  })

builder.queryType({
  fields: (t) => ({
    intelSources: t.field({
      type: [IntelSourceRef],
      description: 'List configured intel sources.',
      args: { enabledOnly: t.arg.boolean({ required: false }) },
      resolve: (_parent, args, ctx) => {
        requireAuth(ctx)
        return args.enabledOnly ? listEnabledSources() : listSources()
      },
    }),
    intelItems: t.field({
      type: [IntelItemRef],
      description: 'List intel items, newest first (capped at 200).',
      args: {
        sourceId: t.arg.id({ required: false }),
        savedOnly: t.arg.boolean({ required: false }),
        unreadOnly: t.arg.boolean({ required: false }),
        limit: t.arg.int({ required: false }),
      },
      resolve: (_parent, args, ctx) => {
        requireAuth(ctx)
        return listItems({
          sourceId: args.sourceId == null ? undefined : String(args.sourceId),
          savedOnly: args.savedOnly ?? undefined,
          unreadOnly: args.unreadOnly ?? undefined,
          limit: args.limit ?? undefined,
        })
      },
    }),
    askIntel: t.field({
      type: IntelAnswerRef,
      description:
        'Ask the LightRAG knowledge base (graph + vector RAG over feeds + vault).',
      args: {
        question: t.arg.string({ required: true }),
        mode: t.arg({ type: RagModeEnum, required: false }),
      },
      resolve: async (_parent, args, ctx) => {
        requireAuth(ctx)
        const mode = (args.mode ?? 'hybrid') as RagMode
        // Cap the RAG call at 30s — aborts the LightRAG fetch so a flood of
        // askIntel queries can't pin the backend for the full 120s each.
        const answer = await askKnowledge(args.question, mode, 30_000)
        return { answer, mode }
      },
    }),
    knowledgeHealthy: t.boolean({
      description: 'Whether the LightRAG knowledge server is reachable.',
      resolve: (_parent, _args, ctx) => {
        requireAuth(ctx)
        return knowledgeHealth()
      },
    }),
    marginLeaksTop: t.field({
      type: [MarginLeakRef],
      description:
        'Top margin leaks for ONE org by annualized impact (org-scoped). ' +
        'organizationId is REQUIRED; once auth lands it will be validated ' +
        "against the session's allowed orgs rather than trusted from the client.",
      args: {
        organizationId: t.arg.id({ required: true }),
        locationId: t.arg.id({ required: false }),
        severity: t.arg.string({ required: false }),
        domain: t.arg.string({ required: false }),
        days: t.arg.int({ required: false }),
        limit: t.arg.int({ required: false }),
      },
      resolve: (_parent, args, ctx) => {
        requireAuth(ctx)
        return listMarginLeaks({
          organizationId: String(args.organizationId),
          locationId:
            args.locationId == null ? undefined : String(args.locationId),
          severity: args.severity ?? undefined,
          domain: args.domain ?? undefined,
          days: args.days ?? undefined,
          limit: args.limit ?? undefined,
        })
      },
    }),
    marginOpsSummary: t.field({
      type: [MarginSnapshotRef],
      description:
        'Recent per-location margin snapshots for ONE org (org-scoped). ' +
        'organizationId is REQUIRED; session-validated once auth lands.',
      args: {
        organizationId: t.arg.id({ required: true }),
        locationId: t.arg.id({ required: false }),
        days: t.arg.int({ required: false }),
        limit: t.arg.int({ required: false }),
      },
      resolve: (_parent, args, ctx) => {
        requireAuth(ctx)
        return listMarginOps({
          organizationId: String(args.organizationId),
          locationId:
            args.locationId == null ? undefined : String(args.locationId),
          days: args.days ?? undefined,
          limit: args.limit ?? undefined,
        })
      },
    }),
  }),
})

export const schema = builder.toSchema()
