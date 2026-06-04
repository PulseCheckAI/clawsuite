/**
 * useOctogentTerminalStream — subscribe to a single terminal's live output via
 * the proxied per-terminal WebSocket.
 *
 * Connection: `/octogent/api/terminals/:id/ws` — same-origin cookie auth,
 * proxied with ws:true (PROXY_ROUTES prefix '/octogent/api', stripPrefix
 * '/octogent' → upstream /api/terminals/:id/ws). URL is built with the same
 * pattern as buildEventsUrl() in use-octogent-events.ts (wss when https).
 *
 * Upstream emits frames; we recognize:
 *   { type:'output', data|chunk|text }   → appended to a rolling buffer
 *   { type:'state', agentRuntimeState }  → lastState
 * (terminal-state-changed frames carrying agentRuntimeState are also accepted.)
 *
 * Output buffer is capped (~64KB) so a chatty agent can't grow it unbounded.
 * Reconnect uses exponential backoff capped at 30 s, like use-octogent-events.
 * Only connects when `terminalId` is a non-empty string — pass null to idle.
 */
import { useEffect, useRef, useState } from 'react'

const OUTPUT_CAP = 64 * 1024 // ~64KB rolling buffer
const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

function buildTerminalStreamUrl(terminalId: string): string {
  if (typeof window === 'undefined') return ''
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/octogent/api/terminals/${encodeURIComponent(
    terminalId,
  )}/ws`
}

function extractOutput(frame: Record<string, unknown>): string | null {
  for (const key of ['data', 'chunk', 'text', 'output']) {
    const v = frame[key]
    if (typeof v === 'string') return v
  }
  return null
}

export type UseOctogentTerminalStream = {
  connected: boolean
  output: string
  lastState: string | null
}

export function useOctogentTerminalStream(
  terminalId: string | null,
): UseOctogentTerminalStream {
  const [connected, setConnected] = useState(false)
  const [output, setOutput] = useState('')
  const [lastState, setLastState] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS)
  const disposedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!terminalId) {
      // No terminal selected — reset state and stay idle.
      setConnected(false)
      setOutput('')
      setLastState(null)
      return
    }

    disposedRef.current = false
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS
    setOutput('')
    setLastState(null)

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
      const url = buildTerminalStreamUrl(terminalId)
      if (!url) return
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.addEventListener('open', () => {
        if (disposedRef.current) return
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS
        setConnected(true)
      })

      ws.addEventListener('message', (ev) => {
        if (disposedRef.current) return
        if (typeof ev.data !== 'string') return
        let parsed: unknown
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          // Some PTY bridges stream raw text instead of JSON frames; append it.
          setOutput((prev) => (prev + ev.data).slice(-OUTPUT_CAP))
          return
        }
        if (!parsed || typeof parsed !== 'object') return
        const frame = parsed as Record<string, unknown>
        const type = typeof frame.type === 'string' ? frame.type : ''

        if (type === 'state' || type === 'terminal-state-changed') {
          const s = frame.agentRuntimeState ?? frame.state
          if (typeof s === 'string') setLastState(s)
          return
        }

        const chunk = extractOutput(frame)
        if (chunk !== null) {
          setOutput((prev) => (prev + chunk).slice(-OUTPUT_CAP))
        }
      })

      ws.addEventListener('close', () => {
        if (disposedRef.current) return
        setConnected(false)
        scheduleReconnect()
      })

      ws.addEventListener('error', () => {
        if (disposedRef.current) return
        // 'error' is always followed by 'close'; let close handle reconnect.
        setConnected(false)
      })
    }

    connect()

    return () => {
      disposedRef.current = true
      cleanupTimer()
      try {
        wsRef.current?.close()
      } catch {
        // ignore
      }
      wsRef.current = null
      setConnected(false)
    }
  }, [terminalId])

  return { connected, output, lastState }
}
