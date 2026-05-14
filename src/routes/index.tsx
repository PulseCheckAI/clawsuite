import { createFileRoute, redirect } from '@tanstack/react-router'

// Static redirect — server and client land on the same route to avoid the
// SSR/CSR match divergence that broke TanStack Start's hydration (see
// browser stack: ssr-client.ts:156, <AwaitInner>, setState undefined). The
// mobile-specific routing and first-launch wizard nudge moved into
// /dashboard itself, where window + localStorage are safe to read post-mount.
export const Route = createFileRoute('/')({
  ssr: false,
  beforeLoad: function redirectToDashboard() {
    throw redirect({ to: '/dashboard' as string, replace: true })
  },
  component: function IndexRoute() {
    return null
  },
})
