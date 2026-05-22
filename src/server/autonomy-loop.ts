// ── Tier 1: Autonomy Loop ──────────────────────────────────────────────────
//
// Picks the next pending todo from command_center.todos, dispatches it to
// the appropriate OpenClaw agent via the gateway WS client, writes an
// agent_logs row on completion/failure, and updates the todo status.
//
// Selection rule: oldest non-completed `todo` with `assignee='Claude'`,
// sorted by priority (Urgent → Normal → Someday), then created_at ascending.
//
// Category → Agent mapping:
//   Marketing    → jordan
//   Development  → dev
//   Personal     → alex (research-leaning)
//   Work         → main (default agent)
//
// Idempotency: while a task is in_progress, the next tick() skips it
// (filter excludes in_progress rows). No double-dispatch.
//
// Disabled by default. Enable via env: PULSEOS_AUTONOMY_LOOP_ENABLED=true.
// ───────────────────────────────────────────────────────────────────────────

import { gatewayRpc } from './gateway'
import { SUPABASE_URL, commandCenterHeaders } from '../lib/supabase-constants'

// Retry / recovery thresholds
const MAX_ATTEMPTS = 3 // after this many failures the task is demoted to Off Track
const STALE_TIMEOUT_MS = 10 * 60 * 1000 // in_progress rows older than this get rescued
const DISPATCH_TIMEOUT_MS = 90 * 1000 // gateway 'agent' RPC ceiling per task

export type AutonomyTickResult =
  | {
      ok: true
      picked: null
      reason: 'no-pending-tasks' | 'inflight-already'
    }
  | {
      ok: true
      picked: {
        id: string
        title: string
        category: string
        agent: string
        status: 'dispatched' | 'completed' | 'failed'
      }
    }
  | { ok: false; error: string }

const CATEGORY_AGENT_MAP: Record<string, string> = {
  Marketing: 'jordan',
  Development: 'dev',
  Personal: 'alex',
  Work: 'main',
}

// Track in-flight tasks to avoid double-dispatch within a single process.
const inflight = new Set<string>()

// Lightweight state for /api/autonomy-status.
// Counter fields are seeded from command_center.autonomy_stats at module
// import (see hydrateStatsFromSupabase below) and async-flushed back after
// every tick — so totals survive dev-server restarts.
const state = {
  lastTickAt: 0 as number,
  lastTickResult: null as AutonomyTickResult | null,
  totalTicks: 0,
  totalDispatched: 0,
  totalFailed: 0,
  totalRescued: 0,
  statsHydrated: false,
  enabledAtBoot:
    process.env.PULSEOS_AUTONOMY_LOOP_ENABLED === 'true' ||
    process.env.PULSEOS_AUTONOMY_LOOP_ENABLED === '1',
}

async function hydrateStatsFromSupabase(): Promise<void> {
  if (state.statsHydrated) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/autonomy_stats?select=*&id=eq.singleton&limit=1`,
      { headers: commandCenterHeaders() },
    )
    if (!res.ok) return
    const rows = (await res.json()) as Array<{
      total_ticks: number
      total_dispatched: number
      total_failed: number
      total_rescued: number
    }>
    if (rows.length === 1) {
      state.totalTicks = Number(rows[0]!.total_ticks ?? 0)
      state.totalDispatched = Number(rows[0]!.total_dispatched ?? 0)
      state.totalFailed = Number(rows[0]!.total_failed ?? 0)
      state.totalRescued = Number(rows[0]!.total_rescued ?? 0)
    }
    state.statsHydrated = true
  } catch {
    // best-effort; loop continues from zeros if rehydrate fails
  }
}

async function flushStatsToSupabase(): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/autonomy_stats?id=eq.singleton`, {
      method: 'PATCH',
      headers: commandCenterHeaders(),
      body: JSON.stringify({
        total_ticks: state.totalTicks,
        total_dispatched: state.totalDispatched,
        total_failed: state.totalFailed,
        total_rescued: state.totalRescued,
        updated_at: new Date().toISOString(),
      }),
    })
  } catch {
    // best-effort; in-memory counter still tracks within this process
  }
}

// Subset of Todo columns returned by the atomic claim RPC. Other fields
// (status, assignee, track_status, etc.) aren't needed downstream because
// the RPC guarantees status='in_progress' and assignee='Claude' for any
// row it returns.
type ClaimedTodo = {
  id: string
  title: string
  category: string
  priority: string
  attempts: number
  created_at: string
}

// Atomic claim via the command_center.claim_next_todo(p_assignee) Postgres
// function (migration: command_center_claim_next_todo_rpc, 2026-05-14).
// Uses SELECT ... FOR UPDATE SKIP LOCKED inside a single transaction so
// two concurrent ticks racing the same row cannot both win the lock — one
// gets the row in_progress, the other gets the next eligible row or no
// rows. Replaces the prior listPendingTodos + lockTodo two-step which was
// not race-safe under PostgREST MVCC snapshot reads.
//
// Returns the claimed row (now in_progress) or null if the queue is empty
// / every eligible row is already locked by another transaction.
async function claimNextTodo(): Promise<ClaimedTodo | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_next_todo`, {
    method: 'POST',
    headers: commandCenterHeaders(),
    body: JSON.stringify({ p_assignee: 'Claude' }),
  })
  if (!res.ok) {
    throw new Error(`claim_next_todo RPC failed: HTTP ${res.status}`)
  }
  const rows = (await res.json()) as Array<ClaimedTodo>
  return rows.length === 1 ? rows[0]! : null
}

// Stale-recovery sweep: any row stuck in_progress for longer than
// STALE_TIMEOUT_MS gets demoted back to 'todo' with track_status='At Risk'
// (or 'Off Track' after MAX_ATTEMPTS) and attempts++. Runs at the top of
// every tick. Returns number actually rescued (after error filtering).
//
// Critical: rows whose id is in the local `inflight` Set are skipped — a
// genuinely-running 10m+ dispatch must NOT have its row flipped back to
// 'todo' while completeTodo() is about to write 'done'. Cross-process
// stale rows are still rescued; only same-process in-flight rows are
// protected.
async function rescueStaleInProgress(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString()
  const url =
    `${SUPABASE_URL}/rest/v1/todos` +
    `?select=id,attempts` +
    `&status=eq.in_progress` +
    `&or=(last_attempt_at.lt.${encodeURIComponent(cutoff)},last_attempt_at.is.null)`
  const listRes = await fetch(url, { headers: commandCenterHeaders() })
  if (!listRes.ok) {
    console.warn(
      `[autonomy] rescue list failed: HTTP ${listRes.status} — skipping sweep`,
    )
    return 0
  }
  const stale = (await listRes.json()) as Array<{
    id: string
    attempts: number
  }>
  const candidates = stale.filter((row) => !inflight.has(row.id))
  if (candidates.length === 0) return 0
  const results = await Promise.allSettled(
    candidates.map(async (row) => {
      const nextAttempts = (row.attempts ?? 0) + 1
      const demote = nextAttempts >= MAX_ATTEMPTS
      const patch = await fetch(
        `${SUPABASE_URL}/rest/v1/todos?id=eq.${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: commandCenterHeaders(),
          body: JSON.stringify({
            status: 'todo',
            track_status: demote ? 'Off Track' : 'At Risk',
            attempts: nextAttempts,
          }),
        },
      )
      if (!patch.ok) {
        throw new Error(`PATCH ${row.id} returned HTTP ${patch.status}`)
      }
      return row.id
    }),
  )
  const rescued = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.length - rescued
  if (failed > 0) {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason))
      .join('; ')
    console.warn(
      `[autonomy] rescue: ${rescued} ok, ${failed} failed (${errors})`,
    )
  }
  return rescued
}

async function completeTodo(
  id: string,
  success: boolean,
  attempts: number,
): Promise<void> {
  // On failure: bump attempts, demote to 'Off Track' if hit MAX_ATTEMPTS so
  // the loop stops re-picking a permanently-broken task.
  const newAttempts = attempts + 1
  const demoted = !success && newAttempts >= MAX_ATTEMPTS
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/todos?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: commandCenterHeaders(),
      body: JSON.stringify({
        status: success ? 'done' : 'todo',
        completed: success,
        track_status: success ? 'On Track' : demoted ? 'Off Track' : 'At Risk',
        attempts: newAttempts,
        // BLOCKER FIX 2026-05-15: stale-rescue at line 171 queries
        // `last_attempt_at.lt.${cutoff}` to find stuck `in_progress` rows.
        // Without this column being written, every in_progress row reads
        // last_attempt_at=NULL, matching the rescue OR-branch and flipping
        // legitimately-running tasks back to `todo` mid-demo. Stamp it on
        // every completion (success or fail) so the rescue filter is honest.
        last_attempt_at: new Date().toISOString(),
      }),
    },
  )
  if (!res.ok) {
    throw new Error(`completeTodo ${id} failed: HTTP ${res.status}`)
  }
}

async function writeAgentLog(
  agentName: string,
  taskDescription: string,
  modelUsed: string,
  status: 'completed' | 'failed',
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_logs`, {
    method: 'POST',
    headers: commandCenterHeaders(),
    body: JSON.stringify({
      agent_name: agentName,
      task_description: taskDescription.slice(0, 500),
      model_used: modelUsed,
      status,
    }),
  })
  if (!res.ok) {
    // Agent log write failures are surfaced but don't roll back the task —
    // the dispatch already happened and the task itself was completed above.
    // A persistent failure here means the audit log is missing rows; that's
    // bad but not catastrophic.
    console.warn(
      `[autonomy] writeAgentLog ${agentName}/${status} returned HTTP ${res.status}`,
    )
  }
}

async function dispatchToAgent(
  agentId: string,
  prompt: string,
  taskId: string,
  attempt: number,
): Promise<{ ok: boolean; model: string; reply?: string; error?: string }> {
  // True deterministic idempotency: same (taskId, attempt) → identical key.
  // The OpenClaw gateway dedupes at the protocol level when it sees the same
  // key twice, so a retry of the same attempt (e.g. after a local timeout
  // that didn't actually cancel the RPC) won't double-dispatch the agent.
  const idempotencyKey = `${taskId}:${attempt}`
  try {
    const rpcPromise = gatewayRpc<{
      reply?: string
      model?: string
      durationMs?: number
    }>('agent', {
      agentId,
      message: prompt,
      thinking: 'minimal',
      idempotencyKey,
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`dispatch timeout after ${DISPATCH_TIMEOUT_MS}ms`)),
        DISPATCH_TIMEOUT_MS,
      ),
    )
    const res = await Promise.race([rpcPromise, timeoutPromise])
    return {
      ok: true,
      model: res?.model ?? 'unknown',
      reply: res?.reply,
    }
  } catch (e) {
    return {
      ok: false,
      model: 'unknown',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

function mapAgent(category: string): string {
  return CATEGORY_AGENT_MAP[category] ?? 'main'
}

export async function autonomyTick(): Promise<AutonomyTickResult> {
  await hydrateStatsFromSupabase()
  state.lastTickAt = Date.now()
  state.totalTicks += 1
  // Async flush — don't await; we don't want stats write latency on the
  // happy path. Loss of one update is acceptable; the next tick re-flushes.
  void flushStatsToSupabase()
  try {
    // Step 0 — Stale-recovery sweep: rescue any in_progress rows that
    // ran longer than STALE_TIMEOUT_MS (process killed mid-dispatch,
    // gateway hung, etc.). Each rescue bumps attempts and demotes to
    // Off Track when MAX_ATTEMPTS reached.
    const rescued = await rescueStaleInProgress()
    if (rescued > 0) state.totalRescued += rescued

    // Atomic claim — the Postgres function picks the next eligible row,
    // takes a row-level lock (SELECT ... FOR UPDATE SKIP LOCKED), flips
    // it to in_progress, and returns it. Priority ordering + assignee
    // filter + Off-Track exclusion all happen inside the function. No
    // race window between "see a row" and "claim it" anymore.
    const pick = await claimNextTodo()
    if (!pick) {
      const r: AutonomyTickResult = {
        ok: true,
        picked: null,
        reason: 'no-pending-tasks',
      }
      state.lastTickResult = r
      return r
    }
    // Defensive in-process guard: the RPC already owns the row, but if
    // an HMR reload or stale state left the id in the local Set, refuse
    // to double-dispatch from this process. Cross-process dedup is the
    // RPC's job, not ours.
    if (inflight.has(pick.id)) {
      const r: AutonomyTickResult = {
        ok: true,
        picked: null,
        reason: 'inflight-already',
      }
      state.lastTickResult = r
      return r
    }
    inflight.add(pick.id)

    try {
      const agent = mapAgent(pick.category)
      const attemptNumber = (pick.attempts ?? 0) + 1
      const prompt = `[Autonomy task #${pick.id.slice(0, 8)} attempt ${attemptNumber}] ${pick.title}\n\nCategory: ${pick.category}\nPriority: ${pick.priority}\n\nComplete this task and reply with a one-paragraph summary of what you did.`

      const dispatch = await dispatchToAgent(
        agent,
        prompt,
        pick.id,
        attemptNumber,
      )
      const success = dispatch.ok
      await completeTodo(pick.id, success, pick.attempts ?? 0)
      await writeAgentLog(
        agent,
        `Autonomy: ${pick.title}` +
          (dispatch.error ? ` — error: ${dispatch.error.slice(0, 100)}` : ''),
        dispatch.model,
        success ? 'completed' : 'failed',
      )

      if (success) state.totalDispatched += 1
      else state.totalFailed += 1

      const r: AutonomyTickResult = {
        ok: true,
        picked: {
          id: pick.id,
          title: pick.title,
          category: pick.category,
          agent,
          status: success ? 'completed' : 'failed',
        },
      }
      state.lastTickResult = r
      return r
    } finally {
      // Always release the inflight slot — even if completeTodo or
      // writeAgentLog threw — so the task ID can be re-dispatched.
      inflight.delete(pick.id)
    }
  } catch (e) {
    const r: AutonomyTickResult = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
    state.lastTickResult = r
    return r
  }
}

export function getAutonomyState() {
  return {
    enabled: state.enabledAtBoot,
    lastTickAt: state.lastTickAt,
    lastTickResult: state.lastTickResult,
    totalTicks: state.totalTicks,
    totalDispatched: state.totalDispatched,
    totalFailed: state.totalFailed,
    totalRescued: state.totalRescued,
    inflightCount: inflight.size,
  }
}

// ── Auto-start (opt-in) ────────────────────────────────────────────────────
// Disabled by default — set PULSEOS_AUTONOMY_LOOP_ENABLED=true (or =1) to
// auto-start the polling interval on first module import. Defaults to 60s.
// Per-process guard via globalThis so HMR reloads don't double-schedule.
const LOOP_KEY = '__pulseos_autonomy_interval__' as const
declare global {
  // eslint-disable-next-line no-var
  var __pulseos_autonomy_interval__: NodeJS.Timeout | undefined
}
if (state.enabledAtBoot && typeof globalThis !== 'undefined') {
  if ((globalThis as any)[LOOP_KEY]) {
    clearInterval((globalThis as any)[LOOP_KEY])
  }
  const intervalMs = Number(process.env.PULSEOS_AUTONOMY_INTERVAL_MS ?? 60_000)
  ;(globalThis as any)[LOOP_KEY] = setInterval(
    () => {
      void autonomyTick().catch((e: unknown) => {
        // Surface the failure so the dashboard's lastTickResult reflects
        // reality and totalFailed ticks up. A silent catch here hides a
        // dead loop (gateway down, Supabase unreachable, etc.) behind a
        // healthy-looking UI.
        const error = e instanceof Error ? e.message : String(e)
        state.lastTickResult = { ok: false, error }
        state.totalFailed += 1
        console.error('[autonomy] tick threw:', error)
      })
    },
    Math.max(15_000, intervalMs),
  )
  console.warn(
    `[autonomy] Loop enabled — tick every ${Math.max(15, intervalMs / 1000)}s`,
  )
}
