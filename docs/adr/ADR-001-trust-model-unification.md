# ADR-001: Unify dashboard DB access on a server-as-trust-boundary model

- **Status:** Proposed
- **Date:** 2026-05-31
- **Deciders:** Founder + senior-architect review
- **Relates to:** RLS migration `phase0_rls_intel_org_baselines_tighten` (2026-05-31); `.claude/rules/rls-enforcement.md` (`command_center` local-only exemption)

## Context

The dashboard currently uses **two contradictory data-access trust models against the same internet-facing production Supabase project** (`zcjgjfersccwwhjmaflw`):

| Path                                                               | Model                                                                                             | Credential                                                                                                                                                                                                                                                                                                         | RLS                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `command_center.*` (todos, agent*logs, autonomy_stats, content*\*) | **client-trusts-DB** — browser calls PostgREST directly                                           | Supabase **anon publishable key, committed in client source** (`src/lib/supabase-constants.ts:23`), shipped to the browser (`src/hooks/use-agent-outputs.ts:116`, `src/screens/mission-control/mission-control-screen.tsx:39`) and reused server-side via `commandCenterHeaders()` (`src/server/autonomy-loop.ts`) | `FOR ALL USING (true)` — cannot be locked without breaking the browser path |
| `intel.*`, `integrations.linkedin_*`                               | **server-as-trust-boundary** — browser calls an authenticated dashboard route which holds the key | **service_role**, server-only (`src/server/intel/db.ts`, `src/server/linkedin-supabase.ts`)                                                                                                                                                                                                                        | `service_role`-only (tightened 2026-05-31)                                  |

Consequences of the split:

- The anon publishable key is in committed source and valid on the public-internet DB endpoint from anywhere -> standing data exposure for all `command_center` rows.
- `command_center` RLS is **un-lockable** while the browser depends on `USING(true)` — documented as a local-only exemption, not a fix.
- It is the root blocker for cloud / multi-operator: org-isolation, multi-user RBAC, and RLS lockdown all require the server to own the trust boundary.

## Decision

**Adopt server-as-trust-boundary as the single data-access model.** The browser holds **no** Supabase credential. Every DB read/write flows through a dashboard server route that (1) enforces the existing `CLAWSUITE_PASSWORD`/session perimeter, (2) holds the `service_role` key server-side only, and (3) — for cloud — derives `organization_id` from the authenticated session, never from the client. This makes `command_center` match the model `intel.*` already uses.

`serve.mjs` becomes the single process holding DB credentials (this also resolves the prod-server SSOT divergence: Docker/electron must **reuse** `serve.mjs`, not reimplement a server that omits the trust boundary).

## Migration path (incremental; each step ships without breaking the prior state)

1. **Server data layer** `src/server/command-center/*` — port the fetch-based functions already centralized in `autonomy-loop.ts` (`claimNextTodo`/`completeTodo`/`blockTodo`/`writeAgentLog`/list reads) onto the `service_role` client, copying the `src/server/linkedin-supabase.ts` singleton pattern.
2. **Server routes** `/api/cc/{todos,agent-logs,autonomy-stats,content}` — `isAuthenticated`-gated thin wrappers over the data layer.
3. **Repoint callers** — `use-agent-outputs.ts` + `mission-control-screen.tsx` call `/api/cc/*` instead of PostgREST; `autonomy-loop.ts` uses the data layer instead of `commandCenterHeaders()`.
4. **Delete the anon path** — remove `SUPABASE_PUBLISHABLE_KEY` + `commandCenterHeaders` from client source, and **rotate that key** (it has been in git history).
5. **Lock RLS** — migration dropping the `command_center` `USING(true)` public policies -> `service_role`-only (mirrors the `intel.*` change of 2026-05-31). Safe once no caller uses the anon path.
6. **(Cloud only, later)** add `organization_id` columns + `org_isolation` policies; the server sets org context from the session JWT.

Steps 1–3 ship entirely behind the existing perimeter and touch no RLS. Steps 4–5 flip the switch only after every caller is migrated.

## Consequences

**Positive**

- One trust model; `command_center` RLS becomes lockable; the committed anon key is retired.
- Single credential holder (`serve.mjs`) -> forces prod-server SSOT and eliminates the Docker `server-entry.js` security-strip divergence.
- Unblocks the cloud track (org-isolation / RBAC become enforceable).

**Negative / trade-offs**

- One extra network hop (browser -> dashboard -> DB) for `command_center`. Acceptable for a local/low-traffic operator console.
- Loses any browser-side Supabase **realtime** subscription for `command_center` — today it is polled over REST (`use-agent-outputs.ts`), so no loss; **verify before step 3**.
- Effort: **medium, low-risk** — `autonomy-loop.ts` already centralizes ~80% of `command_center` access, and `intel/*` + `linkedin-supabase.ts` are a copy-paste template.

## Sequencing

This is the **first Phase-1 (cloud-enablement) work item** — before org-isolation, multi-user RBAC, or off-box orchestration, all of which depend on it. It is also the only path by which `command_center` RLS is ever locked.
