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

import { randomUUID } from 'node:crypto'
import { gatewayRpc } from './gateway'

const SUPABASE_URL = 'https://zcjgjfersccwwhjmaflw.supabase.co'
const SUPABASE_KEY = 'sb_publishable_krMU4pMkUZQNQT9bbO68jw_IahpZoEd'

type Todo = {
  id: string
  title: string
  category: string
  priority: string
  status: string
  assignee: string
  track_status: string | null
  created_at: string
}

export type AutonomyTickResult =
  | { ok: true; picked: null; reason: 'no-pending-tasks' }
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

const PRIORITY_RANK: Record<string, number> = {
  Urgent: 0,
  Normal: 1,
  Someday: 2,
}

// Track in-flight tasks to avoid double-dispatch within a single process.
const inflight = new Set<string>()

// Lightweight state for /api/autonomy-status.
const state = {
  lastTickAt: 0 as number,
  lastTickResult: null as AutonomyTickResult | null,
  totalTicks: 0,
  totalDispatched: 0,
  totalFailed: 0,
  enabledAtBoot:
    process.env.PULSEOS_AUTONOMY_LOOP_ENABLED === 'true' ||
    process.env.PULSEOS_AUTONOMY_LOOP_ENABLED === '1',
}

function supabaseHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Accept-Profile': 'command_center',
    'Content-Profile': 'command_center',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

async function listPendingTodos(): Promise<Array<Todo>> {
  const url =
    `${SUPABASE_URL}/rest/v1/todos` +
    `?select=*` +
    `&status=eq.todo` +
    `&assignee=eq.Claude` +
    `&track_status=neq.Off Track` +
    `&order=created_at.asc` +
    `&limit=20`
  const res = await fetch(url, { headers: supabaseHeaders() })
  if (!res.ok) throw new Error(`Supabase list todos failed: HTTP ${res.status}`)
  return (await res.json()) as Array<Todo>
}

async function lockTodo(id: string): Promise<boolean> {
  // Soft-lock via status change. Concurrent ticks racing the same row will
  // see one of the two writes win; the loser sees the row no longer 'todo'
  // on the next listPendingTodos call.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/todos?id=eq.${encodeURIComponent(id)}&status=eq.todo`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({ status: 'in_progress' }),
    },
  )
  if (!res.ok) return false
  const rows = (await res.json()) as Array<Todo>
  return rows.length === 1
}

async function completeTodo(id: string, success: boolean): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/todos?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      status: success ? 'done' : 'todo',
      completed: success,
      track_status: success ? 'On Track' : 'At Risk',
    }),
  })
}

async function writeAgentLog(
  agentName: string,
  taskDescription: string,
  modelUsed: string,
  status: 'completed' | 'failed',
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/agent_logs`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      agent_name: agentName,
      task_description: taskDescription.slice(0, 500),
      model_used: modelUsed,
      status,
    }),
  })
}

async function dispatchToAgent(
  agentId: string,
  prompt: string,
): Promise<{ ok: boolean; model: string; reply?: string; error?: string }> {
  try {
    const res = await gatewayRpc<{
      reply?: string
      model?: string
      durationMs?: number
    }>('agent', {
      agentId,
      message: prompt,
      thinking: 'minimal',
      idempotencyKey: randomUUID(),
    })
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

function pickTopByPriority(todos: Array<Todo>): Todo | null {
  if (todos.length === 0) return null
  return [...todos].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 99
    const pb = PRIORITY_RANK[b.priority] ?? 99
    if (pa !== pb) return pa - pb
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })[0]!
}

export async function autonomyTick(): Promise<AutonomyTickResult> {
  state.lastTickAt = Date.now()
  state.totalTicks += 1
  try {
    const candidates = await listPendingTodos()
    const pick = pickTopByPriority(candidates)
    if (!pick) {
      const r: AutonomyTickResult = {
        ok: true,
        picked: null,
        reason: 'no-pending-tasks',
      }
      state.lastTickResult = r
      return r
    }
    if (inflight.has(pick.id)) {
      const r: AutonomyTickResult = {
        ok: true,
        picked: null,
        reason: 'no-pending-tasks',
      }
      state.lastTickResult = r
      return r
    }
    inflight.add(pick.id)

    const locked = await lockTodo(pick.id)
    if (!locked) {
      inflight.delete(pick.id)
      const r: AutonomyTickResult = {
        ok: true,
        picked: null,
        reason: 'no-pending-tasks',
      }
      state.lastTickResult = r
      return r
    }

    const agent = mapAgent(pick.category)
    const prompt = `[Autonomy task #${pick.id.slice(0, 8)}] ${pick.title}\n\nCategory: ${pick.category}\nPriority: ${pick.priority}\n\nComplete this task and reply with a one-paragraph summary of what you did.`

    const dispatch = await dispatchToAgent(agent, prompt)
    const success = dispatch.ok
    await completeTodo(pick.id, success)
    await writeAgentLog(
      agent,
      `Autonomy: ${pick.title}` +
        (dispatch.error ? ` — error: ${dispatch.error.slice(0, 100)}` : ''),
      dispatch.model,
      success ? 'completed' : 'failed',
    )
    inflight.delete(pick.id)

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
      void autonomyTick().catch(() => {})
    },
    Math.max(15_000, intervalMs),
  )
  console.warn(
    `[autonomy] Loop enabled — tick every ${Math.max(15, intervalMs / 1000)}s`,
  )
}
