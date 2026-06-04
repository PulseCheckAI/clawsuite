// ── render-server bridge ────────────────────────────────────────────────────
// Single source of truth for the dashboard <-> remotion-studio render server
// (node:http sidecar at http://127.0.0.1:8140 by default, see
// os/remotion-studio/server/render.mjs).
//
// Why a helper:
//   * Centralizes the env override (RENDER_SERVER_URL) so the three proxy
//     routes (walkthroughs / render / stream) agree on the base URL.
//   * Resolves the on-disk RENDERS_DIR path so the streaming proxy can
//     fs.createReadStream() the MP4 directly. render.mjs writes outputs to
//     `${RENDERS_DIR}/${composition_id}-${job_id}.${ext}` (render.mjs:68),
//     so the stream route does a tiny directory scan for `*-${jobId}.mp4`.
//
// Tenant note: the render server today has NO per-org awareness; every
// authed dashboard user sees every job. Flagged for v2; do not add a
// silent org filter here without a schema change on render.mjs's job
// ring buffer first (silent filtering = silent data loss).
// ────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path'

const DEFAULT_BASE = 'http://127.0.0.1:8140'

// 5s upstream timeout — the /jobs + /render endpoints are in-memory ops
// that should return in <100ms; anything over 5s means the sidecar is
// wedged and we'd rather surface "down" than hang the panel.
export const RENDER_FETCH_TIMEOUT_MS = 5_000

// The render server writes MP4s to RENDERS_DIR = os/remotion-studio/renders.
// The dashboard runs from os/dashboard-clawsuite at runtime (pm2 cwd =
// dashboard root). We resolve up one level to /os, then back down. For
// non-default deploys, RENDER_OUTPUT_DIR overrides the resolution entirely.
function defaultRendersDir(): string {
  const cwd = process.cwd()
  if (cwd.replace(/\\/g, '/').endsWith('/dashboard-clawsuite')) {
    return resolve(cwd, '..', 'remotion-studio', 'renders')
  }
  // Fallback when launched from monorepo root (e.g. `pnpm dev` upstream).
  return resolve(cwd, 'os', 'remotion-studio', 'renders')
}

export function renderBaseUrl(): string {
  const raw = process.env.RENDER_SERVER_URL?.trim()
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : DEFAULT_BASE
}

export function rendersDir(): string {
  const raw = process.env.RENDER_OUTPUT_DIR?.trim()
  return raw && raw.length > 0 ? raw : defaultRendersDir()
}

/** Three known compositions — must match COMPOSITION_CATALOG in
 * os/remotion-studio/src/types/props.ts. Mirrored here (string-only) so the
 * /render proxy can reject unknown ids without importing the TS catalog
 * (which would pull zod + the remotion compositions tree into the
 * dashboard bundle). render.mjs validates the same set server-side. */
export const VALID_COMPOSITION_IDS = new Set<string>([
  'MarginLeakRecap',
  'WeeklyKpiRecap',
  'OutreachHook',
])
