/**
 * Type declarations for the shared (plain-ESM) security-headers module so
 * vite.config.ts gets real types. A `.mjs` import resolves to `.d.mts` (not
 * `.d.ts`). serve.mjs imports the .mjs at runtime and ignores this file.
 */
export interface ProxyRoute {
  prefix: string
  target:
    | 'gateway-http'
    | 'gateway-ws'
    | 'render-ws'
    | 'octogent-http'
    | 'lightrag-http'
  ws: boolean
  auth: boolean
  /** Optional: when set, override the upstream path entirely (instead of
   * stripping `prefix` from the request URL). Used by /api/media/subscribe
   * → /jobs/subscribe so the dashboard-side path stays /api/media/* without
   * leaking into the render server's URL space. */
  rewriteTo?: string
  /** Optional: alternate strip-prefix when the match prefix and the
   * upstream-expected strip differ. Used by /octogent/api → strips only
   * `/octogent` so upstream still sees `/api/...`. */
  stripPrefix?: string
}

export const STRICT_CSP: string
export const GRAPHS_CSP: string
export function cspFor(pathname: string): string
export const HARDENING: Record<string, string>
export const GATEWAY_WS_DEFAULT: string
export const RENDER_WS_DEFAULT: string
export const OCTOGENT_HTTP_DEFAULT: string
export const OCTOGENT_WS_DEFAULT: string
export const LIGHTRAG_HTTP_DEFAULT: string
export const PROXY_ROUTES: ReadonlyArray<ProxyRoute>
export function matchProxyRoute(pathname: string): ProxyRoute | null
export function safeStaticPath(clientDir: string, pathname: string): string | null
