/**
 * Unified agent aggregator: pulls live agents from every source running on
 * this host (Octogent terminals, OpenClaw gateway sessions, cron jobs) plus
 * a curated library of subagent helper personas that "orbit" the stage as
 * available-to-invoke shortcuts.
 *
 * Data sources:
 *   Octogent terminals  -> /octogent/api/terminal-snapshots (via use-octogent)
 *   Gateway sessions    -> /api/gateway/sessions   (existing PulseOS SSR)
 *   Cron jobs           -> /api/cron/list          (existing PulseOS SSR)
 *   Helper personas     -> hardcoded curated set (Claude SDK subagents)
 */
import { useQuery } from '@tanstack/react-query'
import { useAgents as useOctogentAgents } from './use-octogent'

// ── Gateway sessions (existing /api/gateway/sessions) ───────────────────────
export type GatewaySession = {
  id: string
  // The OpenClaw gateway keys sessions on `key` (with `friendlyId`/`label` for
  // display); `id` is the normalized stable handle we derive from those. Raw
  // fields kept optional so the normalizer can read whatever the payload sends.
  key?: string
  friendlyId?: string
  label?: string
  name?: string
  cwd?: string
  status?: string
  modelProvider?: string
  model?: string
  startedAt?: number
  lastActivityAt?: number
  totalTokens?: number
  costUSD?: number
}

type GatewaySessionsResponse = {
  ok?: boolean
  data?: {
    count?: number
    totalCount?: number
    sessions?: Array<GatewaySession>
  }
}

export function useGatewaySessions() {
  return useQuery({
    queryKey: ['agents', 'gateway-sessions'],
    queryFn: async () => {
      const res = await fetch('/api/gateway/sessions', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`gateway/sessions ${res.status}`)
      const payload = (await res.json()) as GatewaySessionsResponse
      // Normalize: the gateway payload keys on `key`/`friendlyId`, not `id`.
      // Without this every session collapses to a blank id → '?' pucks.
      return (payload.data?.sessions ?? []).map((s) => {
        const id = s.id ?? s.key ?? s.friendlyId ?? ''
        return {
          ...s,
          id,
          name: s.label ?? s.friendlyId ?? s.key ?? id,
        }
      })
    },
    staleTime: 5_000,
    refetchInterval: 8_000,
  })
}

// ── Cron jobs (existing /api/cron/list) ─────────────────────────────────────
export type CronJob = {
  id: string
  name?: string
  cron?: string
  enabled?: boolean
  lastRunAt?: number | null
  nextRunAt?: number | null
  lastStatus?: 'success' | 'failed' | 'running' | string
}

type CronListResponse = { jobs?: Array<CronJob> }

export function useCronJobs() {
  return useQuery({
    queryKey: ['agents', 'cron-jobs'],
    queryFn: async () => {
      const res = await fetch('/api/cron/list', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`cron/list ${res.status}`)
      const payload = (await res.json()) as CronListResponse
      return payload.jobs ?? []
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

// ── Helper personas (curated Claude SDK subagents in user's reach) ─────────
// These are not running processes — they're invocable agent personas that the
// Conductor can call. Rendered as drifting orbs on the stage; clicking one
// will (Phase 4B) dispatch via the Agent tool with the right subagent_type.
export type HelperPersonaTone =
  | 'review'
  | 'architect'
  | 'build'
  | 'security'
  | 'perf'
  | 'data'
  | 'tdd'
  | 'docs'
  | 'refactor'
  | 'e2e'
  | 'explore'
  | 'plan'

export type HelperPersona = {
  id: string
  name: string
  /** Short role description (max ~80 chars) */
  role: string
  /** subagent_type to pass to the Agent tool when invoked */
  subagentType?: string
  /** Visual tone bucket (drives color/glow) */
  tone: HelperPersonaTone
  /** Single-glyph badge (1-3 chars). Picked for cinematic feel. */
  glyph: string
}

export const HELPER_PERSONAS: ReadonlyArray<HelperPersona> = [
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    role: 'Reviews recent diffs for correctness, style, security risks.',
    subagentType: 'everything-claude-code:code-reviewer',
    tone: 'review',
    glyph: 'CR',
  },
  {
    id: 'architect',
    name: 'Architect',
    role: 'System design, scaling, technical decisions for new features.',
    subagentType: 'everything-claude-code:architect',
    tone: 'architect',
    glyph: 'AR',
  },
  {
    id: 'planner',
    name: 'Planner',
    role: 'Decomposes complex tasks into ordered, testable steps.',
    subagentType: 'everything-claude-code:planner',
    tone: 'plan',
    glyph: 'PL',
  },
  {
    id: 'build-resolver',
    name: 'Build Resolver',
    role: 'Fixes failing TypeScript / Vite / pnpm builds with minimal diffs.',
    subagentType: 'everything-claude-code:build-error-resolver',
    tone: 'build',
    glyph: 'BR',
  },
  {
    id: 'security-reviewer',
    name: 'Security Reviewer',
    role: 'OWASP-Top-10, secret scanning, auth gates, RLS posture.',
    subagentType: 'everything-claude-code:security-reviewer',
    tone: 'security',
    glyph: 'SR',
  },
  {
    id: 'perf-optimizer',
    name: 'Perf Optimizer',
    role: 'Bundle, runtime, render, query — measure before optimizing.',
    subagentType: 'everything-claude-code:performance-optimizer',
    tone: 'perf',
    glyph: 'PO',
  },
  {
    id: 'db-reviewer',
    name: 'DB Reviewer',
    role: 'Postgres / Supabase migrations, RLS, schema, query plans.',
    subagentType: 'everything-claude-code:database-reviewer',
    tone: 'data',
    glyph: 'DB',
  },
  {
    id: 'tdd-guide',
    name: 'TDD Guide',
    role: 'Red-green-refactor; writes the failing test first.',
    subagentType: 'everything-claude-code:tdd-guide',
    tone: 'tdd',
    glyph: 'TD',
  },
  {
    id: 'doc-updater',
    name: 'Doc Updater',
    role: 'Keeps READMEs, codemaps, runbooks in lockstep with code.',
    subagentType: 'everything-claude-code:doc-updater',
    tone: 'docs',
    glyph: 'DU',
  },
  {
    id: 'refactor-cleaner',
    name: 'Refactor Cleaner',
    role: 'Dead-code purge, dep audit, knip + ts-prune sweeps.',
    subagentType: 'everything-claude-code:refactor-cleaner',
    tone: 'refactor',
    glyph: 'RC',
  },
  {
    id: 'e2e-runner',
    name: 'E2E Runner',
    role: 'Playwright / Vercel Agent journeys, flake quarantine.',
    subagentType: 'everything-claude-code:e2e-runner',
    tone: 'e2e',
    glyph: 'E2',
  },
  {
    id: 'code-explorer',
    name: 'Code Explorer',
    role: 'Maps execution paths + dependencies for unfamiliar features.',
    subagentType: 'everything-claude-code:code-explorer',
    tone: 'explore',
    glyph: 'EX',
  },
]

export function useHelperPersonas(): ReadonlyArray<HelperPersona> {
  return HELPER_PERSONAS
}

// ── Unified counts for the stage header ─────────────────────────────────────
export function useUnifiedAgentCounts() {
  const octogent = useOctogentAgents()
  const gateway = useGatewaySessions()
  const cron = useCronJobs()
  return {
    isLoading: octogent.isLoading || gateway.isLoading || cron.isLoading,
    counts: {
      octogentTotal: octogent.data?.length ?? 0,
      octogentLive:
        octogent.data?.filter((a) => a.lifecycleState === 'running').length ??
        0,
      gatewaySessions: gateway.data?.length ?? 0,
      cronJobs: cron.data?.length ?? 0,
      cronEnabled: cron.data?.filter((j) => j.enabled).length ?? 0,
      helpers: HELPER_PERSONAS.length,
      total:
        (octogent.data?.length ?? 0) +
        (gateway.data?.length ?? 0) +
        (cron.data?.length ?? 0),
    },
    sources: {
      octogent: octogent.data ?? [],
      gateway: gateway.data ?? [],
      cron: cron.data ?? [],
      helpers: HELPER_PERSONAS,
    },
  }
}
