// useJobPolling — polls /api/media/status/:id every 2s for any active jobs in
// the queue. Uses a ref-tracked queue snapshot to avoid stale-closure reads
// without re-subscribing on every state change.

import { useEffect, useRef } from 'react'
import type { QueueEntry, StatusResponse } from '../types'

export function useJobPolling(
  queue: QueueEntry[],
  setQueue: React.Dispatch<React.SetStateAction<QueueEntry[]>>,
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Keep an always-current reference to the queue so the polling closure
  // doesn't read stale state without forcing a re-subscription each tick.
  const queueRef = useRef(queue)
  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    const hasActive = queue.some(
      (e) => e.status === 'queued' || e.status === 'running',
    )
    if (!hasActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    if (intervalRef.current) return

    intervalRef.current = setInterval(() => {
      const active = queueRef.current.filter(
        (e) => e.status === 'queued' || e.status === 'running',
      )
      active.forEach((entry) => {
        void (async () => {
          try {
            const res = await fetch(
              `/api/media/status/${encodeURIComponent(entry.jobId)}`,
              { headers: { accept: 'application/json' } },
            )
            const data = (await res.json()) as StatusResponse
            if (!res.ok || !data.ok || !data.status) return
            const s = data.status
            setQueue((q) =>
              q.map((e) =>
                e.jobId === entry.jobId
                  ? {
                      ...e,
                      status: s.status === 'unknown' ? e.status : s.status,
                      progress: s.progress,
                      phase: s.phase,
                      error: s.error,
                      artifactUrl: s.artifactUrl ?? e.artifactUrl,
                      finishedAt:
                        s.finishedAt ??
                        (s.status === 'done' || s.status === 'failed'
                          ? Date.now() / 1000
                          : e.finishedAt),
                    }
                  : e,
              ),
            )
          } catch {
            // Network blips are fine; next tick will retry.
          }
        })()
      })
    }, 2000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [queue, setQueue])
}
