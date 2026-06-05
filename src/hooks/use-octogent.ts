/**
 * React Query hooks for the proxied Octogent API.
 *
 * All endpoints go through `/octogent/*` on the PulseOS dashboard, which is
 * gated by the standard session cookie and forwards to the loopback Octogent
 * service (pm2 `pulseos-octogent` on :8787).
 *
 * Vocabulary mapping (PulseOS-facing -> upstream Octogent):
 *   Scope   = tentacle  (.octogent/tentacles/<id>/)
 *   Agent   = terminal  (PTY-backed Claude/runner session)
 *   Task    = todo item (- [ ] line in todo.md)
 *   Channel = channel   (in-memory message queue keyed by Agent ID)
 */
import { useQuery } from '@tanstack/react-query'

const OCTOGENT_BASE = '/octogent'

async function ogFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${OCTOGENT_BASE}${path}`, {
    credentials: 'same-origin',
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Octogent ${path} -> ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
    )
  }
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

// ── Setup state ──────────────────────────────────────────────────────────────
export type OctogentSetupStep = {
  id: string
  title: string
  description: string
  complete: boolean
  required: boolean
  actionLabel?: string
  statusText?: string
  guidance?: string
  command?: string
}

export type OctogentSetup = {
  isFirstRun: boolean
  shouldShowSetupCard: boolean
  hasAnyTentacles: boolean
  tentacleCount: number
  steps: Array<OctogentSetupStep>
}

export function useOctogentSetup() {
  return useQuery({
    queryKey: ['octogent', 'setup'],
    queryFn: () => ogFetch<OctogentSetup>('/api/setup'),
    staleTime: 30_000,
  })
}

// ── Scopes (tentacles) ──────────────────────────────────────────────────────
export type ScopeTodoItem = {
  index: number
  text: string
  done: boolean
}

export type ScopeVaultFile = {
  name: string
  path: string
  size?: number
}

export type Scope = {
  id: string
  name: string
  description?: string
  path: string
  color?: string | null
  status?: string | null
  tags?: Array<string>
  vaultFiles: Array<ScopeVaultFile>
  todos: Array<ScopeTodoItem>
  todoCount: number
  completedTodoCount: number
}

type TentacleRaw = {
  id: string
  name?: string
  displayName?: string
  description?: string
  path?: string
  color?: string | null
  status?: string | null
  tags?: Array<string>
  vaultFiles?: Array<ScopeVaultFile>
  todos?: Array<ScopeTodoItem>
  todoCount?: number
  completedTodoCount?: number
}

type DeckTentaclesResponse =
  | Array<TentacleRaw>
  | { tentacles?: Array<TentacleRaw> }

function normalizeScope(t: TentacleRaw): Scope {
  return {
    id: t.id,
    name: t.name || t.displayName || t.id,
    description: t.description,
    path: t.path ?? '',
    color: t.color ?? null,
    status: t.status ?? null,
    tags: t.tags ?? [],
    vaultFiles: t.vaultFiles ?? [],
    todos: t.todos ?? [],
    todoCount: t.todoCount ?? t.todos?.length ?? 0,
    completedTodoCount:
      t.completedTodoCount ?? t.todos?.filter((x) => x.done).length ?? 0,
  }
}

export function useScopes() {
  return useQuery({
    queryKey: ['octogent', 'scopes'],
    queryFn: async () => {
      const payload = await ogFetch<DeckTentaclesResponse>(
        '/api/deck/tentacles',
      )
      const list: Array<TentacleRaw> = Array.isArray(payload)
        ? payload
        : (payload.tentacles ?? [])
      return list.map(normalizeScope)
    },
    // Push updates come via the terminal-events WebSocket
    // (use-octogent-events). Keep a long safety-net poll in case the socket
    // drops or misses an event.
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// ── Agents (terminals) ──────────────────────────────────────────────────────
export type AgentLifecycle =
  | 'registered'
  | 'running'
  | 'stopped'
  | 'exited'
  | 'stale'

export type Agent = {
  id: string
  displayName?: string
  tentacleName?: string
  tentacleId?: string | null
  worktreeId?: string | null
  parentTerminalId?: string | null
  workspaceMode?: 'shared' | 'worktree' | null
  lifecycleState?: AgentLifecycle
  lifecycleReason?: string | null
  pid?: number | null
  createdAt?: string
  lastActivityAt?: string
}

// Octogent's /api/terminal-snapshots uses `terminalId`/`label`/`tentacleName`/
// `processId`/`lifecycleUpdatedAt` (verified against the live API). Older/
// alternate spellings (`id`/`displayName`/`pid`/`lastActivityAt`) are kept as
// optional fallbacks so this stays forward-compatible if the API converges.
type TerminalRaw = {
  terminalId?: string
  id?: string
  label?: string
  tentacleName?: string
  displayName?: string
  tentacleId?: string | null
  worktreeId?: string | null
  parentTerminalId?: string | null
  workspaceMode?: 'shared' | 'worktree' | null
  lifecycleState?: AgentLifecycle
  lifecycleReason?: string | null
  processId?: number | null
  pid?: number | null
  createdAt?: string
  lifecycleUpdatedAt?: string
  lastActivityAt?: string
}

type TerminalSnapshotsResponse =
  | Array<TerminalRaw>
  | { terminals?: Array<TerminalRaw> }

function normalizeAgent(t: TerminalRaw): Agent {
  const id = t.terminalId ?? t.id ?? ''
  return {
    id,
    // `label` ("terminal-2") is unique per terminal so pucks stay
    // distinguishable; `tentacleName` ("tentacle-planner") is the role fallback.
    displayName: t.label ?? t.tentacleName ?? t.displayName ?? id,
    tentacleName: t.tentacleName,
    tentacleId: t.tentacleId ?? null,
    worktreeId: t.worktreeId ?? null,
    parentTerminalId: t.parentTerminalId ?? null,
    workspaceMode: t.workspaceMode ?? null,
    lifecycleState: t.lifecycleState,
    lifecycleReason: t.lifecycleReason ?? null,
    pid: t.processId ?? t.pid ?? null,
    createdAt: t.createdAt,
    lastActivityAt: t.lifecycleUpdatedAt ?? t.lastActivityAt,
  }
}

export function useAgents() {
  return useQuery({
    queryKey: ['octogent', 'agents'],
    queryFn: async () => {
      const payload = await ogFetch<TerminalSnapshotsResponse>(
        '/api/terminal-snapshots',
      )
      const list: Array<TerminalRaw> = Array.isArray(payload)
        ? payload
        : (payload.terminals ?? [])
      return list.map(normalizeAgent)
    },
    // Push updates come via the terminal-events WebSocket
    // (use-octogent-events). Keep a long safety-net poll in case the socket
    // drops or misses an event.
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// ── Skills (Claude Code skills available) ──────────────────────────────────
export type OctogentSkill = {
  id: string
  name: string
  description?: string
  path?: string
}

type SkillsResponse = { skills?: Array<OctogentSkill> } | Array<OctogentSkill>

export function useOctogentSkills() {
  return useQuery({
    queryKey: ['octogent', 'skills'],
    queryFn: async () => {
      const payload = await ogFetch<SkillsResponse>('/api/deck/skills')
      return Array.isArray(payload) ? payload : (payload.skills ?? [])
    },
    staleTime: 60_000,
  })
}

// ── Aggregate snapshot for the Stage header ─────────────────────────────────
export function useOctogentSnapshot() {
  const scopes = useScopes()
  const agents = useAgents()
  const setup = useOctogentSetup()
  return {
    scopes,
    agents,
    setup,
    counts: {
      scopes: scopes.data?.length ?? 0,
      agents: agents.data?.length ?? 0,
      activeAgents:
        agents.data?.filter((a) => a.lifecycleState === 'running').length ?? 0,
      staleAgents:
        agents.data?.filter((a) => a.lifecycleState === 'stale').length ?? 0,
      openTasks:
        scopes.data?.reduce(
          (acc, s) => acc + (s.todoCount - s.completedTodoCount),
          0,
        ) ?? 0,
    },
    isLoading: scopes.isLoading || agents.isLoading || setup.isLoading,
    isError: scopes.isError || agents.isError || setup.isError,
  }
}
