// PM2 sidecar: poll all enabled intel sources on an interval.
// Phase 1 = ingest only. Later phases add enrich/cluster/brief stages behind
// one /api/intel/pipeline/run. Node 22 global fetch, no deps.
// Run: pm2 start scripts/intel-pipeline.cjs --name pulseos-intel-pipeline

const BASE =
  process.env.PULSEOS_SELF_URL || `http://127.0.0.1:${process.env.PORT || 3010}`
const TICK_MS = Math.max(60_000, Number(process.env.INTEL_TICK_MS) || 600_000) // default 10m

async function tick() {
  // Stage 1: ingest new items from all enabled sources.
  try {
    const r = await fetch(`${BASE}/api/intel/ingest`, { method: 'POST' })
    const b = await r.json().catch(() => ({}))
    if (b && b.ok && b.inserted > 0) {
      console.log(
        new Date().toISOString(),
        'intel ingest:',
        b.inserted,
        'new from',
        b.sources,
        'sources',
      )
    }
  } catch (e) {
    console.error(
      new Date().toISOString(),
      'intel ingest error:',
      e && e.message ? e.message : String(e),
    )
  }

  // Stage 2: enrich (embed + best-effort summary/tags/score) a batch of
  // un-enriched items. Drains the backlog over successive ticks.
  try {
    const r = await fetch(`${BASE}/api/intel/enrich`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: Number(process.env.INTEL_ENRICH_PER_TICK) || 25,
      }),
    })
    const b = await r.json().catch(() => ({}))
    if (b && b.ok && b.processed > 0) {
      console.log(
        new Date().toISOString(),
        'intel enrich:',
        b.embedded,
        'embedded,',
        b.summarized,
        'summarized',
      )
    }
  } catch (e) {
    console.error(
      new Date().toISOString(),
      'intel enrich error:',
      e && e.message ? e.message : String(e),
    )
  }
}

console.log(`[intel-pipeline] base=${BASE} tick=${TICK_MS}ms`)
tick()
setInterval(tick, TICK_MS)
