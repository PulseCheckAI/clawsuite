# Intel Cockpit — Design Spec

**Date:** 2026-05-21
**Status:** Approved (scope: maximal / "all options")
**Surface:** Evolve the existing `/rss` (RSS Cockpit) into the full **Intel Cockpit**
**Repo:** `os/dashboard-clawsuite` (TanStack Start + React, Vite, port 3010, Vitest)

---

## 1. Thesis

Folo, Inoreader, and Feedly stop at **reading**. The Intel Cockpit closes a self-hosted **content operating loop** that we own end to end:

> **Ingest → Understand → Triage → Act**

It turns the firehose into (a) a **daily AI brief filtered to our goals** (restaurant SaaS, AI agents, founder ops — not generic popularity) and (b) a **one-click publish pipeline** to our live channels, with semantic dedup, an entity graph, RAG over everything we've read, and a learning loop that improves what gets surfaced _and_ how posts are drafted based on real audience engagement. Read → draft → publish in one owned surface is the wedge no incumbent has.

## 2. Goals

- Replace Inoreader/Folo/Feedly as the single place we read.
- Ingest **any** source: RSSHub routes, direct RSS/Atom URLs, **email newsletters**, plus full-text of linked articles.
- Make every item **understood**: TL;DR summary, embedding, tags, extracted entities, relevance score vs. an interest profile.
- Collapse duplicate coverage into **stories**; produce a **daily brief**.
- **Search/ask** the corpus semantically (RAG).
- **Act**: generate per-platform drafts and publish via the existing Postiz pipeline.
- **Learn**: feed Postiz engagement back into triage ranking and draft generation.
- **Watch**: push high-relevance / watched-entity hits to Slack/Telegram.
- **Cross-wire**: surface industry/prospect trigger events into the CRM/lead-gen pipeline.

## 3. Non-Goals

- Multi-tenant / multi-user accounts. Single operator (Thiago). Read/saved state is global, not per-user.
- A public-facing reader. This lives behind the dashboard's existing auth.
- Re-implementing RSSHub. We consume it; we don't fork it.
- A mobile app. Responsive web inside the existing Electron/PulseOS shell only.

## 4. Architecture Overview

Fifteen isolated units, grouped by loop stage. Each communicates through a typed interface (a route handler or a `src/server/intel/*` module) and is independently testable.

```
                ┌─────────── INGEST ───────────┐
 sources ──►  1 Source Registry
                2 RSS/RSSHub Ingestor ─┐
                3 Email Ingestor ───────┼─► intel.items (raw)
                4 Full-text Extractor ──┘        │
                                                 ▼
                ┌────────── UNDERSTAND ──────────┐
                5 Enricher (summary+embedding+tags+score)
                6 Entity Extractor ──► intel.entities
                7 Clusterer ──► intel.stories
                                                 │
                ┌─────────── TRIAGE ─────────────┤
                8 Brief Generator ──► intel.briefs
                9 Reader Cockpit UI (evolve /rss)
               10 Semantic Search + RAG chat
               11 Watches & Alerts ──► Slack/Telegram
               12 Feedback capture (thumbs)
                                                 │
                ┌──────────── ACT ───────────────┤
               13 Draft Generator ──► /api/postiz/post
               14 Engagement-Learning loop (Postiz analytics → re-rank)
               15 CRM / Lead-gen cross-wire (trigger → CRM)

  Orchestration: `intel-pipeline` PM2 sidecar (evolves rss-autopost-ticker)
  runs the staged pipeline; every stage is idempotent + best-effort.
```

## 5. Data Model (Supabase, schema `intel`)

All tables in a dedicated `intel` schema (exposed via the `ALTER ROLE authenticator SET pgrst.db_schemas` pattern already used in this project). pgvector required.

| Table                 | Key columns                                                                                                                    | Purpose                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `intel.sources`       | id, label, kind (`rsshub`\|`rss`\|`email`), route_or_url, folder, interest_weight (0–1), enabled, last_polled_at, last_status  | Feed registry; OPML/email seed targets here.              |
| `intel.items`         | id, source_id FK, title, link, author, pub_date, raw_snippet, full_text (nullable), lang, dedupe_hash, read, saved, fetched_at | Raw immutable item. `(source_id, link)` unique.           |
| `intel.item_ai`       | item_id FK (1:1), summary, embedding `vector(768)`, tags text[], relevance_score, model, version, created_at                   | Enrichment, separated so re-enrichment never mutates raw. |
| `intel.entities`      | id, name, type (`person`\|`company`\|`product`\|`topic`), canonical                                                            | Entity graph nodes.                                       |
| `intel.item_entities` | item_id, entity_id, salience                                                                                                   | Item↔entity edges.                                        |
| `intel.stories`       | id, title, summary, top_item_id, score, item_count, created_at, updated_at                                                     | Clustered story.                                          |
| `intel.story_items`   | story_id, item_id                                                                                                              | Story membership (item belongs to ≤1 story).              |
| `intel.briefs`        | id, date, content (markdown), story_ids[], created_at                                                                          | Daily digest.                                             |
| `intel.feedback`      | item_id, vote (−1\|0\|1), created_at                                                                                           | Thumbs signal for personalization.                        |
| `intel.watches`       | id, query (keyword) \| entity_id, channel (`slack`\|`telegram`), target, enabled, last_fired_at                                | Proactive alerting.                                       |
| `intel.drafts`        | id, story_id \| item_id, platform, content, status (`draft`\|`posted`), postiz_post_id, created_at                             | Act output; links to engagement.                          |
| `intel.engagement`    | postiz_post_id, platform, metric, value, captured_at                                                                           | Postiz analytics snapshots for the learning loop.         |
| `intel.triggers`      | item_id, trigger_type, entity_id, prospect_payload jsonb, pushed_to_crm, created_at                                            | CRM cross-wire candidates.                                |

**Embedding dimension decision:** default to local Ollama `nomic-embed-text` (**768-dim**) for zero-cost bulk embedding on the RTX 5060. The `vector(768)` column is dimension-locked; switching to a cloud model (e.g. OpenAI 1536-dim) later requires a re-embed migration. Documented as a known trade-off, not a blocker.

## 6. Units — interface, behavior, dependencies

### INGEST

**1. Source Registry** — `src/routes/api/intel/sources.ts` (GET/POST/PUT/DELETE) + `src/server/intel/sources-store.ts`.

- CRUD over `intel.sources`. OPML import endpoint parses `C:\Users\costa\inoreader-feeds.opml` (and uploads) → rows. Gmail label config (which labels map to which folder).
- Depends on: Supabase.

**2. RSS/RSSHub Ingestor** — `src/server/intel/ingest-rss.ts`.

- For each enabled `rsshub`/`rss` source, fetch via the existing `/api/rss/feed` (RSSHub routes; SSRF-safe) or a direct-URL RSS path that reuses `feed.ts`'s parser. Upsert into `intel.items`, link-dedupe via `dedupe_hash`.
- Depends on: `/api/rss/feed`, Supabase. **Network note:** dashboard runs on host → RSSHub at `localhost:1200` (already correct in `feed.ts`).

**3. Email Ingestor** — `src/server/intel/ingest-email.ts` + `src/routes/api/intel/email-poll.ts`.

- Pulls newsletter emails for configured labels, converts to `intel.items` (sender → source, subject → title, body → full_text).
- **OPEN DECISION (see §10):** the dashboard process needs its _own_ Gmail credentials at runtime — the claude.ai Gmail connector is an interactive MCP tool, not a backend credential. Options: Gmail API OAuth (service), IMAP app-password, or a forwarding address + inbound parse. Spec defaults to **IMAP app-password** (simplest unattended path) unless overridden.

**4. Full-text Extractor** — `src/server/intel/extract.ts`.

- For items with only a snippet, fetch the article and extract clean body text (readability algorithm; `@mozilla/readability` + `linkedom`, or `@extractus/article-extractor`). Writes `intel.items.full_text`. SSRF-guarded allowlist of schemes (http/https only), size cap, timeout — mirrors `feed.ts` guards.
- Depends on: a new dep (article extractor), Supabase.

### UNDERSTAND

**5. Enricher** — `src/server/intel/enrich.ts` + `src/server/intel/llm.ts` (provider abstraction).

- Per new item: 3-bullet summary, embedding, 3–6 tags, relevance score (0–1) vs. the interest profile (a config doc of weighted topics). Local-first via Ollama HTTP (`/api/generate`, `/api/embeddings`, `nomic-embed-text` + `qwen2.5`), cloud fallback (Anthropic/OpenAI via fetch) on local failure/timeout. Writes `intel.item_ai`.
- Depends on: Ollama (GPU, `OLLAMA_LLM_LIBRARY=cuda_v13`), Supabase, pgvector.

**6. Entity Extractor** — `src/server/intel/entities.ts`.

- LLM extracts people/companies/products/topics from summary+full_text; upserts `intel.entities` (canonicalized) + `intel.item_entities` with salience.
- Depends on: llm.ts, Supabase.

**7. Clusterer** — `src/server/intel/cluster.ts`.

- For each new enriched item, cosine-nearest existing item within a recency window; if ≥ threshold, attach to that item's story, else open a new story. Maintains `intel.stories` rollups (title/summary/score/count).
- Depends on: pgvector (`<=>` operator / `match` RPC), Supabase. Threshold is a tunable config constant.

### TRIAGE

**8. Brief Generator** — `src/routes/api/intel/brief.ts` (GET current, POST regenerate) + `src/server/intel/brief.ts`.

- Ranks today's stories by score×interest_weight×recency×engagement-prior; LLM writes a markdown digest of the top N. Persists to `intel.briefs`.

**9. Reader Cockpit UI** — `src/screens/rss/rss-screen.tsx` evolved (route stays `/rss`; labeled "Intel").

- Source/folder sidebar; story+item list with summary, tags, score, entity chips; filters (folder, tag, score, unread, saved); item detail with full text + "Draft post" + thumbs; Daily Brief panel; Search box; Watches manager. Emerald accent already established by the autopost panel.
- Depends on: all read APIs below.

**10. Semantic Search + RAG** — `src/routes/api/intel/search.ts` (vector search) + `src/routes/api/intel/ask.ts` (RAG chat, streamed).

- Search: embed query → pgvector top-k over `intel.item_ai`. Ask: retrieve top-k → LLM answer with citations. Reuses the gateway chat-stream pattern.

**11. Watches & Alerts** — `src/server/intel/watches.ts` + `src/routes/api/intel/watches.ts` (CRUD).

- On each pipeline run, evaluate enabled watches against new items (keyword or entity match); on hit, push to Slack (`mcp__slack` server / webhook) or Telegram (existing Postiz/bot path); record `last_fired_at` to debounce.

**12. Feedback capture** — `src/routes/api/intel/feedback.ts`.

- Records thumbs into `intel.feedback`. Consumed later by the interest-profile re-weighting (Phase 4); captured from day one so history exists.

### ACT

**13. Draft Generator** — `src/routes/api/intel/draft.ts` + `src/server/intel/draft.ts`.

- Given a story/item + target platforms, LLM writes per-platform drafts (char-limit aware per platform; tone profile). Saves to `intel.drafts`. "Publish" → existing `/api/postiz/post` (LinkedIn still hard-rejected there). De-dupes against already-`posted` drafts so we never re-post the same story.
- Depends on: llm.ts, `/api/postiz/post`, Supabase.

**14. Engagement-Learning loop** — `src/server/intel/engagement.ts`.

- Periodically pulls `/api/postiz/analytics` for posted drafts → `intel.engagement`. Aggregates an **engagement prior** by tag/entity/platform that feeds (a) Brief ranking and (b) Draft Generator's style guidance. This is the defensible, no-incumbent capability.
- Depends on: `/api/postiz/analytics`, Supabase.

**15. CRM / Lead-gen cross-wire** — `src/server/intel/triggers.ts` + `src/routes/api/intel/triggers.ts`.

- Rule/LLM detection of industry/prospect trigger events (e.g. a restaurant in the news, a competitor raise) → `intel.triggers`; operator-approved triggers push into the CRM/lead-gen pipeline (`crm-mcp` / `outreach-mcp` / Supabase lead tables). Human-in-the-loop gate before any CRM write.

### Orchestration

**`intel-pipeline` sidecar** — evolve `scripts/rss-autopost-ticker.cjs` into `scripts/intel-pipeline.cjs` (PM2). On each tick, POST `/api/intel/pipeline/run` which executes stages in order: ingest (rss+email) → extract → enrich → entities → cluster → watches; with brief generation and engagement pull on slower cadences. Each stage self-gates and is idempotent. The existing `rss-autopost` ticker/feature remains until Unit 13 supersedes it, then is folded in.

## 7. Data Flow

`sources` → **Ingestor**(2,3) → `intel.items` (raw) → **Extractor**(4) fills `full_text` → **Enricher**(5) writes `item_ai` → **Entity Extractor**(6) writes entities → **Clusterer**(7) groups into `stories` → consumed by **Brief**(8), **Reader**(9), **Search/RAG**(10), **Watches**(11) → operator acts via **Draft**(13) → `/api/postiz/post` → **Engagement loop**(14) pulls analytics back → re-ranks Brief & informs Draft. **Feedback**(12) and **Triggers**(15) are side-channels off the item/story stream.

## 8. Error Handling

- **Per-item status, never block the batch.** Each stage records success/failure per item; one malformed feed/article/LLM call is logged and skipped, the pipeline continues.
- **Idempotent + dedup-guarded.** Re-running any stage is safe; `dedupe_hash` and 1:1 `item_ai` prevent reprocessing/duplication.
- **LLM resilience.** Local Ollama first with timeout; on failure fall back to cloud; on total failure leave item un-enriched (still readable raw) and retry next tick.
- **Network guards.** Full-text extractor and RSS fetch keep `feed.ts`'s SSRF posture: http(s) only, size cap, abort timeout.
- **Cost guard.** Cloud LLM is fallback-only + rate-limited; bulk enrichment stays local.
- **Auth.** All `/api/intel/*` routes use the existing `isAuthenticated` middleware (loopback pipeline relies on the same bypass-when-unset behavior as autopost; switch to server-fn imports if `CLAWSUITE_PASSWORD` is set).

## 9. Testing Strategy

Follow the existing `*.test.ts` + Vitest pattern (as in `src/routes/api/postiz/*.test.ts`).

- **Pure logic (unit):** dedupe_hash, full-text extraction on fixtures, relevance scoring, clustering threshold decision, per-platform char-limit/truncation in Draft Generator, OPML parse.
- **Route handlers:** auth gates, validation, error envelopes for each `/api/intel/*` route (mock Supabase + llm).
- **Integration:** seed one source → run pipeline → assert items/enrichments/story/brief produced (against a local/ephemeral Postgres + a stubbed LLM).
- **Gate:** `pnpm test`, `pnpm typecheck`, `pnpm lint` green before each phase merges.

## 10. Open Decisions & Risks

1. **Email ingestion credential path (blocking Unit 3).** claude.ai Gmail connector ≠ a backend credential. Default plan: **IMAP app-password** for unattended polling; alternatives are Gmail API OAuth or an inbound forwarding address. Needs operator choice + a credential (stored as an env/Supabase secret, never printed).
2. **Embedding dimension lock-in.** `vector(768)` (local nomic-embed-text). Cloud switch later = re-embed migration. Accepted.
3. **Full-text extractor dependency.** Adds `@extractus/article-extractor` (or readability+linkedom). New dep; vet bundle/size.
4. **CRM cross-wire (Unit 15) is human-gated.** No autonomous CRM writes; operator approves each trigger. Keeps blast radius small.
5. **Interest profile source of truth.** A config doc (weighted topics) — start hand-authored, later auto-tuned by feedback+engagement.
6. **Scale.** Volume is operator-scale (hundreds–low thousands of items/day). Single Postgres + pgvector is ample; no sharding needed.

## 11. Phased Build Order

- **Phase 1 — Foundation (reader parity):** Units 1, 2, 4 + `intel` schema (sources/items) + OPML import + basic Reader list in `/rss`. → Replaces Inoreader.
- **Phase 2 — Intelligence (the leap):** Units 5, 6, 12 + Reader UI with summaries/scores/tags/entity chips/filters + Unit 3 (email) + Unit 10 (search). → Beats Folo/Feedly's AI.
- **Phase 3 — Synthesis:** Units 7 (clusterer), 8 (brief), 11 (watches), RAG `ask`. → Daily intelligence brief + proactive alerts.
- **Phase 4 — Act + Learning:** Units 13 (draft→Postiz), 14 (engagement-learning), 15 (CRM cross-wire). Fold the existing `rss-autopost` into Unit 13. → The closed loop.

Each phase is independently shippable and leaves the previous phase fully working.
