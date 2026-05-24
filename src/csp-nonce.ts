import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

/**
 * Per-request CSP nonce (audit D2). On the server it reads the `x-csp-nonce`
 * header that the production server (serve.mjs) injects per request; TanStack's
 * plugin strips the server-only import from the client bundle, where this returns
 * undefined. Used by getRouter() to set `ssr.nonce` so the SSR-injected scripts
 * and our inline IIFEs can be nonced and prod can drop script-src 'unsafe-inline'.
 */
export const getCspNonce = createIsomorphicFn()
  .server(() => getRequestHeader('x-csp-nonce') || undefined)
  .client(() => undefined)
