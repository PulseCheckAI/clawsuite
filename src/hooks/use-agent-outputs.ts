// ── useAgentOutputs ─────────────────────────────────────────────────────────
//
// Reads from Supabase `command_center.agent_logs` and maps each row to the
// AgentOutput shape consumed by FullOutputsView. The Outputs tab in
// OperationsScreen renders this list.
//
// Rows in agent_logs are written by src/server/autonomy-loop.ts on every
// dispatch (completed/failed) — see writeAgentLog() there. Fields that don't
// have a 1:1 source (agentEmoji, fullOutput, durationMs, sessionKey, etc.)
// stay undefined, which the view handles gracefully.
//
// Filter values map to PostgREST `status` filter (`?status=eq.<value>`):
//   all     → no filter
//   success → status=eq.completed
//   error   → status=eq.failed
//
// Failure: hook surfaces `error` but never throws — empty list is honest.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from '@/lib/supabase-constants'

export type AgentOutputStatus = 'ok' | 'error' | 'running' | 'pending'
export type AgentOutputFailureKind =
  | 'delivery'
  | 'config'
  | 'approval'
  | 'runtime'
  | 'unknown'

export type AgentOutput = {
  id: string
  agentId: string
  agentName: string
  agentEmoji?: string
  status: AgentOutputStatus
  statusLabel?: string
  failureKind?: AgentOutputFailureKind
  timestamp: string
  durationMs?: number
  model?: string
  jobId?: string
  jobName?: string
  summary?: string
  fullOutput?: string
  sessionKey?: string
  chatSessionKey?: string
  error?: string
}

export type AgentOutputFilter = 'all' | 'success' | 'error'

type UseAgentOutputs = {
  outputs: Array<AgentOutput>
  availableFilters: Array<AgentOutputFilter>
  loading: boolean
  error: string | null
  refresh: () => void
}

type AgentLogRow = {
  id: string
  agent_name: string
  task_description: string | null
  model_used: string | null
  status: 'completed' | 'failed' | string
  created_at: string
}

const AVAILABLE_FILTERS: Array<AgentOutputFilter> = ['all', 'success', 'error']
const LIMIT = 50

function mapRowToOutput(row: AgentLogRow): AgentOutput {
  const ok = row.status === 'completed'
  const taskTitle = (row.task_description ?? '').replace(/^Autonomy:\s*/, '')
  const errMatch = (row.task_description ?? '').match(/—\s*error:\s*(.+)$/)
  return {
    id: row.id,
    agentId: row.agent_name,
    agentName: row.agent_name,
    status: ok ? 'ok' : 'error',
    statusLabel: ok ? 'Completed' : 'Failed',
    failureKind: ok ? undefined : 'runtime',
    timestamp: row.created_at,
    model: row.model_used ?? undefined,
    jobName: 'Autonomy dispatch',
    summary: taskTitle || undefined,
    error: ok
      ? undefined
      : (errMatch?.[1] ?? row.task_description ?? undefined),
  }
}

export function useAgentOutputs(filter: AgentOutputFilter): UseAgentOutputs {
  const [outputs, setOutputs] = useState<Array<AgentOutput>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const statusParam =
      filter === 'success'
        ? '&status=eq.completed'
        : filter === 'error'
          ? '&status=eq.failed'
          : ''
    const url =
      `${SUPABASE_URL}/rest/v1/agent_logs` +
      `?select=id,agent_name,task_description,model_used,status,created_at` +
      `&order=created_at.desc` +
      `&limit=${LIMIT}` +
      statusParam
    fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Accept-Profile': 'command_center',
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const rows = (await res.json()) as Array<AgentLogRow>
        if (cancelled) return
        setOutputs(rows.map(mapRowToOutput))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setOutputs([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filter, reloadKey])

  return {
    outputs,
    availableFilters: AVAILABLE_FILTERS,
    loading,
    error,
    refresh,
  }
}
