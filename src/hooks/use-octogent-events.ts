/**
 * useOctogentEvents — subscribe to the proxied Octogent terminal-events
 * WebSocket and invalidate the right React Query caches when the upstream
 * fires lifecycle events. Replaces the previous 5–10 s polling on Live
 * Agents / Scopes with sub-second push updates.
 *
 * Event taxonomy (verified against octogent/apps/api/src/terminalRuntime.ts):
 *   - terminal-created       { type, snapshot }
 *   - terminal-updated       { type, snapshot }
 *   - terminal-deleted       { type, terminalId }
 *   - terminal-state-changed { type, terminalId, agentRuntimeState, toolName? }
 *   - terminal-list-changed  { type }  // generic refresh signal
 *
 * Connection: opens `/octogent/api/terminal-events/ws` relative — same-origin
 * cookie auth, PulseOS proxy passes through to loopback :8787. Reconnects
 * with exponential backoff capped at 30 s, gives up after the tab unmounts
 * the hook. `connected` is exposed so the stage header can render a live/
 * offline indicator.
 */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

export type OctogentEvent =
  | {
      type: 'terminal-created'
      snapshot: { id: string; tentacleId?: string | null }
    }
  | {
      type: 'terminal-updated'
      snapshot: { id: string; tentacleId?: string | null }
    }
  | { type: 'terminal-deleted'; terminalId: string }
  | {
      type: 'terminal-state-changed'
      terminalId: string
      agentRuntimeState: string
      toolName?: string
    }
  | { type: 'terminal-list-changed' }

function invalidateForEvent(qc: QueryClient, event: OctogentEvent) {
  // Every event implies the agent snapshot shifted — always refresh.
  void qc.invalidateQueries({ queryKey: ['octogent', 'agents'] })

  // Scope-shaped events (terminal attach/detach, deletion cascade) also
  // require a scope refresh so todo progress + attached-agent chips stay live.
  if (
    event.type === 'terminal-created' ||
    event.type === 'terminal-updated' ||
    event.type === 'terminal-deleted' ||
    event.type === 'terminal-list-changed'
  ) {
    void qc.invalidateQueries({ queryKey: ['octogent', 'scopes'] })
  }
}

function buildEventsUrl(): string {
  if (typeof window === 'undefined') return ''
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/octogent/api/terminal-events/ws`
}

const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

export type UseOctogentEventsOptions = {
  /** Optional fan-out callback fired on every parsed event in addition to the
   * built-in React Query invalidation. Use this to drive UI animations (e.g.
   * tool-call particle flight, channel-message ribbons) without re-opening a
   * second WS connection. */
  onEvent?: (event: OctogentEvent) => void
}

export function useOctogentEvents(options: UseOctogentEventsOptions = {}): {
  connected: boolean
} {
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS)
  const disposedRef = useRef(false)
  // Hold the latest onEvent in a ref so changing it on parent re-render does
  // not force the WS to reconnect.
  const onEventRef = useRef<UseOctogentEventsOptions['onEvent']>(
    options.onEvent,
  )
  onEventRef.current = options.onEvent

  useEffect(() => {
    if (typeof window === 'undefined') return
    disposedRef.current = false

    const cleanupTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (disposedRef.current || reconnectTimerRef.current !== null) return
      const delay = reconnectDelayRef.current
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        if (!disposedRef.current) connect()
      }, delay)
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS)
    }

    const connect = () => {
      cleanupTimer()
      try {
        wsRef.current?.close()
      } catch {
        // ignore
      }
      const url = buildEventsUrl()
      if (!url) return
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.addEventListener('open', () => {
        // Ignore events from a superseded socket. Under React StrictMode the
        // first (discarded) socket can fire `close` AFTER the second mount has
        // reset disposedRef — without this identity check that stale close would
        // trigger a spurious scheduleReconnect → reconnect loop.
        if (disposedRef.current || ws !== wsRef.current) return
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS
        setConnected(true)
      })

      ws.addEventListener('message', (ev) => {
        // Ignore events from a superseded socket. Under React StrictMode the
        // first (discarded) socket can fire `close` AFTER the second mount has
        // reset disposedRef — without this identity check that stale close would
        // trigger a spurious scheduleReconnect → reconnect loop.
        if (disposedRef.current || ws !== wsRef.current) return
        if (typeof ev.data !== 'string') return
        let parsed: unknown
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          return
        }
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('type' in parsed) ||
          typeof (parsed as { type?: unknown }).type !== 'string'
        ) {
          return
        }
        const event = parsed as OctogentEvent
        invalidateForEvent(qc, event)
        // Fan out to any registered consumer (animations, particles, etc.).
        // Wrapped in try/catch so a consumer bug never tears down the WS.
        try {
          onEventRef.current?.(event)
        } catch (err) {
          console.error('[octogent-events] onEvent callback threw:', err)
        }
      })

      ws.addEventListener('close', () => {
        // Ignore events from a superseded socket. Under React StrictMode the
        // first (discarded) socket can fire `close` AFTER the second mount has
        // reset disposedRef — without this identity check that stale close would
        // trigger a spurious scheduleReconnect → reconnect loop.
        if (disposedRef.current || ws !== wsRef.current) return
        setConnected(false)
        scheduleReconnect()
      })

      ws.addEventListener('error', () => {
        // Ignore events from a superseded socket. Under React StrictMode the
        // first (discarded) socket can fire `close` AFTER the second mount has
        // reset disposedRef — without this identity check that stale close would
        // trigger a spurious scheduleReconnect → reconnect loop.
        if (disposedRef.current || ws !== wsRef.current) return
        // 'error' is always followed by 'close'; let close handle reconnect.
        setConnected(false)
      })
    }

    connect()

    return () => {
      disposedRef.current = true
      cleanupTimer()
      const ws = wsRef.current
      if (ws) {
        // Closing a still-CONNECTING socket makes the browser log a noisy
        // "WebSocket is closed before the connection is established" error —
        // which React StrictMode triggers on every dev mount (mount → connect
        // → cleanup). Defer the close to the handshake completing in that case.
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.addEventListener(
            'open',
            () => {
              try {
                ws.close()
              } catch {
                // ignore
              }
            },
            { once: true },
          )
        } else {
          try {
            ws.close()
          } catch {
            // ignore
          }
        }
      }
      wsRef.current = null
    }
  }, [qc])

  return { connected }
}
