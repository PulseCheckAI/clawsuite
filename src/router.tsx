import { createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'
import { getCspNonce } from './csp-nonce'

// ── Stale-deploy recovery (client only) ──────────────────────────────────────
// When a new version deploys, the hashed chunks an already-open tab references
// are deleted from the server. The next lazy route/import then fails and Vite
// fires `vite:preloadError` (modern serve.mjs now 404s the missing chunk loudly
// instead of returning the HTML shell). Force ONE full reload to pick up the
// current index + chunks, throttled via sessionStorage so a genuinely-broken
// deploy can't thrash in a reload loop.
if (typeof window !== 'undefined') {
  const RELOAD_KEY = 'pulseos:chunk-reload-at'
  const reloadOnce = () => {
    let last = 0
    try {
      last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0)
    } catch {
      // sessionStorage unavailable (private mode / blocked) — proceed to reload
    }
    if (Date.now() - last < 10_000) return // already tried recently → avoid loop
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {
      // ignore — worst case the throttle is a no-op
    }
    window.location.reload()
  }

  // Vite's first-class signal for a failed dynamic import / modulepreload.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault() // we own recovery — stop Vite re-throwing
    reloadOnce()
  })

  // Belt-and-suspenders for raw dynamic-import rejections that don't surface as
  // vite:preloadError (e.g. a hand-written import() in app code).
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event.reason?.message ?? event.reason ?? '')
    if (
      /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
        msg,
      )
    ) {
      reloadOnce()
    }
  })
}

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
