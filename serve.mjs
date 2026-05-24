#!/usr/bin/env node
/**
 * PulseOS production server.
 *
 * The TanStack Start (Vite-native) build emits `dist/server/server.js` as a Web
 * `fetch` handler (SSR + API routes + server functions) — it does NOT listen,
 * serve the client bundle, or replicate the dev-server gateway proxies. This
 * entry wraps all of that into one self-listening Node server so the app runs in
 * real production (parity with `vite dev`, minus HMR):
 *
 *   1. Static files from `dist/client` (hashed /assets/* = immutable; rest short),
 *      via the separator-checked safeStaticPath() traversal guard.
 *   2. Gateway/workspace proxies driven entirely by PROXY_ROUTES (the SSOT in
 *      security-headers.mjs). Every route with `auth: true` is gated through the
 *      app's own /api/auth-check (integrity audit P0 + S-fix-1): the
 *      CLAWSUITE_PASSWORD perimeter only covers SSR routes, so the proxy layer
 *      enforces auth itself.
 *   3. Everything else -> the SSR fetch handler, with the shared hardening
 *      headers + path-scoped CSP (security-headers.mjs, shared with dev).
 *
 * On boot it self-checks the perimeter (S-fix-2): it hits its own gateway proxy
 * unauthenticated and loudly logs if the gate is NOT 401, so a regression cannot
 * ship silently.
 *
 * Env: PORT (default 3010), HOST (default 0.0.0.0),
 *      CLAWDBOT_GATEWAY_URL (default ws://127.0.0.1:18789),
 *      WORKSPACE_DAEMON_URL (default http://127.0.0.1:3099).
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import ssr from './dist/server/server.js'
import {
  HARDENING,
  cspFor,
  GATEWAY_WS_DEFAULT,
  WORKSPACE_HTTP_DEFAULT,
  matchProxyRoute,
  safeStaticPath,
} from './src/server/security-headers.mjs'

const PORT = Number(process.env.PORT) || 3010
const HOST = process.env.HOST || '0.0.0.0'
const CLIENT_DIR = fileURLToPath(new URL('./dist/client', import.meta.url))

const GATEWAY_WS = (
  process.env.CLAWDBOT_GATEWAY_URL || GATEWAY_WS_DEFAULT
).replace(/\/$/, '')
const GATEWAY_HTTP = GATEWAY_WS.replace(/^ws/, 'http')
const WORKSPACE_HTTP = (
  process.env.WORKSPACE_DAEMON_URL || WORKSPACE_HTTP_DEFAULT
).replace(/\/$/, '')

/** HTTP upstream for a proxy route (gateway vs workspace daemon). */
function httpTargetFor(route) {
  return route.target === 'workspace-http' ? WORKSPACE_HTTP : GATEWAY_HTTP
}

function applyHardening(res, pathname) {
  for (const [k, v] of Object.entries(HARDENING)) res.setHeader(k, v)
  res.setHeader('Content-Security-Policy', cspFor(pathname))
}

/**
 * Auth gate for the same-origin proxies. Reuses the app's own /api/auth-check so
 * the in-memory token store + password logic stay the single source of truth.
 * Fails CLOSED on any error (deny by default). No caching: a positive cache here
 * would let a revoked session keep proxying, trading correctness for speculative
 * perf (the call is in-process and the gateway is user-paced).
 */
async function isAuthed(cookie) {
  try {
    const check = await ssr.fetch(
      new Request('http://localhost/api/auth-check', {
        headers: { cookie: cookie || '' },
      }),
    )
    const data = await check.json().catch(() => null)
    // Fail CLOSED on any ambiguous / error / timeout response (deny by default).
    // Do NOT trust `authRequired:false` from an error payload — /api/auth-check
    // returns that on its own timeout, which would otherwise open the gate.
    if (!data || data.error) return false
    if (data.authRequired === false) return true // no password configured -> open
    return data.authenticated === true // password mode -> must be authenticated
  } catch {
    return false
  }
}

function unauthorized(res) {
  res.statusCode = 401
  res.setHeader('Content-Type', 'application/json')
  res.end('{"ok":false,"error":"Unauthorized"}')
}

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
}

// ── Static client assets (dist/client) ───────────────────────────────────────
async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const filePath = safeStaticPath(CLIENT_DIR, pathname)
  if (!filePath) return false
  let s
  try {
    s = await stat(filePath)
  } catch {
    return false
  }
  if (!s.isFile()) return false
  applyHardening(res, pathname)
  res.setHeader(
    'Content-Type',
    MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
  )
  res.setHeader('Content-Length', s.size)
  res.setHeader(
    'Cache-Control',
    pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
  )
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.end()
    return true
  }
  createReadStream(filePath).pipe(res)
  return true
}

// ── HTTP proxy relay (native fetch) ──────────────────────────────────────────
async function proxyHttp(req, res, target, stripPrefix) {
  const url = target + (req.url || '').replace(stripPrefix, '')
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    const kl = k.toLowerCase()
    if (kl === 'host' || kl === 'connection' || kl === 'content-length')
      continue
    headers[k] = v
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  let upstream
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
    })
  } catch {
    res.statusCode = 502
    res.end('Bad Gateway')
    return
  }
  res.statusCode = upstream.status
  for (const [key, value] of upstream.headers) {
    const kl = key.toLowerCase()
    if (kl === 'set-cookie') continue
    // /gateway-ui is meant to be embeddable — strip iframe-blocking headers
    if (
      stripPrefix === '/gateway-ui' &&
      (kl === 'x-frame-options' || kl === 'content-security-policy')
    )
      continue
    res.setHeader(key, value)
  }
  // Defense-in-depth: never let an upstream (gateway/workspace) set or clobber
  // the dashboard's own session cookie via the proxy.
  const sc = (upstream.headers.getSetCookie?.() ?? []).filter(
    (c) => !/^\s*clawsuite-auth=/i.test(c),
  )
  if (sc.length) res.setHeader('Set-Cookie', sc)
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
  else res.end()
}

// ── Node IncomingMessage -> Web Request ──────────────────────────────────────
function toWebRequest(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http')
    .toString()
    .split(',')[0]
    .trim()
  const host = req.headers.host || `localhost:${PORT}`
  const url = `${proto}://${host}${req.url}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((val) => headers.append(k, val))
    else if (v != null) headers.set(k, String(v))
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  })
}

const httpServer = createServer(async (req, res) => {
  try {
    const pathname = (req.url || '/').split('?')[0]

    // Gateway/workspace HTTP proxies — driven by PROXY_ROUTES, auth-gated.
    // (WS upgrades handled in the 'upgrade' listener below.)
    const route = matchProxyRoute(pathname)
    if (route) {
      if (route.auth && !(await isAuthed(req.headers.cookie)))
        return unauthorized(res)
      return await proxyHttp(req, res, httpTargetFor(route), route.prefix)
    }

    // Static client bundle + public files
    if (await serveStatic(req, res, pathname)) return

    // SSR + API routes + server functions
    const webRes = await ssr.fetch(toWebRequest(req))
    res.statusCode = webRes.status
    for (const [key, value] of webRes.headers) {
      if (key.toLowerCase() === 'set-cookie') continue
      res.setHeader(key, value)
    }
    const sc = webRes.headers.getSetCookie?.() ?? []
    if (sc.length) res.setHeader('Set-Cookie', sc)
    applyHardening(res, pathname) // our security headers win over SSR defaults
    if (webRes.body) Readable.fromWeb(webRes.body).pipe(res)
    else res.end()
  } catch (err) {
    console.error('[pulseos] request error:', err)
    if (!res.headersSent) res.statusCode = 500
    res.end('Internal Server Error')
  }
})

// ── WebSocket proxy: PROXY_ROUTES entries with ws:true (auth-gated) ───────────
const wss = new WebSocketServer({ noServer: true })
httpServer.on('upgrade', async (req, socket, head) => {
  const pathname = (req.url || '/').split('?')[0]
  const route = matchProxyRoute(pathname)
  if (!route || !route.ws) {
    socket.destroy()
    return
  }
  if (route.auth && !(await isAuthed(req.headers.cookie))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (client) => {
    const upstream = new WebSocket(
      GATEWAY_WS + (req.url || '').replace(route.prefix, ''),
    )
    const queue = []
    client.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN)
        upstream.send(data, { binary: isBinary })
      else queue.push([data, isBinary])
    })
    upstream.on('open', () => {
      for (const [data, isBinary] of queue)
        upstream.send(data, { binary: isBinary })
      queue.length = 0
    })
    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN)
        client.send(data, { binary: isBinary })
    })
    const closeBoth = () => {
      try {
        client.close()
      } catch {}
      try {
        upstream.close()
      } catch {}
    }
    client.on('close', closeBoth)
    upstream.on('close', closeBoth)
    client.on('error', closeBoth)
    upstream.on('error', (e) => {
      console.error('[pulseos] ws upstream error:', e.message)
      closeBoth()
    })
  })
})

// ── Boot-time perimeter self-check (S-fix-2): prove the gate every start ──────
async function selfCheckPerimeter() {
  try {
    const ac = await ssr
      .fetch(new Request('http://localhost/api/auth-check'))
      .then((r) => r.json())
      .catch(() => ({}))
    if (!ac.authRequired) {
      console.log('[pulseos] perimeter self-check skipped (no password set)')
      return
    }
    const res = await fetch(`http://127.0.0.1:${PORT}/api/gateway-proxy/`, {
      redirect: 'manual',
    }).catch(() => null)
    if (res && res.status === 401) {
      console.log(
        '[pulseos] perimeter self-check OK: gateway proxy gated (401)',
      )
    } else {
      console.error(
        `[pulseos] PERIMETER SELF-CHECK FAILED: /api/gateway-proxy/ returned ${
          res ? res.status : 'no-response'
        } unauthenticated (expected 401). THE GATEWAY MAY BE PUBLICLY EXPOSED.`,
      )
    }
  } catch (e) {
    console.error('[pulseos] perimeter self-check error:', e.message)
  }
}

httpServer.listen(PORT, HOST, () => {
  console.log(
    `[pulseos] production server listening on http://${HOST}:${PORT} (gateway ${GATEWAY_WS}, workspace ${WORKSPACE_HTTP})`,
  )
  setTimeout(selfCheckPerimeter, 1500)
})

// Keep the process alive on transient errors instead of crashing the fleet.
process.on('uncaughtException', (e) =>
  console.error('[pulseos] uncaughtException:', e),
)
process.on('unhandledRejection', (e) =>
  console.error('[pulseos] unhandledRejection:', e),
)
