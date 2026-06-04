// ── /api/attention — "Needs you now" aggregator ──────────────────────────────
// The headline attention-inversion surface: instead of hunting across modules,
// the system ranks what needs the operator NOW. Aggregates high-signal sources
// (security posture + live gateway health), each wrapped so one failing source
// degrades to its own item rather than breaking the queue. Read-only.
// ──────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '@/server/auth-middleware'
import { gatewayRpc } from '@/server/gateway'

type Severity = 'critical' | 'warn' | 'info'

interface AttentionItem {
  id: string
  severity: Severity
  title: string
  detail?: string
  source: string
  to?: string
}

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 }

export const Route = createFileRoute('/api/attention')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const items: AttentionItem[] = []

        // ── Security posture ──────────────────────────────────────────────
        if (!isPasswordProtectionEnabled()) {
          items.push({
            id: 'sec-auth-bypass',
            severity: 'critical',
            title: 'Dashboard authentication is bypassed',
            detail:
              'No CLAWSUITE_PASSWORD set — every route is publicly accessible.',
            source: '/api/security/posture',
            to: '/security',
          })
        }

        // ── Gateway health ────────────────────────────────────────────────
        // One `health` call (it carries both the ok flag and eventLoop status)
        // with a short timeout, so a slow/unreachable gateway produces an item
        // fast instead of stalling the queue on the gateway's 30s RPC timeout.
        // (The gateway client serializes WS requests, so we make a single call.)
        const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
          Promise.race([
            p,
            new Promise<T>((_, reject) =>
              setTimeout(() => reject(new Error('gateway timeout')), ms),
            ),
          ])

        try {
          // 8s: the gateway's own health probe legitimately takes ~3s; a tighter
          // bound caused false "unreachable" items. Still bounds the down path.
          const health = await withTimeout(gatewayRpc<any>('health'), 8000)
          if (health && health.ok === false) {
            items.push({
              id: 'gw-unhealthy',
              severity: 'critical',
              title: 'Gateway is not healthy',
              detail: 'The OpenClaw gateway reports a non-ok status.',
              source: 'gateway health',
              to: '/rpc-console',
            })
          }
          if (health?.eventLoop?.degraded) {
            const reasons: string[] = health.eventLoop.reasons ?? []
            items.push({
              id: 'gw-eventloop',
              severity: 'warn',
              title: 'Gateway event loop degraded',
              detail: reasons.length
                ? reasons.join(', ')
                : 'Event loop delay elevated.',
              source: 'gateway health',
              to: '/rpc-console',
            })
          }
        } catch (e) {
          items.push({
            id: 'gw-unreachable',
            severity: 'critical',
            title: 'Gateway unreachable',
            detail: e instanceof Error ? e.message : String(e),
            source: 'gateway health',
            to: '/rpc-console',
          })
        }

        items.sort((a, b) => RANK[a.severity] - RANK[b.severity])

        return json({ ok: true, ts: Date.now(), items })
      },
    },
  },
})
