// ── useVoiceCallsLive ───────────────────────────────────────────────────────
// Live view of `public.voice_calls` for one org.
//   1. Cold-start REST fetch via /api/voice-engine/calls (server-side proxy
//      adds the HMAC + org headers voice-engine requires).
//   2. Supabase realtime channel on `public.voice_calls` filtered by
//      `organization_id=eq.<orgId>`. INSERT prepends, UPDATE merges by id,
//      DELETE filters by id.
//
// State: useReducer to keep the merge logic in one place + make the hook
// trivially testable. Mirrors the postgres_changes pattern already used by
// mission-control-screen.tsx so a reviewer recognizes it.
//
// Lifecycle: cleans up the channel on unmount AND on orgId change so a
// route param swap doesn't leak a stale subscription. The REST fetch is
// guarded with `cancelled` to drop late responses after orgId changes.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useReducer } from 'react'
import type { VoiceApiError, VoiceCallRow } from '@/lib/voice-api'
import { getSupabaseClient } from '@/lib/supabase-client'
import { voiceApi } from '@/lib/voice-api'

interface State {
  calls: Array<VoiceCallRow>
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'load:start' }
  | { type: 'load:done'; calls: Array<VoiceCallRow> }
  | { type: 'load:fail'; error: string }
  | { type: 'rt:insert'; row: VoiceCallRow }
  | { type: 'rt:update'; row: VoiceCallRow }
  | { type: 'rt:delete'; id: string }

const initial: State = { calls: [], loading: true, error: null }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load:start':
      return { ...state, loading: true, error: null }
    case 'load:done':
      return { calls: action.calls, loading: false, error: null }
    case 'load:fail':
      return { ...state, loading: false, error: action.error }
    case 'rt:insert': {
      if (state.calls.some((c) => c.id === action.row.id)) return state
      return { ...state, calls: [action.row, ...state.calls] }
    }
    case 'rt:update': {
      const next = state.calls.map((c) =>
        c.id === action.row.id ? { ...c, ...action.row } : c,
      )
      return { ...state, calls: next }
    }
    case 'rt:delete':
      return {
        ...state,
        calls: state.calls.filter((c) => c.id !== action.id),
      }
    default:
      return state
  }
}

export interface UseVoiceCallsLiveOptions {
  /** Cap on the cold-start fetch. Realtime appends INSERTs beyond this cap. */
  limit?: number
  /** Filter to `pending|placed|connected|completed|failed|gated_refused`. */
  status?: VoiceCallRow['status']
  direction?: VoiceCallRow['direction']
}

export interface UseVoiceCallsLiveResult {
  calls: Array<VoiceCallRow>
  loading: boolean
  error: string | null
}

/**
 * Live, paginated, org-scoped view of voice_calls.
 *
 * @param orgId  When undefined/empty the hook is INERT (returns empty + not
 *               loading + no error). This is the "not signed in yet" state —
 *               we don't want to start subscriptions before we know who.
 * @param opts   Cold-start filters + size cap.
 */
export function useVoiceCallsLive(
  orgId: string | undefined,
  opts: UseVoiceCallsLiveOptions = {},
): UseVoiceCallsLiveResult {
  const [state, dispatch] = useReducer(reducer, initial)
  const { limit = 50, status, direction } = opts

  useEffect(() => {
    // Inert path — keep state empty + not loading, no work.
    if (!orgId) {
      dispatch({ type: 'load:done', calls: [] })
      return
    }

    let cancelled = false
    dispatch({ type: 'load:start' })

    // ── Cold-start ─────────────────────────────────────────────────────────
    voiceApi
      .listCalls({ org: orgId, limit, status, direction })
      .then((res) => {
        if (cancelled) return
        dispatch({ type: 'load:done', calls: res.calls })
      })
      .catch((e: VoiceApiError | Error) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        dispatch({ type: 'load:fail', error: msg })
      })

    // ── Realtime ──────────────────────────────────────────────────────────
    const supabase = getSupabaseClient()
    // Channel name carries org so HMR + multi-instance pages don't collide.
    const channel = supabase
      .channel(`voice-calls-live:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'voice_calls',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'INSERT') {
            dispatch({ type: 'rt:insert', row: payload.new as VoiceCallRow })
          } else if (payload.eventType === 'UPDATE') {
            dispatch({ type: 'rt:update', row: payload.new as VoiceCallRow })
          } else {
            // DELETE — the only remaining eventType for `event: '*'`.
            const id = (payload.old as { id?: string } | null)?.id
            if (id) dispatch({ type: 'rt:delete', id })
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [orgId, limit, status, direction])

  return state
}

// ── single-call variant (used by /voice/calls/$id) ─────────────────────────

export interface UseVoiceCallLiveResult {
  call: VoiceCallRow | null
  loading: boolean
  error: string | null
}

interface OneState {
  call: VoiceCallRow | null
  loading: boolean
  error: string | null
}

type OneAction =
  | { type: 'start' }
  | { type: 'done'; call: VoiceCallRow | null }
  | { type: 'fail'; error: string }
  | { type: 'merge'; row: VoiceCallRow }
  | { type: 'delete' }

function oneReducer(s: OneState, a: OneAction): OneState {
  switch (a.type) {
    case 'start':
      return { ...s, loading: true, error: null }
    case 'done':
      return { call: a.call, loading: false, error: null }
    case 'fail':
      return { ...s, loading: false, error: a.error }
    case 'merge':
      return s.call && s.call.id === a.row.id
        ? { ...s, call: { ...s.call, ...a.row } }
        : { ...s, call: a.row }
    case 'delete':
      return { call: null, loading: false, error: null }
    default:
      return s
  }
}

/**
 * Same shape as useVoiceCallsLive, but scoped to a single call_id. Used by
 * the deep-view page to keep the transcript / status in sync while the call
 * is still `status='connected'`.
 */
export function useVoiceCallLive(
  callId: string | undefined,
): UseVoiceCallLiveResult {
  const [state, dispatch] = useReducer(oneReducer, {
    call: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!callId) {
      dispatch({ type: 'done', call: null })
      return
    }
    let cancelled = false
    dispatch({ type: 'start' })
    voiceApi
      .getCall(callId)
      .then((row) => {
        if (!cancelled) dispatch({ type: 'done', call: row })
      })
      .catch((e: VoiceApiError | Error) => {
        if (!cancelled) {
          dispatch({
            type: 'fail',
            error: e instanceof Error ? e.message : String(e),
          })
        }
      })

    const supabase = getSupabaseClient()
    const channel = supabase
      .channel(`voice-call-live:${callId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'voice_calls',
          filter: `id=eq.${callId}`,
        },
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            dispatch({ type: 'delete' })
          } else {
            dispatch({ type: 'merge', row: payload.new as VoiceCallRow })
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [callId])

  return state
}
