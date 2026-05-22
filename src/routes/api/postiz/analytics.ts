// Postiz module — analytics endpoint.
// GET /api/postiz/analytics
//
// Postiz's public API has no aggregate "all accounts" analytics route —
// only per-integration /public/v1/analytics/:integration. So this handler
// fans out: list integrations, then fetch analytics for each non-LinkedIn
// one in parallel, then fold each response's metric series into the flat
// AnalyticsAccount shape the Insights tab expects.
//
// Honesty rule: per-integration 404/501/405 means analytics isn't exposed
// for that platform on this Postiz build — silent skip, never fabricate.
// Real errors are aggregated into partialErrors so the UI can surface them.
//
// LinkedIn entries are filtered out before reaching the UI (defense in
// depth; LinkedIn is owned by a separate module).
//
// Called from: src/screens/postiz/postiz-screen.tsx (Insights tab) via
//              fetch('/api/postiz/analytics').

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { callPostiz, isForbiddenPlatform } from './_client'

export interface AnalyticsAccount {
  identifier: string
  name: string
  followers: number | null
  impressions: number | null
  engagement: number | null
  postsCount: number | null
  // Last time Postiz recomputed this row, if surfaced by upstream.
  computedAt: string | null
}

interface IntegrationRow {
  id: string
  identifier: string
  name: string
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const NOT_SUPPORTED_STATUSES = new Set([404, 405, 501])

function parseIntegrations(data: unknown): IntegrationRow[] {
  const list = Array.isArray(data)
    ? data
    : data !== null &&
        typeof data === 'object' &&
        Array.isArray((data as { integrations?: unknown }).integrations)
      ? (data as { integrations: unknown[] }).integrations
      : []

  const rows: IntegrationRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id : null
    const identifier =
      typeof obj.identifier === 'string'
        ? obj.identifier
        : typeof obj.providerIdentifier === 'string'
          ? obj.providerIdentifier
          : null
    if (!id || !identifier) continue
    if (isForbiddenPlatform(identifier)) continue
    const name =
      typeof obj.name === 'string' && obj.name.length > 0
        ? obj.name
        : identifier
    rows.push({ id, identifier, name })
  }
  return rows
}

/**
 * Reduce a per-integration analytics response (Postiz returns a metric series
 * array) into the flat AnalyticsAccount fields. Anything we can't read stays
 * `null` — no fabrication.
 *
 * Expected upstream shape (Postiz v2.x):
 *   [ { label: "Followers", percentageChanges, data: [{ date, total }, ...] },
 *     { label: "Impressions", ... }, { label: "Engagement", ... }, ... ]
 */
function foldMetrics(
  integration: IntegrationRow,
  data: unknown,
): AnalyticsAccount {
  let followers: number | null = null
  let impressions: number | null = null
  let engagement: number | null = null
  let computedAt: string | null = null

  const metrics = Array.isArray(data) ? data : []
  for (const m of metrics) {
    if (!m || typeof m !== 'object') continue
    const mo = m as Record<string, unknown>
    const label = typeof mo.label === 'string' ? mo.label.toLowerCase() : ''
    const points = Array.isArray(mo.data) ? mo.data : []
    const latest = points[points.length - 1]
    if (!latest || typeof latest !== 'object') continue
    const lo = latest as Record<string, unknown>
    const total = numOrNull(lo.total)
    if (total === null) continue
    const date = typeof lo.date === 'string' ? lo.date : null
    if (date && (computedAt === null || date > computedAt)) computedAt = date

    if (label.includes('follow') && followers === null) followers = total
    else if (label.includes('impression') && impressions === null)
      impressions = total
    else if (label.includes('engagement') && engagement === null)
      engagement = total
  }

  return {
    identifier: integration.identifier,
    name: integration.name,
    followers,
    impressions,
    engagement,
    // Postiz analytics doesn't return a post count; left null intentionally
    // so the UI shows the missing field rather than a fabricated zero.
    postsCount: null,
    computedAt,
  }
}

export const Route = createFileRoute('/api/postiz/analytics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Step 1: list integrations so we know which IDs to fan out to.
        const intsResult = await callPostiz<unknown>(
          'GET',
          '/public/v1/integrations',
        )
        if (!intsResult.ok) {
          const notSupported = NOT_SUPPORTED_STATUSES.has(intsResult.status)
          return json(
            {
              ok: false,
              error: notSupported
                ? 'Analytics not available on this Postiz instance'
                : intsResult.error,
              hint: intsResult.hint,
              accounts: [],
            },
            // 200 on not-supported so the Insights tab can render an empty
            // state without console spam; real upstream errors keep their code.
            { status: notSupported ? 200 : intsResult.status },
          )
        }

        const integrations = parseIntegrations(intsResult.data)
        if (integrations.length === 0) {
          return json({ ok: true, accounts: [] })
        }

        // Step 2: fan out per-integration analytics. Partial failures are
        // collected, not fatal — one dead platform shouldn't blank the tab.
        const partialErrors: string[] = []
        const accountResults = await Promise.all(
          integrations.map(async (int) => {
            const a = await callPostiz<unknown>(
              'GET',
              `/public/v1/analytics/${encodeURIComponent(int.id)}`,
            )
            if (!a.ok) {
              // Platform-level "not exposed" stays silent; real errors surface.
              if (!NOT_SUPPORTED_STATUSES.has(a.status)) {
                partialErrors.push(
                  `${int.identifier}: ${a.error ?? `HTTP ${a.status}`}`,
                )
              }
              return null
            }
            return foldMetrics(int, a.data)
          }),
        )

        const accounts = accountResults.filter(
          (a): a is AnalyticsAccount => a !== null,
        )

        return json({
          ok: true,
          accounts,
          ...(partialErrors.length > 0 ? { partialErrors } : {}),
        })
      },
    },
  },
})
