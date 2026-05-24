#!/usr/bin/env node
/**
 * Dashboard / prod-server smoke test.
 * Usage: node scripts/dashboard-smoke.mjs [baseUrl]
 * Default: http://localhost:3010 (the PulseOS prod server, serve.mjs).
 *
 * Two concerns:
 *   1. Security perimeter (always asserted) — the integrity-audit P0 regression
 *      guard: when password protection is on, the same-origin gateway/workspace
 *      proxies MUST reject unauthenticated requests with 401. If this ever goes
 *      back to 200, the gateway is publicly exposed again.
 *   2. API contract — endpoint shapes. When the instance is protected and we are
 *      unauthenticated, a 401 on a gated route is EXPECTED (counts as pass).
 */

const BASE = (process.argv[2] || 'http://localhost:3010').replace(/\/$/, '')
let passed = 0
let failed = 0

function ok(name) {
  console.log(`PASS  ${name}`)
  passed++
}
function bad(name, why) {
  console.error(`FAIL  ${name}: ${why}`)
  failed++
}

async function status(name, path, want) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
    if (res.status === want) ok(`${name} (${want})`)
    else bad(name, `expected ${want}, got ${res.status}`)
    return res
  } catch (err) {
    bad(name, err.message)
    return null
  }
}

async function shape(name, path, validate, protectedMode) {
  try {
    const res = await fetch(`${BASE}${path}`)
    if (!res.ok) {
      // Gated route while unauthenticated is acceptable on a protected instance.
      if (protectedMode && (res.status === 401 || res.status === 403)) {
        ok(`${name} (gated ${res.status})`)
        return
      }
      bad(name, `HTTP ${res.status}`)
      return
    }
    const data = await res.json()
    const r = validate(data)
    if (r === true) ok(name)
    else bad(name, r)
  } catch (err) {
    bad(name, err.message)
  }
}

// ── Determine perimeter state ────────────────────────────────────────────────
let protectedMode = false
try {
  const ac = await fetch(`${BASE}/api/auth-check`).then((r) => r.json())
  protectedMode = Boolean(ac.authRequired)
  if (typeof ac.authRequired !== 'boolean')
    bad('auth-check shape', 'no authRequired')
  else ok(`auth-check (authRequired=${ac.authRequired})`)
} catch (err) {
  bad('GET /api/auth-check', err.message)
}

// ── 1. Security perimeter (P0 regression guard) ──────────────────────────────
if (protectedMode) {
  await status(
    'PERIMETER /api/gateway-proxy unauthenticated',
    '/api/gateway-proxy/',
    401,
  )
  await status(
    'PERIMETER /workspace-api unauthenticated',
    '/workspace-api/',
    401,
  )
} else {
  console.log('SKIP  perimeter checks (instance is unprotected — dev mode)')
}

// ── 2. Static asset serving ──────────────────────────────────────────────────
await status('static /pulsecheck-wave.svg', '/pulsecheck-wave.svg', 200)

// ── 3. API contract (auth-tolerant when protected) ───────────────────────────
await shape(
  'GET /api/ping',
  '/api/ping',
  (d) => (d.ok === true ? true : 'missing ok:true'),
  protectedMode,
)
await shape(
  'GET /api/sessions',
  '/api/sessions',
  (d) =>
    Array.isArray(Array.isArray(d) ? d : d?.sessions)
      ? true
      : 'expected sessions array',
  protectedMode,
)
await shape(
  'GET /api/usage',
  '/api/usage',
  (d) => (d.ok || d.payload || d.usage ? true : 'unexpected shape'),
  protectedMode,
)
await shape(
  'GET /api/models',
  '/api/models',
  (d) =>
    Array.isArray(d) || d.models ? true : 'expected array or {models:[]}',
  protectedMode,
)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
