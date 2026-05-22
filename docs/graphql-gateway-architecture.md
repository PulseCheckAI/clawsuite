# PulseOS GraphQL Gateway — Architecture (ADR)

_2026-05-21 · status: PROPOSED (awaiting go/no-go on Phase 1) · scope: unified typed graph over Intel, MarginOps, RSS/Content, Prospects_

---

## 0. Decision summary (bottom line)

Add **one** GraphQL endpoint to the existing TanStack Start app at `POST /api/graphql`, built with
**GraphQL Yoga (server) + Pothos (code-first schema)**. Resolvers read from **Supabase directly**
(SQL/PostgREST, tenant-scoped) and reuse the **existing server modules** for actions — they do
_not_ re-HTTP the REST routes. Ship read-only first; add mutations second; subscriptions third;
only consider federation if the MCPs ever become independently-owned services.

**Why a gateway at all:** the dashboard already hits ~dozens of `/api/{intel,rss,postiz}` routes plus
a fleet of MCPs, each with its own shape. A single typed graph collapses that into one contract
clients can introspect, with N+1 protection and field-level auth in one place. **Why not more:**
your stack works today, so this is additive and reversible — the REST routes stay; GraphQL wraps them.

---

## 1. Stack decision & rationale

| Concern     | Choice                                                            | Why (vs alternatives)                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server      | **GraphQL Yoga**                                                  | Runtime-agnostic (Vite/Nitro-friendly, same as TanStack Start); WHATWG fetch-based, mounts cleanly as one TanStack server route. Apollo Server is heavier and Express-centric — wrong fit for this app. |
| Schema      | **Pothos** (code-first)                                           | End-to-end TS types from your existing interfaces; plugins for dataloader, auth-scopes, complexity. Nexus is similar but less actively maintained; SDL-first means a second source of truth.            |
| Data access | **Direct Supabase + reuse server modules**                        | Resolvers call `supabase-js`/SQL for reads and import existing functions (e.g. `runAutopost`, postiz `_client`) for actions. No loopback HTTP hop, no double auth.                                      |
| N+1         | **DataLoader** (Pothos loadable refs)                             | One batched query per entity per request (Restaurant→leaks, Source→items).                                                                                                                              |
| Auth        | **Reuse `isAuthenticated` + org scoping in context**              | Same session check as REST; tenant_id resolved once into GraphQL context; field-level via Pothos auth-scopes.                                                                                           |
| Safety      | **depth limit + cost analysis + introspection off in prod + APQ** | `@escape.tech/graphql-armor` or envelop plugins; persisted queries cap the attack surface.                                                                                                              |

**One new endpoint, one schema, no new process** — it lives inside the dashboard you already run.

---

## 2. Domain → schema map (the actual surfaces)

Four bounded contexts, each from a real surface. SDL sketch (illustrative — field names track the
existing MCP tools / routes):

```graphql
type Query {
  # ---- Intel Cockpit (intel.* schema, /api/intel/*, intel-mcp) ----
  intelSources(active: Boolean): [IntelSource!]!
  intelItems(
    sourceId: ID
    since: DateTime
    first: Int = 50
    after: String
  ): IntelItemConnection!
  askIntel(question: String!): IntelAnswer! # RAG via lightrag bridge
  # ---- MarginOps (margin schema, marginops-mcp) ----
  restaurant(id: ID!): Restaurant
  restaurantsAtRisk(limit: Int = 20): [Restaurant!]!
  marginLeaksTop(tenantId: ID!, window: DateWindow): [MarginLeak!]!
  mcsLeaderboard(limit: Int = 20): [MarginScore!]!
  nraBenchmarks(segment: String): [Benchmark!]!

  # ---- RSS / Content (/api/rss/*, /api/postiz/*) ----
  rssFeed(route: String!, limit: Int = 50): [FeedItem!]!
  autopostConfig: AutopostConfig!
  postizChannels: [Channel!]!
  scheduledPosts: [ScheduledPost!]!

  # ---- Prospects / Growth (prospect-mcp, crm-mcp) ----
  topScoredProspects(limit: Int = 20): [Prospect!]!
  prospect(id: ID!): Prospect
  enrichmentQueue: EnrichmentStatus!
}

type Restaurant {
  id: ID!
  name: String!
  marginScore: Float
  primeCostTrend(window: DateWindow): [TrendPoint!]! # dataloader-batched
  leaks(limit: Int = 10): [MarginLeak!]! # dataloader-batched
  recommendations: [Recommendation!]!
}

type MarginLeak {
  id: ID!
  category: String! # food | labor | scheduling | ...
  amountUsd: Float! # money convention enforced server-side
  detectedAt: DateTime!
  daypart: String
}

type IntelSource {
  id: ID!
  title: String!
  url: String
  itemCount: Int!
}
type IntelItem {
  id: ID!
  title: String!
  url: String!
  publishedAt: DateTime
  source: IntelSource!
}
type IntelAnswer {
  answer: String!
  citations: [Citation!]!
  entities: [GraphEntity!]!
}

type Mutation { # Phase 2 — see roadmap
  schedulePost(input: SchedulePostInput!): ScheduledPost! # wraps postiz _client (LinkedIn still rejected)
  setTenantBaseline(input: BaselineInput!): Restaurant!
  updateAutopostConfig(input: AutopostConfigInput!): AutopostConfig!
  enrichProspects(ids: [ID!]!): EnrichmentStatus!
}

type Subscription { # Phase 3
  marginLeakDetected(tenantId: ID!): MarginLeak!
  intelItemIngested(sourceId: ID): IntelItem!
}
```

Relay-style `*Connection` for the high-volume lists (intelItems, ~2,193+ and growing). Money fields
follow the existing money convention; never invent values — empty/null over fabricated.

---

## 3. Resolver & data-access pattern

```
Client ─▶ POST /api/graphql (Yoga, one TanStack server route)
            │  context: { session, tenantId, loaders, supabase }
            ▼
        Pothos resolvers
            ├─ reads  ──▶ Supabase (SQL / PostgREST), tenant-scoped, DataLoader-batched
            ├─ RAG    ──▶ existing /api/intel/ask bridge → lightrag :9622
            ├─ actions▶ import server modules directly (runAutopost, postiz _client, …)
            └─ MCP biz logic ──▶ only where the MCP adds logic beyond a table read
                                  (e.g. margin_recommendations, score_prospect)
```

Rules:

- **Reads hit Supabase, not REST.** No loopback; resolvers are thin over SQL with a DataLoader per
  relationship to kill N+1.
- **Actions reuse existing modules.** `schedulePost` calls the same Postiz `_client` the REST route
  uses — so the **LinkedIn hard-reject and the scheduling path stay in one place**, not duplicated.
- **MCP only when it's logic, not data.** Recommendations / scoring / RAG go through their service;
  plain entity reads go straight to the DB.

---

## 4. Multi-tenant auth (non-negotiable — your data is RLS-scoped)

- `context` resolves `session` via the existing `isAuthenticated`, then derives `tenantId` once.
- Every tenant-scoped query **must** filter by `tenantId` from context, never from client args
  (client `tenantId` args are validated against the session's allowed tenants, not trusted).
- Field-level authz via Pothos `authScopes` (e.g. cross-tenant leaderboard fields gated).
- Reuse Supabase RLS as defense-in-depth: resolvers run with a tenant-scoped role/JWT where possible,
  so even a resolver bug can't cross tenants.

---

## 5. Performance & security

- **DataLoader** on every list-under-entity field (Restaurant.leaks, Source.items, prospect rollups).
- **Response cache** (envelop responseCache) for slow, low-churn fields: `nraBenchmarks`,
  `mcsLeaderboard`, `marginOpsSummary` — TTL 60–300s, keyed by tenant.
- **Cost & depth limits** (graphql-armor): max depth ~8, cost budget per query, alias/duplicate-field
  caps. Reject expensive queries before execution.
- **Introspection OFF in production**, ON in dev. **APQ / persisted queries** for first-party clients
  so production only runs known query hashes.
- **Tracing**: envelop + the existing telemetry; per-resolver timing to find slow paths.

---

## 6. Phased build plan

| Phase                  | Scope                                                                                                                               | Output                                                       | Risk                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| **P1 — Read gateway**  | Yoga+Pothos at `/api/graphql`; Intel + Margin + RSS read queries; DataLoaders; auth context; depth/cost limits; introspection-gated | One queryable graph for the dashboard's read surfaces        | Low — additive, REST untouched |
| **P2 — Mutations**     | `schedulePost` (reuse postiz \_client), `updateAutopostConfig`, `setTenantBaseline`, `enrichProspects`                              | Write path through the graph, single-sourced with REST logic | Med — needs careful authz      |
| **P3 — Subscriptions** | `marginLeakDetected`, `intelItemIngested` over SSE/WS; filter + authz                                                               | Live dashboard tiles                                         | Med — infra for fan-out        |
| **P4 — Federation**    | _Only if_ MCPs become independently-owned: each MCP → subgraph, compose supergraph                                                  | Team-scale distributed graph                                 | High — don't pre-pay this      |

**Recommendation:** ship **P1 only** first and let the dashboard consume it for one surface (Intel or
Margin) as the proof. Expand once it's earning its keep.

---

## 7. What this explicitly does NOT do

- Does not replace the REST routes (they stay; clients migrate opt-in).
- Does not expose Supabase `pg_graphql` raw (that couples API shape to DB schema and skips business
  logic / the LinkedIn guard / money convention).
- Does not federate on day one (the MCPs are not independently-owned yet — federation would be
  complexity with no payoff).
- Does not touch the LinkedIn path — `schedulePost` reuses the existing guard, never duplicates it.

---

\*Open decision for you: green-light P1 (read gateway over Intel + Margin + RSS), or narrow it to a
single surface as the proof slice. On approval I scaffold `/api/graphql` (Yoga+Pothos), the context

- auth, DataLoaders, and the first read types — typechecked, REST untouched.\*
