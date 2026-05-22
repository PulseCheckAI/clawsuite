# PulseCheck OS — Unified Architecture

**Date:** 2026-05-21
**Status:** Architecture blueprint (grounded in verified prod state, 2026-05-21)
**Scope:** The system-of-systems that ties every PulseCheck capability onto one operating loop.

---

## 1. Thesis

PulseCheck already has most of the pieces — a margin-intelligence product, a lead-gen engine, a content/social stack, a dashboard, and a dozen MCP services. They are **fragmented**, and two were **broken** until today. "Revolutionary" here is not net-new sprawl; it is **unifying the existing capabilities onto one loop, one memory, one cockpit**:

> **Ingest → Understand → Act → Learn**

Run that loop across four spines. Each spine ingests its own signal, understands it with AI, acts in its domain, and learns from outcomes — but they **share the same substrate** (vector memory, the cockpit, the MCP intelligence layer). That shared loop is the product.

## 2. The four spines (grounded status — verified 2026-05-21)

| Spine                    | Loop instance                                      | Verified status today                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Margin** (the product) | POS → margin/leak intel → operator alert → outcome | 🟢 **Demo-ready.** Corner Table reseeded to realistic economics; leak engine works + idempotent; NRA grades correct. 🔴 Real-POS ingest still unproven (bronze→silver 1 row/14d; 2 ETL jobs failing). |
| **Growth** (GTM)         | discovery → enrich → score → outreach → won/lost   | 🟢 **Enricher proven.** Exa→`silver.dim_prospects`→`pie.score_prospect`→complete; Acropolis = warm lead (65). 🟡 Bulk drain pending (worker / Windmill).                                              |
| **Content** (awareness)  | feed ingest → triage → publish → engagement        | 🟢 Postiz live (4 channels) + autopost; **Intel Cockpit** designed (`2026-05-21-intel-cockpit-design.md`) — adds AI triage + read→draft→publish + engagement-learning.                                |
| **Cockpit** (control)    | the dashboard + agent floor + MCP intelligence     | 🟢 Live (`os/dashboard-clawsuite`), fragmented — the connective tissue across the other three.                                                                                                        |

## 3. The shared substrate (what makes it ONE system, not four)

1. **One memory — Relationship Memory MCP** (`os/relationship-memory-mcp`, built+tested) is the people+orgs graph every spine reads/writes. A prospect (Growth), a pilot operator (Margin), a newsletter author (Content) are the _same_ entity model. pgvector (`dim_prospects.profile_embedding`, intel item embeddings, voice-agent `match_memory_chunks`) is the shared semantic index.
2. **One cockpit** — the dashboard surfaces every spine (margin dashboard, prospect board, RSS/Intel Cockpit, agent floor) behind one auth + one realtime layer (Supabase Realtime).
3. **One intelligence layer** — the MCP fleet (`marginops-mcp`, `prospect-mcp`, `crm-mcp`, `content-mcp`, `outreach-mcp`, `integrations-mcp`, `pulse-data-mcp`, `relationship-memory-mcp`) is the shared tool API that both Claude and the app call. The loop's "Understand" step is these MCPs + local-first LLM (`src/server/local-llm.ts`, Ollama) with cloud fallback.
4. **One learning substrate** — outcomes feed back: Margin (did the operator fix the leak?), Growth (did the lead convert?), Content (did the post get engagement? → re-rank). Each spine writes outcomes to the shared memory so the others benefit (e.g., a won pilot becomes a `find_lookalikes` seed for Growth).

## 4. The loop, concretely, per stage

- **Ingest:** Square POS (Margin) · Overture/Google/Yelp discovery + Exa (Growth) · RSSHub/email feeds (Content). Shared pattern: raw → a `*_queue` or `raw_*` table → promote to silver.
- **Understand:** LLM summarize/score/embed/extract-entities. Shared: `local-llm.ts` + the scoring functions (`pie.score_prospect`, `platinum.run_marginops_nightly`, intel enricher). All write embeddings to pgvector.
- **Act:** operator alerts to Slack/Telegram (Margin + Content watches) · outreach via `outreach-mcp`/HubSpot (Growth) · publish via `/api/postiz/post` (Content). Shared: one notification + one publish path.
- **Learn:** engagement/outcome capture re-ranks the next cycle. Shared: outcomes land in the entity graph + per-spine `*_engagement`/`*_outcome` tables.

## 5. Build roadmap (each phase independently shippable; grounded in today's state)

1. **Stabilize the spines that are live** _(done/near-done today)_ — Margin demo-ready (✅), Growth enricher proven (✅), Content live (✅). Remaining: Margin post-demo hardening (#8), Growth bulk drain (#9).
2. **Content/Intel spine build** — implement the Intel Cockpit (its plan, to be written from the approved spec). This is the first _new_ build and the template for the unified loop (Ingest→Understand→Act→Learn in one surface).
3. **Wire the shared substrate** — make all spines read/write the Relationship Memory graph as the single entity store; expose one cross-spine search ("everything about <entity>") over the shared pgvector index.
4. **Unify the cockpit** — one PulseCheck OS home that shows all four loops + a cross-spine "what needs my attention" feed (margin leaks + hot leads + content to publish + watches), driven by the shared MCP layer.
5. **Close the learning loops** — engagement→content ranking, won-pilot→lookalike-seed, fixed-leak→benchmark-update; the compounding layer.

## 6. Non-goals / risks

- **Not** rebuilding what works (Postiz, the MCP fleet, the dashboard shell, Relationship Memory). Reuse first.
- **Not** a single mega-migration — each spine evolves behind its existing interfaces.
- **Real-POS ingestion is the standing product risk** (Margin spine) — the demo is seeded; the live path is unproven. This is the highest-leverage post-pilot fix, not an architecture problem.
- **External-worker reachability** — Windmill (Growth/ETL orchestration) was unreachable from the dev session; durable in-PulseOS workers (like the proven Exa enricher) reduce that dependency.
- Schema sprawl is real (58 schemas / 906 tables); the unification should consolidate the entity model, not add a 5th spine.

## 7. Where this connects

- Intel Cockpit spec: `docs/superpowers/specs/2026-05-21-intel-cockpit-design.md`
- Margin pilot state + reseed: memory `project_marginops_pilot_data_reseed_2026-05-21`
- Growth enricher pattern: memory `project_growth_exa_enricher_2026-05-21`
- Relationship Memory spine: memory `project_relationship_memory_spine_2026-05-21`
