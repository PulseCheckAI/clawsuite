// PM2 sidecar: RSS Cockpit → Postiz auto-post ticker.
//
// Every TICK_MS it POSTs /api/rss/autopost. The handler (runAutopost) self-gates
// on the configured `intervalMinutes` via lastRunAt, so ticking frequently is
// cheap — it only actually fetches+posts when the configured interval has
// elapsed. Until a feed+channels are configured and enabled, every tick is a
// harmless "disabled"/"not configured" no-op.
//
// Decoupled from the dashboard process on purpose: PM2 keeps this alive across
// HMR reloads and reboots, and it doesn't depend on TanStack route-module
// import timing. Run: pm2 start scripts/rss-autopost-ticker.cjs --name pulseos-rss-autopost
//
// Node 22 has global fetch — no dependencies.

const BASE =
  process.env.PULSEOS_SELF_URL || `http://127.0.0.1:${process.env.PORT || 3010}`
const TICK_MS = Math.max(
  30_000,
  Number(process.env.RSS_AUTOPOST_TICK_MS) || 60_000,
)

function noisyEnough(result) {
  if (!result) return false
  if (result.posted > 0) return true
  const errs = Array.isArray(result.errors) ? result.errors : []
  if (errs.length === 0) return false
  const first = String(errs[0] || '')
  // Suppress the expected idle states; surface real problems.
  return !(
    first === 'disabled' ||
    first.startsWith('not due') ||
    first.startsWith('not configured')
  )
}

async function tick() {
  try {
    const r = await fetch(`${BASE}/api/rss/autopost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const body = await r.json().catch(() => ({}))
    if (noisyEnough(body && body.result)) {
      console.log(
        new Date().toISOString(),
        'autopost:',
        JSON.stringify(body.result),
      )
    }
  } catch (e) {
    console.error(
      new Date().toISOString(),
      'tick error:',
      e && e.message ? e.message : String(e),
    )
  }
}

console.log(`[rss-autopost-ticker] base=${BASE} tick=${TICK_MS}ms`)
tick()
setInterval(tick, TICK_MS)
