# PulseOS Skill Platform — North-Star Architecture & Roadmap

**Status:** North-star (vision + architecture + sequencing). NOT an implementation spec.
**Date:** 2026-05-20
**Owner:** Thiago Costa
**Lens:** multi-agent system design (agent-designer framework applied in §4).
**Scope:** How the installed Claude skills become first-class PulseOS capabilities — from a manual runner up to an autonomous, data-triggered, multi-agent operations layer.

> This document defines the destination and the dependency order. Each numbered
> sub-project (S0–S3, P1) gets its **own** spec → plan → build cycle afterward.
> Do not treat this as buildable as-is; it is the map, not the route.

---

## 1. North Star

**PulseOS becomes an autonomous, multi-agent operations layer:** PulseCheck's own data and events trigger skill-powered actions, skills chain into pipelines, and specialized agents own them — so the product doesn't just _show_ problems, it _acts_ on them.

Progression, one line each:

1. **Run** any skill programmatically (foundation — S0).
2. **Trigger** skills from PulseCheck data/events (the moat — S1).
3. **Chain** skills into pipelines (a content/ops factory — S2).
4. **Specialize** agents with skill loadouts (a capable agent org — S3).

---

## 2. Current State (verified 2026-05-20)

**Two separate skill systems — the core constraint:**

| System                 | Location                                                                                 | Who reads it                                                   | Contains                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Claude Code skills** | `~/.claude/skills/`                                                                      | Claude Code sessions (CLI)                                     | The 20+ installed skills (creative-director, translate-book, marketing trio, …) |
| **OpenClaw skills**    | `~/.openclaw/{skills,plugin-skills,workspace/skills}` + `openclaw.json` `skills.entries` | OpenClaw gateway agents (Agent Floor, Slack bridge, Conductor) | `pulsecheck-slack-bridge`, `browser-automation`, `playwright`                   |

- **They do not overlap.** OpenClaw agents cannot read `~/.claude/skills`; `claude_launch` (OpenClaw → Claude Code) is blocked upstream (`@betrue` plugin exports `{register}` not `{tools}`).
- The dashboard's existing `api/skills.ts` is a browser/marketplace over the _OpenClaw_ skill system, not an executor of `~/.claude` skills.
- The dashboard has **no path that executes a `~/.claude` skill capability** today. `cli-agents.ts` only _lists_ processes (`ps aux`); `media/generate.ts` routes to a specific Wan2GP backend.

**Assets to build on (already present):** TanStack file-route API pattern (`isAuthenticated`+`requireJsonContentType`+`rateLimit`); async job+poll (`api/media/*`, `use-job-polling`); streaming chat→gateway (`api/send-stream.ts`, `use-streaming-message`); `cron`+`autonomy-tick`; OpenClaw `flows` engine (`~/.openclaw/flows/registry.sqlite`); named OpenClaw agents (`alex/maya/jordan/sam/dev/main`); domain MCPs (`marginops-mcp`, `content-mcp`, `crm-mcp`, `prospect-mcp`, `outreach-mcp`, `pulse-*`); `gateway/approvals` (human-in-the-loop).

---

## 3. Target Architecture (layered)

```
                    ┌──────────────────────────────────────────────┐
   data/events ──▶  │  S1  Event-triggered Action Layer            │
 (marginops,        │      (cron / autonomy-tick / MCP signals)    │
  prospect, …)      └───────────────────┬──────────────────────────┘
                                        │ submitRun()
   flows engine ──▶  ┌─────────────────▼──────────────────────────┐
   (chaining)        │  S2  Skill Pipelines (compose S0 runs)      │
                     └───────────────────┬──────────────────────────┘
                                        │
   agent loadouts ─▶ ┌─────────────────▼──────────────────────────┐
   (per-agent)       │  S3  Per-Agent Specialization               │
                     └───────────────────┬──────────────────────────┘
                                        │
                     ┌─────────────────▼──────────────────────────┐
                     │  S0  Skill Execution Engine  ◀── FOUNDATION │
                     │   listSkills() submitRun() getRun() resume()│
                     │   spawn `claude -p`, files in/out, stream   │
                     └─────────────────────────────────────────────┘
                              │ reads
                     ~/.claude/skills   +   claude CLI (local only)
```

Everything stands on **S0**. S1/S2/S3 are independent consumers of S0's interface.

---

## 4. Agent Architecture (agent-designer framework applied)

**Pattern selection:** a **hybrid** — _Hierarchical Supervisor_ for cross-domain coordination, _Pipeline_ for skill chains (S2), _Event-driven_ for triggers (S1). Rationale: PulseCheck has natural domains (margin ops, marketing, sales, eng) that map to specialist agents, with a coordinator for routing — but individual workflows are sequential pipelines, and the highest-value behavior is event-reactive. No pure swarm: outbound actions (emails, operator messages) need predictable, auditable control, not emergent behavior.

**Agent roster** (maps OpenClaw's named agents → archetypes; loadouts = S0 skill sets):

| Agent                     | Archetype                           | Skill loadout (via S0)                                                                      | Notes                                                   |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `main` / Conductor        | **Coordinator/Supervisor**          | (routing only)                                                                              | Allocates work, monitors, handles escalations/approvals |
| `maya`                    | **Specialist — Marketing**          | creative-director, co/community-marketing, directory-submissions, content-humanizer, postiz | Owns the S2 content pipeline                            |
| `dev`                     | **Specialist — Engineering**        | code-review, build-resolvers, tdd                                                           | Internal tooling                                        |
| `alex` / `jordan` / `sam` | **Specialist — Sales/Ops/Research** | cold-email, deep-research, prospect tooling                                                 | Loadouts TBD per their roles                            |
| MarginOps watcher         | **Monitor**                         | (emits events, no skills)                                                                   | `marginops-mcp` anomaly → S1 trigger                    |
| Slack bridge / Chat       | **Interface**                       | proxy to S0 / Conductor                                                                     | External I/O, auth                                      |

**Tool layer = S0.** S0 IS the tool interface every agent calls. Schema = the manifest (typed inputs, output type, cost tier); idempotency via `jobId`; errors surfaced verbatim with retry/backoff for transient `claude` spawn failures; manifests versioned.

**Communication & orchestration:** event-driven (S1 signals) + shared state (job registry + `memory`/`cc-kv`) + message passing (agent → S0). **Centralized** Conductor for cross-domain routing; **decentralized** sequential handoff within an S2 pipeline (step N output → step N+1 input). OpenClaw `flows` engine candidate for pipeline execution.

**Guardrails (safety):** manifest input validation; skillId allowlist; arg-array spawn (injection-safe); **human-in-the-loop approval for every outbound action** (reuse `gateway/approvals`); per-run + per-day cost ceilings; circuit-breaker on repeated skill failure; no fabricated output (`feedback_no_mock_data`).

**Evaluation framework:** task completion (skill-run success rate, retries); quality (domain outcome — e.g., operator acted on the leak-intervention; campaign engagement); cost (tokens/$ per run vs. cost tier); latency (run duration, queue time). Persist runs for audit + learning (`reasoningbank`/`continuous-learning` candidates).

**Failure handling:** exponential backoff + jitter on transient spawn/API failures; bounded retries; circuit breaker per skill; graceful degradation (fall back to notify-human / manual); concurrency cap to prevent cost runaway.

---

## 5. Sub-Projects

### S0 — Skill Execution Engine (FOUNDATION)

**Purpose:** programmatically execute any `~/.claude` skill, capture result + artifacts.
**Interface (the contract all agents/subsystems depend on):**

- `listSkills() → Manifest[]` — discover `~/.claude/skills`, parse SKILL.md frontmatter, merge curated per-skill overrides (input shape, output type, cost tier, timeout). **This manifest registry is the "all skills" deliverable.**
- `submitRun({skillId, inputs, files}) → {jobId}` — validate skillId (allowlist), stage files into per-job `cwd`, render prompt template, spawn `claude -p --output-format stream-json` (arg array).
- `getRun(jobId) → {status, stream, output, artifacts[], error}` — stream tokens; surface stdout + new files in `cwd` as artifacts.
- `resumeRun(jobId, input)` — `claude --resume` for iterative skills.
  **Boundary:** depends only on `node:child_process` + `fs`. No UI, MCP, or OpenClaw. Mirrors `wan2gp-adapter.ts`.

### S1 — Event-Triggered Action Layer (revolutionary #1 — the moat)

MarginOps leak / new prospect → auto-run a skill. Rules table (`event → skill + input mapping + guardrails`) evaluated on cron/event tick → `S0.submitRun`, gated by human approval for outbound actions. Turns BI into autonomous operations.

### S2 — Skill Pipelines (revolutionary #2)

Compose S0 runs: `deep-research → creative-director → content-humanizer → postiz`. Pipeline definition (ordered steps; output→input), executed via OpenClaw `flows` or a thin DAG runner over S0.

### S3 — Per-Agent Specialization (revolutionary #3)

Skill loadouts per OpenClaw agent (Maya=marketing, dev=eng). Either port select skills into OpenClaw invocation, or — preferred — an agent-callable tool that **proxies to S0** (avoids two-skill-system duplication).

### P1 — Leak → Intervention (pilot slice)

Thin S0+S1 vertical: demo surfaces a margin leak → content skill auto-drafts the operator fix. Real leak data (Corner Table seed) + real skill run — **no faked copy**. Demo line: "PulseCheck doesn't just find the leak — it writes the fix you send your kitchen."

---

## 5A. S0 Tool Interface Design (agent-tool-builder applied)

S0's value is its **tool surface** — the schema + descriptions agents see, not the implementation (the LLM never sees the code). Designed per agent-tool-builder: _descriptions > implementation_, ≤20 tools, explicit structured errors, return strings, validate before execute.

**Tool surface (4 tools — well under the ceiling):**

1. **`list_skills`** — "List installed Claude skills available to run, with inputs, cost tier, and when to use each. Call before `run_skill` to discover valid skillIds." No required params. Returns JSON string `[{skillId, name, whenToUse, inputs[], costTier, outputType}]`.
2. **`run_skill`** — "Execute one installed Claude skill as a background job; returns a jobId to poll. Use to generate content, translate files, ideate, etc. Does NOT return the result directly — poll `get_skill_run`." `input_schema`: `{ skillId (enum from list_skills), inputs (object matching that skill's contract), files (string[] of staged paths, optional), confirmHighCost (bool; required true for high cost-tier) }`. `input_examples`: creative-director (brief) + translate-book (file + target_lang). Returns `{"jobId":"…"}`. Errors (is_error=true): `unknown_skill` (+ closest-match suggestions), `validation_error` (+ field), `claude_unavailable`, `cost_gate`, `spawn_failed`.
3. **`get_skill_run`** — "Poll a run by jobId; returns status, output text, and produced file artifacts." `{jobId}` → text or structured error (`not_found`/`timed_out`/`skill_failed` + verbatim stderr).
4. **`resume_skill_run`** — "Continue an iterative run (e.g. refine a concept) with a follow-up instruction." `{jobId, input}`.

**Skill-manifest → tool-schema generation (the bridge to S3):** each manifest auto-generates a typed tool definition — description pulled from SKILL.md (_description quality drives invocation accuracy_), inputs → JSON Schema with per-param descriptions + examples, enums where possible. This makes every skill a first-class, agent-callable tool.

**Error taxonomy:** validation / external (claude unavailable or rate-limited → backoff+jitter) / business (skill failed → verbatim stderr) / internal. Every error returns `is_error: true` + actionable message + suggestions. Return JSON **strings**, never raw objects.

**Validation gates (reject before execute):** skillId allowlist · input-schema validation · file type + path-traversal checks · cost-tier gate. Never silently fail.

**MCP exposure (resolves Open Q4):** package S0 as an MCP server — **`skill-runner-mcp`** — exposing the 4 tools. Then every MCP-capable consumer reaches skills through one uniform surface: **OpenClaw agents** (closes the two-skill-system gap _without porting_ — this is S3's bridge), **Claude Code**, and the **dashboard**. MCP is the lingua franca: build the tool once, use everywhere. `skill-runner-mcp` becomes the canonical S0 boundary; dashboard API routes and OpenClaw agents are both just clients of it.

**Testing:** validate with the LLM (does Claude pick the right skillId from the descriptions?), not only unit tests — plus unit tests for validation, error taxonomy, and job lifecycle.

---

## 6. Sequencing / Roadmap

| Phase   | Build                                                     | Depends on                 | Timing                            |
| ------- | --------------------------------------------------------- | -------------------------- | --------------------------------- |
| **0**   | S0 Execution Engine + manifest registry (all skills)      | —                          | First; foundation                 |
| **0.5** | Founder Skill Runner UI (chat `/skill` + gallery) over S0 | S0                         | Parallel/optional                 |
| **1**   | P1 Leak→Intervention vertical                             | minimal S0 + 1 S1 rule     | Only if it doesn't risk the pilot |
| **2**   | S1 full Action Layer                                      | S0 + MCPs/cron + approvals | Post-pilot                        |
| **2**   | S2 Pipelines                                              | S0 + flows                 | Post-pilot                        |
| **2**   | S3 Per-Agent Specialization                               | S0 + OpenClaw→S0 proxy     | Post-pilot                        |

**Honest reality check:** S1/S2/S3 are a multi-week platform build; none ship before 2026-05-26. S0 is the boundable foundation. P1 is the only revolutionary-path item that could touch the pilot, and even that is tight and competes with pilot-critical work. The pilot deadline takes priority.

---

## 7. Cross-Cutting Concerns

- **Local vs deployed:** S0 needs `claude` CLI + `~/.claude/skills` → local PulseOS (PM2) only, NOT Render. S0-backed routes must return a clear "unavailable here" error otherwise.
- **Cost:** each run is a real billed Claude call; some large (translate-book ≈ 11 sub-agents / ~1.3M tokens). Manifest cost tiers; confirmation for high-cost; S1 auto-run budget ceilings.
- **Security:** auth all routes; skillId allowlist; arg-array spawn; outbound actions human-gated. Note: `openclaw.json` stores Slack/webSearch secrets in plaintext — rotate + move to secret refs (tracked separately).
- **No mock data:** real runs or explicit empty/`[unverified]` states only.
- **Observability:** persist run history (`cc-kv`/`memory`); surface failures verbatim.

---

## 8. Open Questions (resolve per sub-project spec)

1. S0: does `claude -p` reliably auto-invoke a named skill from a prompt, or do we need an explicit invocation mechanism? (Validate in an S0 spike.)
2. S1: which events first; approval UX for outbound actions?
3. S2: OpenClaw `flows` engine vs. a thin in-dashboard DAG runner?
4. ~~S3: port into OpenClaw vs. proxy OpenClaw→S0?~~ **Resolved (§5A):** expose S0 as `skill-runner-mcp`; OpenClaw, Claude Code, and the dashboard all consume it via MCP — no porting.
5. Cost ceiling for autonomous (S1) runs before mandatory human approval?

---

## 9. Next Steps

1. **Review this north-star** (you) — adjust vision/sequencing/agent roster.
2. **Brainstorm S0 to an implementation spec** (own spec → plan → build cycle). S0 unblocks everything.
3. Write thin per-subsystem specs for S1/S2/S3 when their phase arrives.
4. Decide P1-for-pilot based on bandwidth, weighed against 2026-05-26.
