// PulseOS GraphQL gateway — HTTP mount (GraphQL Yoga over TanStack Start).
// GET/POST /api/graphql. Auth via the existing isAuthenticated; context carries
// the auth flag + per-request DataLoaders. GraphiQL/introspection are dev-only.
//
// PROD HARDENING (TODO before public exposure — Track A → hardening):
//   - disable introspection in production
//   - depth + cost limits (graphql-armor)
//   - persisted queries (APQ) for first-party clients
// Tracked in docs/pulseos-unification-program.md.

import { createFileRoute } from '@tanstack/react-router'
import { createYoga } from 'graphql-yoga'
import { isAuthenticated } from '@/server/auth-middleware'
import { getRequestUser } from '@/server/auth-users'
import {
  schema,
  makeLoaders,
  type GraphQLContext,
} from '@/server/graphql/schema'

const isDev = process.env.NODE_ENV !== 'production'

const yoga = createYoga<Record<string, never>, GraphQLContext>({
  schema,
  graphqlEndpoint: '/api/graphql',
  // GraphiQL explorer + introspection only outside production.
  graphiql: isDev,
  context: ({ request }): GraphQLContext => {
    // Multi-user mode: restrict org-scoped (margin) queries to the session
    // user's own org. Single shared-password / break-glass (no SessionUser)
    // or a user without an org → null = unrestricted (local-admin posture).
    const user = getRequestUser(request)
    return {
      authed: isAuthenticated(request),
      allowedOrgIds: user && user.orgId ? new Set([user.orgId]) : null,
      loaders: makeLoaders(),
    }
  },
})

// TanStack Start forwards a returned Response, but Yoga's response body is a
// ReadableStream that can arrive empty through the dev server's return path. We
// buffer it into a concrete body before returning. This is a JSON API (small
// payloads), so giving up streaming costs nothing and makes the response robust.
async function handle(request: Request): Promise<Response> {
  const res = await yoga.handleRequest(request, {})
  const body = await res.text()
  return new Response(body, { status: res.status, headers: res.headers })
}

export const Route = createFileRoute('/api/graphql')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
