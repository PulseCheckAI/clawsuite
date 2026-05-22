# PulseCheck Knowledge Layer — Design Spec

**Date:** 2026-05-21
**Status:** Approved direction ("install, wire and build them all + LightRAG")
**Builds on:** `2026-05-21-pulsecheck-os-architecture.md`, `2026-05-21-intel-cockpit-design.md`

---

## 1. Thesis — one substrate, not four RAGs

The ask folds seven tools into the Intel Cockpit. Done naively that's **four competing retrieval engines** (pgvector intel search · wiki-LLM · LightRAG · NotebookLM) — a maintenance swamp. The discipline: **one deep-knowledge engine, one fast index, everything else a source into them or an output off them.**

- **Deep engine = LightRAG** — graph **+** vector RAG in one (entities + relations + chunks). It _subsumes_ the "Graphify" entity-graph need and any standalone vault-RAG. Runs on **Ollama** (local `nomic-embed-text` + `qwen2.5:3b`) — no cloud key.
- **Fast index = the existing `intel.*` pgvector store** — keep for sub-second feed search in the reader.
- **Storage unification:** LightRAG supports a **Postgres + pgvector backend** → point it at the _same Supabase_ (a `lightrag` schema). One database holds both. This is the clincher: not a new datastore, a new _capability_ on the one we have.

## 2. Component lanes (what each tool becomes)

| Tool                            | Lane                          | Action                                                                                      |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| **LightRAG**                    | The deep graph+vector engine  | **Install + wire** (Ollama backend, Postgres storage)                                       |
| **Obsidian / Brain / Vault**    | Knowledge **source**          | **Wire**: read canonical `brain/` via the Obsidian MCP → ingest into LightRAG (incremental) |
| **llm-wiki** (skill)            | Vault **curation** (raw→wiki) | **Keep as tooling**; LightRAG indexes the curated `wiki/`                                   |
| **wiki_llm.py** (APEX platinum) | Old vault-RAG                 | **Consolidate/retire** — LightRAG supersedes it (verify first)                              |
| **Graphify** (skill)            | Entity-graph concept          | **Covered** by LightRAG's graph; no separate build                                          |
| **LLM-council**                 | On-demand **deep synthesis**  | **Wire later**: a "deep analysis" action that runs council over LightRAG retrievals         |
| **NotebookLM**                  | **Output** (audio overview)   | **Wire last**; note: data egress to Google — opt-in only                                    |
| **intel.\* pgvector**           | Fast feed index (built, live) | Keep; bridge feeds into LightRAG too                                                        |

## 3. Architecture

```
SOURCES                         ENGINE                     SURFACES
feeds (intel.items) ─┐                                ┌─ Cockpit "Ask your brain" (/rss)
Obsidian brain/vault ─┼─► LightRAG (graph+vector) ───┼─ knowledge-mcp (agents)
llm-wiki curated wiki/┘     on Ollama + Postgres      ├─ LLM-council deep-dive (on demand)
                            (intel.* stays fast index) └─ outputs: Postiz · NotebookLM audio
```

**Query path:** question → LightRAG hybrid retrieve (vector chunks + graph neighborhood) → answer with citations (feeds + notes). Fast keyword/recency stays on `intel.*`.

## 4. Phased build (each phase shippable)

1. **Foundation** — stand up LightRAG (Ollama LLM+embeddings; Postgres/pgvector storage in Supabase `lightrag` schema). Ingest a **bounded vault slice** (one folder) + a sample of feed items. **Prove** a graph+vector query returns cited answers. Expose as `/api/intel/ask` (RAG) + a `knowledge-mcp` tool.
2. **Vault at scale** — incremental ingest of the **canonical** `brain/` via the Obsidian MCP (watch for the in-flight context-SSOT collapse — ingest the canonical tree only); bridge `intel.items` full_text into LightRAG; **retire wiki_llm.py** after parity check.
3. **Cockpit surface** — "Ask your brain" panel in `/rss` (streamed, cited); upgrade `intel-mcp.search_items` to call LightRAG hybrid; entity browser.
4. **Synthesis + outputs** — LLM-council "deep analysis" action over retrievals; NotebookLM audio-overview of the daily brief (opt-in, data-egress flagged).

## 5. Open decisions / risks

- **Canonical brain:** an SSOT collapse is in progress (`chore/context-ssot-collapse`); ingest the canonical `context/agent-brain/` tree only — do **not** embed drifted mirrors. **Blocking for Phase 2.**
- **LightRAG storage:** Postgres backend (recommended, unifies on Supabase) vs its default file/JSON store (simpler to start). Start file-based to prove, migrate to Postgres for Phase 2.
- **Embed volume:** 21K notes is a large batch on local Ollama — incremental + checkpointed, not one shot.
- **wiki_llm.py parity:** verify what it does before retiring (10-min read).
- **NotebookLM egress:** documents leave your infra — opt-in per-source only; never auto-push the whole brain.
- **No new RAG engines** beyond LightRAG. If a future tool wants RAG, it queries LightRAG.

## 6. Non-goals

- Not four parallel retrieval systems. Not embedding skills-as-app-features (graphify/llm-wiki stay Claude tooling). Not auto-sending the vault to a hosted product.
