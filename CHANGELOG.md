# Changelog

All notable changes to ClawSuite are documented here.

---

## [4.0.0] — Draft, 2026-05-14 (feat/pulsecheck-mission-control-harmony)

Major release rebranding ClawSuite into the **PulseOS Command Center** surface for PulseCheck, adding a live multi-agent control plane backed by Supabase. 782 commits since v3.0.0. The Conductor (formerly Agent Hub) and the new Mission Control screen are the headline surfaces; everything else supports them.

> **Note:** Some items below are PulseCheck-fork-specific (autonomy loop, Supabase Realtime, PulseOS branding); the rest are generic ClawSuite improvements that any fork inherits.

### 🚀 New Features

#### Mission Control + Tier 1 Autonomy

- **Mission Control screen** (`src/screens/mission-control/`): Liquid-Glass-styled command surface reading from `command_center.todos` and `command_center.agent_logs`. Cold-start REST fetch + live updates via `postgres_changes`.
- **Tier 1 autonomy loop** (`src/server/autonomy-loop.ts`): polls Supabase every 60s for `status='todo' AND assignee='Claude'`, locks via PostgREST atomic PATCH with filter, dispatches via OpenClaw gateway (`gatewayRpc('agent', …)` with deterministic idempotencyKey `${taskId}:${attempt}:${rand8}`), writes results to `agent_logs`. Category → agent map: Marketing→jordan, Development→dev, Personal→alex, Work→main.
- **Manual + automatic dispatch**: `POST /api/autonomy-tick` (auth + CSRF + rate-limit) for on-demand ticks; opt-in 60s self-start via `PULSEOS_AUTONOMY_LOOP_ENABLED=true`.
- **`GET /api/autonomy-status`**: read-only state snapshot for ops dashboards.
- **Stale-recovery sweep**: rescues `in_progress` rows older than `STALE_TIMEOUT_MS` (10 min) before each tick.
- **Retry semantics**: bounded by `MAX_ATTEMPTS=3` with retry counter; row demoted back to `todo` with `track_status='At Risk'` on failure.
- **Counter persistence**: `command_center.autonomy_stats` table survives dev-server restarts; hydrated on boot, flushed on each tick.

#### Conductor (renamed from Agent Hub)

- **Conductor home redesign**: hero office, compact input bar, New Mission popup modal, tighter activity rows.
- **Continue mission**: carry-forward context from a complete phase into a new run; steer remains best-effort.
- **History preview fix**: outputs re-saved when worker results arrive; preview skipped for ephemeral `/tmp` history entries.
- **Mission lifecycle restore**: in-flight missions survive navigation/reload.
- **Conductor terminology rolled out** across sidebar, command palette, dashboard, onboarding, Electron tray.

#### PulseOS Branding & Liquid Glass Theme

- **PulseCheck Mission Control Navy theme** (`oklch(0.18 0.08 248)` background, silver `rgba(170,178,195,0.4)` borders, white text). One-shot localStorage migration auto-upgrades legacy `ops-dark`/`premium-dark`/`sunset-brand` users.
- **Apple iOS 26 Liquid Glass** (`backdrop-filter: blur(20px) saturate(180%)`) applied globally via CSS `:where()` targeting `rounded-{xl,2xl,3xl}` + bordered surfaces. Excludes status-tinted palettes.
- **PulseCheck wave logo** with WebP source + 1.4:1 aspect ratio, replaces ClawSuite wordmark in the sidebar.
- **Sidebar rebrand**: "ClawSuite" → "PulseOS" with wave-colored "OS".

#### Operations + Mobile

- **Operations screen restored** (`feat(operations)`): multi-agent dashboard with squad status, services health, scheduled jobs, recent sessions.
- **Mobile quick menu**: Operations, Tasks, and Conductor added to the bottom quick-actions row.
- **Logo-tap quick menu** fixed on mobile.

#### Skills, Cron, Files

- **Cron popup wizard**: friendly schedule picker + task builder, replaces the old inline form.
- **Skills marketplace dedup + English filter**: removes ClawHub API duplicate paginated entries and CJK-heavy results (>30% CJK chars).
- **Files page Monaco→textarea swap**: Monaco was CDN-loaded (`cdn.jsdelivr`) and blocked by CSP `script-src 'self'`. Replaced with a styled textarea — no CDN dependency.
- **Agent Roster panel** (5 agents: Alex/Maya/Jordan/Dev/Sam) sourced from the `.claude/agents/agent-os/*.md` definitions.
- **System Integrations panel**: filesystem + gateway-RPC probes for Codex CLI, Claude Dreams, Telegram channels, default agent.

#### Electron Desktop App

- **Standalone DMG/EXE** (127MB): esbuild-inlined SSR server, no `node_modules` bundling. Boot path: `prod-server.cjs`.
- **First-launch wizard redirect** + update checker + tray fixes.
- **Auto-launch + tray icon** plumbing.

#### Remote & Mobile Access

- **HTTPS access guide** (`docs/remote-access.md`, `docs/mobile-setup.md`): Tailscale + `local-ssl-proxy` (TLS termination), LAN with local IP, Windows WSL2 portproxy. (#43)

### 🐛 Bug Fixes

- **Gateway singleton auto-heal**: `getLiveClient()` replaces a destroyed singleton on demand; `/api/gateway-restart` calls local `gatewayReconnect()` instead of the removed `gateway.restart` RPC.
- **Onboarding white screen**: faster gateway feedback, fixed docs.
- **SSR off on all routes**: `cb21e57` — silences `nodes.list` RPC error, eliminates hydration crashes. (#46, #48)
- **Aggressive-polling perf**: reduced default intervals across browser-view + status panels. (#47)
- **Circuit-breaker tuning**: ignores slow usage RPCs, threshold raised to 15 — prevents spurious gateway disconnects.
- **Theme card-bg consistency**: 16/16 routes audited against canonical navy; hardcoded `bg-[#0d1117]`/`bg-[#0d0d0d]`/etc. swapped for `bg-[var(--theme-bg)]`.
- **Activity tracker visibility**: `unknown` cell color hardcoded to `rgba(170,178,195,0.18)` so it doesn't disappear against the navy crush.
- **Ghost button nav**: `dark:text-primary-900` (was `dark:text-primary-100`, invisible in the inverted palette).
- **Form a11y**: `id`, `name`, `aria-label` added to 9 previously-unnamed inputs across 5 routes.

### 🔒 Security

- **PostgREST anon-key policy**: `command_center.{todos, agent_logs, autonomy_stats}` ship `FOR ALL USING (true)` RLS — acceptable only for local-only / file:// desktop contexts.
- **Pre-commit hook**: blocks the legacy multi-tenant column names (see `.claude/rules/tenant-hierarchy.md` for the full list) on commit.
- **Rate-limited autonomy tick**: 30 manual ticks/min/IP via `rateLimit()` middleware.
- **405 on non-POST autonomy methods**: explicit `Allow: POST` header for ops debugging.
- **PostgREST publishable key only**: no `service_role` ever shipped to browser; `realtime: { params: { eventsPerSecond: 5 } }` cap.

### 📦 Tooling & Infrastructure

- **Node 22 pinned** repo-wide (`package.json engines`, `.nvmrc`).
- **Dev server pinned to port 3010** via `vite dev --port 3010 --strictPort`. Production Docker still binds 3000 (intentional, distinguished in docs).
- **`typecheck` script added** to `package.json` (`tsc --noEmit`).
- **Supabase JS client** (`@supabase/supabase-js@^2.105.4`) added; HMR-safe singleton via `globalThis` cache.
- **`supabase_realtime` publication**: includes `command_center.{todos, agent_logs, autonomy_stats}`.

### 📚 Docs

- **`ln-614` fact-check audit + remediation** (`docs/audits/ln-614--global.md`): port-3000 references corrected to 3010, version badge synced to 4.0.0, phantom endpoints replaced with real routes, skills count contradiction resolved, `workspace-ux-architecture.md` flagged as ARCHIVED.
- **Cleanup pass**: 40+ internal spec/audit/roadmap files removed from the public tree (`f0530ec`); mockup HTML dropped.

### 🏗️ Architecture

- **`command_center` Supabase schema** exposed to PostgREST via `ALTER ROLE authenticator SET pgrst.db_schemas` + `NOTIFY pgrst` (verified working 2026-05-13).
- **OpenClaw gateway integration** standardized on `gatewayRpc()` with `idempotencyKey` on every dispatch.
- **Agent definitions** at `.claude/agents/agent-os/{alex,maya,jordan,dev,sam}.md` carry a HARD GATE rule requiring writes to `command_center.agent_logs` before final reply.

---

## [3.0.0] — 2026-02-25 (feat/clean-sprint)

### 🚀 New Features

#### Agent Hub

- **Mission dispatch fix (BUG-1)**: Wired agent dispatch to `/api/agent-dispatch` (gateway RPC lane: subagent) — was incorrectly calling `sessions/send` (chat) causing missions to not actually run
- **Exec approval modal (BUG-3)**: Full SSE-driven approval UI — stacked queue, 30s countdown timer, risk badges, auto-deny on timeout, approve/deny with loading states
- **Pause/steer fix**: Pause now sends real steer signal via `chat.send` fallback — was no-op before
- **Live output panel**: Redesigned with compact agent info, colored status badges, better progress bar
- **Overview restored**: Office view fills full height with internal stats row, secondary widgets below

#### Dashboard

- **Cost tracking analytics (BUG-2)**: Full `/costs` page with real SQLite data — hero KPIs (MTD, projected EOM, budget %), per-agent breakdown, daily trend chart (30 days), per-model usage table
- **Dashboard revamp B/C/D (FEAT-6)**: Full dark mode consistency across all surfaces, hardcoded `localhost:3000` WebSocket origin replaced with dynamic derivation, widget edit controls moved out of header

#### New Screens

- **Memory Browser (FEAT-2)**: View, search, and edit `MEMORY.md` + `memory/*.md` in-app — grouped file list, full-text search with line jump, edit mode, unsaved changes indicator, markdown preview toggle
- **Workspace File Browser (FEAT-3)**: Split-panel file tree navigator — expandable folders, file icons by type, markdown preview, syntax highlighting for TS/JS/JSON, image preview, edit + save
- **Cost Analytics page**: `/costs` route with real usage data, per-agent and per-model breakdowns

#### Settings & Infrastructure

- **Provider restart UX (FEAT-4)**: Adding/removing a provider now shows confirm dialog → full-screen gateway restart overlay → health polling → auto-dismiss on recovery. 30s timeout with manual retry.
- **System metrics footer (FEAT-1)**: Persistent CPU/RAM/disk/gateway/uptime bar — **off by default**, toggle in Settings
- **Session status fix (FEAT-7)**: `/api/sessions/:key/status` now does real `sessions.list` gateway lookup with proper 404/401/500 handling — was hardcoded `active` before

### 🐛 Bug Fixes

- **Mission crash fix**: Restored `sessions.send→chat.send` fallback in agent-dispatch preventing no-output on mission launch
- **Chat dedup (BUG-4)**: Fixed duplicate messages on paste/attach
- **Mission pause state (BUG-5)**: Fixed pause state not syncing across components
- **Mobile nav glass effect**: Fixed `isolate` CSS property breaking `backdrop-filter` in Safari/WebKit — frosted glass nav now works correctly
- **Mobile safe area**: Chat input properly clears tab bar with `env(safe-area-inset-bottom)` padding
- **Dashboard WebSocket origin**: Removed hardcoded `localhost:3000` — now derives origin from gateway URL dynamically

### 🔒 Security

- **SEC-1**: Auth guards added to 10 previously unprotected API routes
- **SEC-2**: Wildcard CORS removed from browser-proxy + browser-stream
- **SEC-3**: Full audit pass:
  - Auth guards on terminal, browser, debug-analyze, config-get, paths, context-usage endpoints
  - Rate limiting on high-risk endpoints: exec, gateway-restart, update-check (npm install → RCE risk)
  - `requireJsonContentType()` CSRF guard on all mutating POST routes
  - Input validation on body parameters
  - Skills `GET /api/skills` was unauthenticated — fixed
  - `SECURITY.md` updated with full audit summary

### 📱 Mobile

- **MOB-1**: Nav glass effect (Safari `isolate` fix)
- **MOB-2**: Agent Hub shows agent card grid on mobile (office hidden `< 640px`)
- **MOB-3**: Bottom nav frosted glass — `backdrop-blur-xl` direct application
- **MOB-4**: Chat input safe-area insets, clears tab bar
- **MOB-5**: Dashboard quick actions replaced with 2×2 widget card grid
- **MOB-6**: Agent Hub bottom nav icon swapped to `BotIcon`
- **MOB-7**: Glass effects on mobile overlays

### 🔍 QA Sweep (FEAT-5)

All tool tabs verified and fixed:

- **Browser tab**: Fully wired via gateway RPC ✅
- **Terminal tab**: PTY streaming (SSE) confirmed working ✅
- **Cron tab**: `nextRunAt` type field added, all CRUD verified ✅
- **File Manager**: All operations working, auth guards confirmed ✅
- **Skills tab**: Added missing auth guard on `GET /api/skills` ✅

### 🏗️ Agent Hub Style

- All headers, cards, containers now match dashboard style exactly: `rounded-xl border border-primary-200 bg-primary-50/95 shadow-sm`
- Page background unified: `bg-primary-100/45`
- Office view crop fixed — `overflow-hidden` removed, SVG fills container

---

## [2.1.0] — 2026-02-22

### Features

- Cost analytics page with per-model breakdown
- Services health widget
- System metrics footer
- Theme persistence fix
- Chat crash fix (motion.create + lazy loading)
- Mobile Agent Hub sub-tabs restored
- 38 QA bugs fixed (P0 auth, P1 streaming/mission, P2 polish)
- 25 commits on `feat/clawsuite-upgrade-sprint-feb22`

---

## [2.0.0] — 2026-02-19

### Features

- Live output streaming (Spec 2)
- Enterprise usability polish (Spec 3)
- Mission execution robustness (Spec 4-5)
- Agent Hub Specs 2-5 complete
- PC1 Mission Control parity

---

## [1.0.0] — 2026-02-17

### Initial Release

- PR #28 merged — 92 files, +6,309/-1,078
- Mobile optimization (39 commits)
- Community PRs merged (#23, #24, #26)
- Chat streaming, sidebar, exec approval, kanban, settings
- Dark mode, theme routing, UI polish

---

## [0.1.0] — 2026-02-16

### Initial Preview

- Established the first ClawSuite project baseline before the `1.0.0` release
- Added the initial chat, agent workspace, and app shell foundations
