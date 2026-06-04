/**
 * /api/workspace/events — Server-Sent Events stream for workspace state changes.
 *
 * Originally a relay for the workspace-daemon's task_run/checkpoint/mission/
 * agent/audit events. Without the daemon (never vendored), there's nothing
 * producing those events, but the client opens this stream on every mount and
 * shows a "Workspace daemon disconnected" toast on errors. This handler keeps
 * the stream open with periodic keep-alive comments so the toast stays quiet;
 * when real event sources land (e.g. local file watchers, gateway hooks), wire
 * them in here.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const KEEPALIVE_MS = 25_000

export const Route = createFileRoute('/api/workspace/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const encoder = new TextEncoder()
        let timer: ReturnType<typeof setInterval> | null = null
        let closed = false

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // Initial comment to flush proxy buffers + signal connection.
            controller.enqueue(
              encoder.encode(': workspace-events stream open\n\n'),
            )
            controller.enqueue(encoder.encode(`retry: ${KEEPALIVE_MS}\n\n`))
            timer = setInterval(() => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`))
              } catch {
                closed = true
                if (timer) clearInterval(timer)
              }
            }, KEEPALIVE_MS)
          },
          cancel() {
            closed = true
            if (timer) {
              clearInterval(timer)
              timer = null
            }
          },
        })

        // Cleanup on client disconnect.
        const onAbort = () => {
          closed = true
          if (timer) {
            clearInterval(timer)
            timer = null
          }
        }
        request.signal.addEventListener('abort', onAbort, { once: true })

        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          },
        })
      },
    },
  },
})
