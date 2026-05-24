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
 *   1. Static files from `dist/client` (hashed /assets/* = immutable; rest short).
 *   2. Gateway proxies mirroring vite.config.ts `server.proxy`:
 *        /ws-gateway        -> gateway WS  (auth-gated via the app's /api/auth-check)
 *        /api/gateway-proxy -> gateway HTTP
 *        /gateway-ui        -> gateway HTTP/WS (iframe headers stripped)
 *        /workspace-api     -> workspace daemon HTTP
 *   3. Everything else -> the SSR fetch handler, with the same hardening headers
 *      and path-scoped CSP the dev server applies.
 *
 * Env: PORT (default 3010), HOST (default 0.0.0.0),
 *      CLAWDBOT_GATEWAY_URL (default ws://127.0.0.1:18789),
 *      WORKSPACE_DAEMON_URL (default http://127.0.0.1:3099).
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import ssr from './dist/server/server.js'

const PORT = Number(process.env.PORT) || 3010
const HOST = process.env.HOST || '0.0.0.0'
const CLIENT_DIR = fileURLToPath(new URL('./dist/client', import.meta.url))

const GATEWAY_WS = (
  process.env.CLAWDBOT_GATEWAY_URL || 'ws://127.0.0.1:18789'
).replace(/\/$/, '')
const GATEWAY_HTTP = GATEWAY_WS.replace(/^ws/, 'http')
const WORKSPACE_HTTP = (
  process.env.WORKSPACE_DAEMON_URL || 'http://127.0.0.1:3099'
).replace(/\/$/, '')

// ── Security headers (mirror of vite.config.ts) ──────────────────────────────
const STRICT_CSP = [
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
const GRAPHS_CSP = STRICT_CSP.replace(
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
const HARDENING = {
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
function applyHardening(res, pathname) {
  for (const [k, v] of Object.entries(HARDENING)) res.setHeader(k, v)
  res.setHeader(
    'Content-Security-Policy',
    pathname.startsWith('/graphs/') ? GRAPHS_CSP : STRICT_CSP,
  )
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
  let rel
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  } catch {
    return false
  }
  if (rel.includes('..')) return false
  const filePath = join(CLIENT_DIR, rel)
  if (!filePath.startsWith(CLIENT_DIR)) return false
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
  const sc = upstream.headers.getSetCookie?.() ?? []
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

    // HTTP proxies (WS handled in the 'upgrade' listener below)
    if (pathname.startsWith('/api/gateway-proxy'))
      return await proxyHttp(req, res, GATEWAY_HTTP, '/api/gateway-proxy')
    if (pathname.startsWith('/gateway-ui'))
      return await proxyHttp(req, res, GATEWAY_HTTP, '/gateway-ui')
    if (pathname.startsWith('/workspace-api'))
      return await proxyHttp(req, res, WORKSPACE_HTTP, '/workspace-api')

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

// ── WebSocket proxy: /ws-gateway (auth-gated) + /gateway-ui ───────────────────
const wss = new WebSocketServer({ noServer: true })
httpServer.on('upgrade', async (req, socket, head) => {
  const pathname = (req.url || '/').split('?')[0]
  let target = null
  let strip = null
  let gate = false
  if (pathname.startsWith('/ws-gateway')) {
    target = GATEWAY_WS
    strip = '/ws-gateway'
    gate = true
  } else if (pathname.startsWith('/gateway-ui')) {
    target = GATEWAY_WS
    strip = '/gateway-ui'
  } else {
    socket.destroy()
    return
  }

  // Gate the gateway WS on a valid session — reuse the app's own auth-check so
  // the in-memory token store + password logic are the single source of truth.
  if (gate) {
    try {
      const check = await ssr.fetch(
        new Request('http://localhost/api/auth-check', {
          headers: { cookie: req.headers.cookie || '' },
        }),
      )
      const data = await check.json().catch(() => ({}))
      if (data.authRequired && !data.authenticated) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
      return
    }
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    const upstream = new WebSocket(target + (req.url || '').replace(strip, ''))
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

httpServer.listen(PORT, HOST, () => {
  console.log(
    `[pulseos] production server listening on http://${HOST}:${PORT} (gateway ${GATEWAY_WS}, workspace ${WORKSPACE_HTTP})`,
  )
})

// Keep the process alive on transient errors instead of crashing the fleet.
process.on('uncaughtException', (e) =>
  console.error('[pulseos] uncaughtException:', e),
)
process.on('unhandledRejection', (e) =>
  console.error('[pulseos] unhandledRejection:', e),
)
