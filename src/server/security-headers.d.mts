/**
 * Type declarations for the shared (plain-ESM) security-headers module so
 * vite.config.ts gets real types. A `.mjs` import resolves to `.d.mts` (not
 * `.d.ts`). serve.mjs imports the .mjs at runtime and ignores this file.
 */
export const STRICT_CSP: string
export const GRAPHS_CSP: string
export function cspFor(pathname: string): string
export const HARDENING: Record<string, string>
export const GATEWAY_WS_DEFAULT: string
export const WORKSPACE_HTTP_DEFAULT: string
export const PROXY_ROUTES: ReadonlyArray<{
  prefix: string
  target: 'gateway-http' | 'gateway-ws' | 'workspace-http'
  ws: boolean
  auth: boolean
}>
