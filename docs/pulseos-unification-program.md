# PulseOS Unification Program

_2026-05-21 · status: PROPOSED · the sequenced execution plan behind "unify everything"_
_Builds on: `graphql-gateway-architecture.md` (the connective tissue) + the OS architecture spec._

---

## 0. Premise

"Unify everything" is a **5-track program**, not a single build. Done in dependency order it
compounds; done at random it thrashes. Each track below is grounded in the actual code, not
assumptions. Two tracks were re-scoped _after tracing the real sources_ — noted inline.

**Critical path:** Gateway P1 (read) → Gateway P2 (write/command bus) → Knowledge engine →
Growth pipeline → Auth. The gateway is first because it's the seam every other track plugs into.

---

## Track A — Read Gateway (connective tissue) · FIRST

- **State:** none (greenfield). REST routes + MCPs serve the dashboard piecemeal.
- **Target:** `POST /api/graphql` (Yoga + Pothos), read-only over Intel + Margin + RSS, tenant-scoped
  context, DataLoaders, depth/cost limits. See `graphql-gateway-architecture.md` §6 P1.
- **First slice:** ONE surface as proof — **Margin** (pilot-critical, demo 2026-05-26) recommended.
- **Risk:** Low (additive; REST untouched).
- **Blocker now:** needs `graphql-yoga`, `@pothos/core`, `dataloader` installed — requires a working
  package manager (see §Environment).

## Track B — Write Plane / Command Bus · SECOND

- **State (traced):** actions are scattered across 4 places — REST routes (`/api/rss/autopost`,
  `/api/postiz/post`), MCP tools (`set_tenant_baseline`, `enroll_pulse_prospects`), Windmill jobs
  (enrichment, `rag_query`), and raw SQL.
- **Target:** Gateway mutations become the **single audited command surface**. Each mutation _reuses_
  the existing module (e.g. `schedulePost` → postiz `_client`, keeping the LinkedIn guard
  single-sourced) rather than reimplementing. One authz check, one audit log, one place.
- **Why it's the real unify:** read-aggregation is nice; a single command bus is what actually
  collapses the surface area and makes "auth in one place" true.
- **Risk:** Med — every mutation needs tenant authz before it ships.

## Track C — Knowledge Engine (the corrected prize) · THIRD

- **State (TRACED — earlier take corrected):** _Not_ duplication. Two RAGs, two corpora:
  - `pulse-rag` → Windmill `rag_query` over `platinum.margin_leak_daily` + `gold.daily_sales`,
    **per-org**, pgvector. Operational tenant Q&A.
  - LightRAG (`os/lightrag-server` :9622) → knowledge graph+vector over docs/intel/vault.
  - `relationship-memory-mcp` → people/orgs graph (separate store).
  - Shared models (nomic-embed-text + qwen2.5-coder:7b); separate infrastructure.
- **Target:** **one retrieval engine (LightRAG), two namespaces** — `knowledge` (docs/intel) and
  `tenant-ops` (margin/sales, org-partitioned). `relationship-memory` becomes typed node/edge views
  _into_ the graph, not a parallel store. Expose through **one** gateway interface:
  `askIntel` (knowledge) + `askOps(tenantId)` (operational), both citation-returning.
- **Hard constraint:** `pulse-rag`'s **per-org isolation is load-bearing** — the unified path MUST
  preserve org partitioning (namespace-per-tenant or filtered retrieval). Do NOT retire the Windmill
  path until the LightRAG tenant-ops namespace is proven at parity with org isolation intact.
- **Risk:** Med-High — touches live tenant Q&A; migrate behind a flag, parity-test, then cut over.

## Track D — Growth Pipeline (three MCPs → one domain) · FOURTH

- **State (traced dirs):** `main/apps/mcps/{prospect,crm,outreach}` are three MCPs that are
  sequential stages of one flow: discover (`find_prospects`/`find_lookalikes`) → enrich (Exa) →
  score (`score_prospect`) → sync (`create_deal_from_prospect`) → outreach (`enroll_pulse_prospects`).
  No single owner/contract — which is why enrichment kept stalling.
- **Target:** one **Growth domain service** with a single pipeline contract and state machine
  (`pending → enriching → scored → synced → enrolled`). The three MCPs become internal stages or one
  consolidated MCP. Surfaced via the gateway as `Prospect` + mutations.
- **Risk:** Med — needs a clean state model; existing enrichment_status enum
  (`pending|partial|complete|failed`) is the seed.

## Track E — Identity / Auth Unification · FIFTH (foundational, but sequence-last)

- **State:** fragmented 5 ways — `CLAWSUITE_PASSWORD` (**currently unset → auth BYPASSED**, a live
  hole), Postiz OAuth, LinkedIn OAuth, MCP auth, Supabase JWT/RLS.
- **Target:** one session/identity model feeding REST + GraphQL + MCP; the gateway's tenant context
  derives from it. Supabase RLS stays as defense-in-depth.
- **Why last (but urgent):** the _design_ must precede gateway P2 (mutations need real authz), but the
  full unification is the deepest change. **Immediate sub-task regardless of sequence:** set
  `CLAWSUITE_PASSWORD` — the bypass is live today.
- **Risk:** High — auth changes are the easiest to break; stage carefully.

---

## What we are deliberately NOT unifying

- **Ingestion/ETL heads** (Windmill, intel ingest, Exa, Square) — different sources; medallion already
  unifies them downstream.
- **Obsidian vault ↔ product knowledge** — different lifecycles; coupling re-creates the killed
  sync-daemon mess.
- **MCP federation** — premature; the MCPs aren't independently-owned. Revisit only post-consolidation.

## Already converging (formalize, near-free)

- **Content/distribution spine:** Postiz + RSS Cockpit + Pollinations images + (planned) video. This is
  the cheapest win — formalize as one "Content OS" surface and expose via the gateway.

---

## Sequencing & dependencies

```
A (read gateway)  ──┬─▶ B (command bus) ──┬─▶ D (growth via gateway mutations)
                    │                      └─▶ C exposed (askIntel/askOps)
   E-design (auth) ─┘  must land before B ships mutations
   E-quickfix: set CLAWSUITE_PASSWORD  ── do NOW, independent
   C-build (knowledge namespaces) runs in parallel with A/B (own track, own risk)
```

## Environment blocker (this session)

Both shells are degraded: PowerShell Defender-blocked (`EPERM uv_spawn`), bash PATH broken
(`npm`/`node` not found). **Dependency installs and typechecks cannot run now.** Writing unverifiable
code (e.g. gateway imports of uninstalled packages) is off the table until a shell is healthy. Track A
scaffolding starts the moment `npm`/`pnpm` is reachable.

---

## Recommended first three moves (in order)

1. **Now, no build needed:** set `CLAWSUITE_PASSWORD` — close the live auth bypass (Track E quickfix).
2. **When a shell is healthy:** scaffold Track A P1 over **Margin** — `/api/graphql`, Yoga+Pothos,
   tenant context, DataLoaders, the Margin read types. Typecheck, REST untouched.
3. **In parallel (own track):** spike Track C — stand up a LightRAG `tenant-ops` namespace with org
   partitioning and parity-test it against `pulse-rag` before any cutover.

```

```
