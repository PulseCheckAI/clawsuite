import { createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'
import { getCspNonce } from './csp-nonce'

// Create a new router instance
export const getRouter = () => {
  // Per-request CSP nonce (audit D2): server-side this reads the x-csp-nonce
  // header injected by serve.mjs so TanStack stamps `nonce=` on its SSR-injected
  // scripts, letting prod drop script-src 'unsafe-inline'. undefined in dev / on
  // the client, where the CSP keeps 'unsafe-inline'. (Server import lives in
  // csp-nonce.ts behind createIsomorphicFn so it's stripped from the client.)
  const nonce = getCspNonce()

  const router = createRouter({
    routeTree,
    context: {},

    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ...(nonce ? { ssr: { nonce } } : {}),
  })

  return router
}
