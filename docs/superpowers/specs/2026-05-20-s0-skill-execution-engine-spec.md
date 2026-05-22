# S0 — Skill Execution Engine — Implementation Spec

**Status:** Implementation spec (ready for `writing-plans` after review)
**Date:** 2026-05-20
**Parent:** `2026-05-20-pulseos-skill-platform-northstar.md` §5 + §5A
**Goal:** A module that programmatically executes any installed `~/.claude` skill headlessly, captures text + file artifacts, and exposes it through one small tool surface — canonically an MCP server (`skill-runner-mcp`) consumed by OpenClaw, Claude Code, and the dashboard.

---

## 1. Goal & Non-Goals

**Goal:** `list / run / poll / resume` Claude skills headlessly, with validation, structured errors, cost/concurrency/timeout guards, file in/out.

**Non-goals (explicitly out of S0):** event triggers (S1), pipelines (S2), per-agent assignment (S3), polished UI. Not customer/pilot-facing. No persistence beyond in-memory in the first cut.

---

## 2. Architecture — three layers, one core

1. **Core module** (`os/skill-runner/src/core/`) — pure TS, no HTTP/MCP. Owns discovery, manifest, job registry, spawn, file I/O, errors. Independently testable.
2. **MCP server** (`os/skill-runner/src/mcp/`) — wraps the core as 4 MCP tools. The **canonical** surface (§5A); consumed by OpenClaw + Claude Code + dashboard.
3. **Dashboard adapter** — thin. For MVP the dashboard imports the core in-process via API routes (`api/skill-run.ts`, `api/skill-run.$jobId.ts`, `api/claude-skills.ts`); longer-term it can call `skill-runner-mcp`.

**Placement decision:** a **standalone `os/skill-runner/` package** (not buried in the dashboard) so the MCP server can run independently and both the dashboard and OpenClaw import the same core. Mirrors how other `os/*` workers are structured.

---

## 3. Skill Discovery + Manifest (the "all skills" registry)

- **Source:** `~/.claude/skills/**/SKILL.md` (recursive, reusing the frontmatter parser already in `dashboard-clawsuite/src/routes/api/skills.ts` — extract it to a shared util `parseSkillFrontmatter`).
- **Manifest type:**
  ```ts
  type Manifest = {
    skillId: string
    name: string
    description: string
    whenToUse: string
    category: string
    inputs: InputField[] // typed input contract
    promptTemplate: string // renders inputs → the prompt for `claude -p`
    outputType: 'text' | 'artifacts' | 'both'
    costTier: 'low' | 'med' | 'high'
    timeoutMs: number
  }
  type InputField = {
    key: string
    label: string
    type: 'text' | 'textarea' | 'file' | 'select' | 'number'
    required: boolean
    options?: string[]
    accept?: string
    default?: unknown
  }
  ```
- **Defaults** auto-derived from SKILL.md frontmatter (`description`, `metadata.requires`, `allowed-tools`): text-in → text-out, cost `low`, timeout 5 min.
- **Curated overrides** (`skill-manifests.overrides.ts`) for flagship skills, e.g.:
  - `translate-book` → inputs: file(accept epub/docx/pdf) + target_lang(select) + concurrency(number); outputType artifacts; costTier **high**; timeout 20 min.
  - `creative-director` → inputs: brief(textarea) + mode(select insight/big-idea/full); outputType text; costTier med; iterative.
  - marketing trio → inputs: context fields; text; low–med.
- **Cache** with TTL (reuse the `api/skills.ts` cache approach).

---

## 4. Operations (core interface)

- `listSkills(): Manifest[]`
- `submitRun({ skillId, inputs, files?, confirmHighCost? }): { jobId } | StructuredError`
- `getRun(jobId): { status: 'queued'|'running'|'done'|'error', output, artifacts[], error?, stream? }`
- `resumeRun(jobId, input): { jobId } | StructuredError`

Schemas + descriptions for the MCP tool wrappers are defined in north-star §5A.

---

## 5. `claude -p` Invocation (core mechanic) — **Phase 0 spike required**

The load-bearing unknown (north-star Open Q1): how to reliably force a _named_ skill in headless mode, and what permission model headless skills need (translate-book needs Bash/Write).

**Spike to run first (do not skip):**

1. `claude -p "Use the <skillId> skill.\n\n<rendered input>" --output-format stream-json` in a temp `cwd` — does Claude reliably load + run the named skill?
2. Headless permissions: skills that shell out (translate-book) need tool permissions. Test the minimal safe flag (`--permission-mode acceptEdits` vs broader) — **prefer the narrowest that works**; document the security trade-off. Do NOT default to `--dangerously-skip-permissions`.
3. Auth/account: confirm which logged-in Claude account the dashboard's PM2 process uses (`~/.claude` vs `~/.claude-account2`) and that headless runs authenticate.

**Spawn:** `execFile('claude', [...args], { cwd: jobDir, timeout })` — **argument array, never a shell string**. Parse `stream-json` stdout into incremental output + completion; capture stderr for `skill_failed`.

---

## 6. Job Registry, Concurrency, Timeout, Output

- In-memory `Map<jobId, Job>` (MVP; note future persistence to `cc-kv`/`memory`).
- **Concurrency cap** (default 2 concurrent `claude` procs); queue beyond.
- **Per-job timeout** from manifest (default 15 min). On timeout: kill the child process tree; status `error` (`timed_out`).
- **Output cap** (default 1 MB): truncate + flag.

---

## 7. File I/O

- **Input:** uploaded files staged into per-job `jobDir` (under a runner temp root). Validate against the field's `accept` + reject path traversal. Paths injected into the rendered prompt/inputs.
- **Output artifacts:** after the run, diff `jobDir` for **new** files → `artifacts: [{ name, path, size }]`, surfaced as downloads.

---

## 8. Error Taxonomy (structured, `is_error: true`, return strings)

`unknown_skill` (+ closest-match suggestions) · `validation_error` (+ field) · `claude_unavailable` (no CLI / no `~/.claude/skills`, e.g. Render) · `cost_gate` (high tier needs `confirmHighCost`) · `spawn_failed` · `timed_out` · `skill_failed` (+ verbatim stderr) · `internal`. Transient external failures use backoff+jitter; never silently fail.

---

## 9. Security / Cost / Local-Only

- Auth on all dashboard routes; access control on the MCP server.
- `skillId` allowlist; arg-array spawn; file-type + traversal validation.
- `claude_unavailable` returned cleanly where `claude` CLI / `~/.claude/skills` are absent.
- Cost: manifest `costTier`; `high` requires `confirmHighCost: true`; global **daily token/$ ceiling** (config) — guards against an accidental translate-book storm (~1.3M tokens/run observed).

---

## 10. MCP Server (`skill-runner-mcp`)

Node MCP server (`@modelcontextprotocol/sdk`), stdio (+ optional HTTP/SSE). Exposes the 4 tools from §5A. Registered with: Claude Code (mcp config), OpenClaw (`openclaw.json` mcp servers — this is how OpenClaw agents gain skills, no porting), and the dashboard. Built **after** the core is green.

---

## 11. Testing

- **Core unit tests** (mock spawn): manifest discovery/parse, override merge, `submitRun` validation (unknown skill, missing required input, cost gate, bad file type), job lifecycle, timeout kill, artifact diff, output cap.
- **Override schema** validation test.
- **MCP tool tests** + an **LLM-in-the-loop** check (does Claude pick the right `skillId` from descriptions — per agent-tool-builder).
- **Manual acceptance:** creative-director (text) and translate-book (file → `.epub`) through the core, then through the MCP server.

---

## 12. Phasing (within S0)

- **Phase 0 — Spike:** resolve §5 (`claude -p` skill invocation + headless permission model + account). Output: a one-page decision note. _Gate: if headless skill invocation isn't reliable, revisit the whole approach before building._
- **Phase 1 — Core:** discovery + manifest (+ flagship overrides), `submitRun/getRun/resumeRun`, job registry, file I/O, error taxonomy, unit tests.
- **Phase 2 — MCP server:** `skill-runner-mcp` over the core; register with one consumer; tool + LLM tests.
- **Phase 3 — Minimal dashboard surface (optional):** chat `/skill` or a simple runner screen over the core.

---

## 13. Open Questions (resolve in Phase 0 / plan)

1. `claude -p` named-skill invocation + minimal headless permissions (Phase 0 spike — load-bearing).
2. Which Claude account/auth the dashboard PM2 process runs as.
3. Standalone `os/skill-runner` package vs in-dashboard module (recommend standalone).
4. Persistence now or later (recommend later — in-memory MVP).

---

## 14. Definition of Done (S0)

- `skill-runner` core executes **creative-director** (text out) and **translate-book** (file → `.epub` artifact) headlessly, with validation, structured errors, timeout, and concurrency cap — covered by unit tests.
- `skill-runner-mcp` exposes the 4 tools and is consumed by **at least one** of {Claude Code, OpenClaw, dashboard}.
- A short Phase-0 decision note documents the headless invocation + permission model.
