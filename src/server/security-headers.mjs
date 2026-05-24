/**
 * Shared security headers + proxy config — the SINGLE source of truth for both
 * the dev server (vite.config.ts) and the production server (serve.mjs).
 *
 * Plain ESM (.mjs) on purpose: serve.mjs runs under bare Node and cannot import
 * a .ts module, while vite.config.ts (esbuild) imports .mjs fine. Keeping these
 * here stops the dev/prod drift flagged in the integrity audit (S1).
 */

// Strict app-wide CSP. The 3D graph viewers under /graphs/* are the ONLY surface
// that needs external origins, so the loosening is scoped to them (GRAPHS_CSP).
export const STRICT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http: https:",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  "frame-src 'self' http: https:",
].join('; ')

export const GRAPHS_CSP = STRICT_CSP.replace(
  "frame-ancestors 'none'",
  "frame-ancestors 'self'",
)
  .replace(
    "script-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  )
  .replace(
    "style-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  )
  .replace(
    "font-src 'self' data:",
    "font-src 'self' data: https://fonts.gstatic.com",
  )

/** CSP string for a given request path. */
export function cspFor(pathname) {
  return pathname && pathname.startsWith('/graphs/') ? GRAPHS_CSP : STRICT_CSP
}

/** Defensive hardening headers applied to every response. */
export const HARDENING = {
  'Permissions-Policy': [
    'unload=()',
    'beforeunload=()',
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'accelerometer=()',
    'payment=()',
    'usb=()',
    'serial=()',
    'browsing-topics=()',
    'interest-cohort=()',
  ].join(', '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
}

// ── Same-origin proxy topology (mirrors vite.config.ts server.proxy) ──────────
export const GATEWAY_WS_DEFAULT = 'ws://127.0.0.1:18789'
export const WORKSPACE_HTTP_DEFAULT = 'http://127.0.0.1:3099'

/**
 * Every gateway/workspace proxy prefix and whether it requires an authenticated
 * session. ALL of them are gated when the origin is internet-exposed: the
 * CLAWSUITE_PASSWORD perimeter only covers SSR routes, NOT proxy paths, so the
 * proxy layer must enforce auth itself (integrity audit P0).
 */
export const PROXY_ROUTES = [
  {
    prefix: '/api/gateway-proxy',
    target: 'gateway-http',
    ws: false,
    auth: true,
  },
  { prefix: '/gateway-ui', target: 'gateway-http', ws: true, auth: true },
  { prefix: '/workspace-api', target: 'workspace-http', ws: false, auth: true },
  { prefix: '/ws-gateway', target: 'gateway-ws', ws: true, auth: true },
]
