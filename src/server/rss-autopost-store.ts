// File-backed config + dedupe store for RSS Cockpit → Postiz auto-posting.
//
// Mirrors the conventions of oauth-token-store.ts: a single JSON file under
// `<cwd>/data/` (mode 0600, gitignored), validated on read, never throws —
// callers always get a usable config (defaults merged over whatever is on disk).
//
// This holds NO secrets: `platforms` are Postiz *account ids* (not API keys),
// and `seenLinks` are public article URLs used only for dedupe. The Postiz API
// key itself lives in the existing postiz client/env, never here.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface RssAutopostResult {
  at: string // ISO of the run
  posted: number
  skipped: number
  errors: string[]
}

export interface RssAutopostConfig {
  enabled: boolean
  feedRoute: string // legacy single route — kept for back-compat
  feedRoutes: string[] // RSSHub paths (multi-feed). Falls back to [feedRoute] when empty.
  platforms: string[] // Postiz account ids to post to
  intervalMinutes: number // how often the scheduler runs the cycle
  maxPerRun: number // safety cap: max new items posted per cycle
  contentTemplate: string // supports {title} and {link} placeholders
  generateImages: boolean // attach a free Pollinations Flux image per post
  seenLinks: string[] // dedupe set (FIFO-capped) of already-posted item links
  lastRunAt: string | null
  lastResult: RssAutopostResult | null
}

const SEEN_CAP = 500 // bound the dedupe set so the file can't grow unbounded

export const AUTOPOST_DEFAULTS: RssAutopostConfig = {
  enabled: false,
  feedRoute: '',
  feedRoutes: [],
  platforms: [],
  intervalMinutes: 30,
  maxPerRun: 5,
  contentTemplate: '{title}\n\n{link}',
  generateImages: false,
  seenLinks: [],
  lastRunAt: null,
  lastResult: null,
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

function storePath(): string {
  const override = process.env.RSS_AUTOPOST_CONFIG_PATH
  if (override && override.length > 0) return resolve(override)
  return resolve(process.cwd(), 'data', 'rss-autopost-config.json')
}

/** Read config, merging file values over defaults. Never throws. */
export function readAutopostConfig(): RssAutopostConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(storePath(), 'utf8'))
  } catch {
    return { ...AUTOPOST_DEFAULTS }
  }
  if (!isPlainObject(parsed)) return { ...AUTOPOST_DEFAULTS }
  const p = parsed
  const num = (v: unknown, d: number, min: number, max: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : d
    return Math.min(Math.max(n, min), max)
  }
  return {
    enabled: p.enabled === true,
    feedRoute: typeof p.feedRoute === 'string' ? p.feedRoute : '',
    feedRoutes: strArray(p.feedRoutes),
    platforms: strArray(p.platforms),
    intervalMinutes: num(p.intervalMinutes, 30, 5, 1440),
    maxPerRun: num(p.maxPerRun, 5, 1, 25),
    contentTemplate:
      typeof p.contentTemplate === 'string' && p.contentTemplate.length > 0
        ? p.contentTemplate
        : AUTOPOST_DEFAULTS.contentTemplate,
    generateImages: p.generateImages === true,
    seenLinks: strArray(p.seenLinks).slice(-SEEN_CAP),
    lastRunAt: typeof p.lastRunAt === 'string' ? p.lastRunAt : null,
    lastResult: isPlainObject(p.lastResult)
      ? {
          at: typeof p.lastResult.at === 'string' ? p.lastResult.at : '',
          posted:
            typeof p.lastResult.posted === 'number' ? p.lastResult.posted : 0,
          skipped:
            typeof p.lastResult.skipped === 'number' ? p.lastResult.skipped : 0,
          errors: strArray(p.lastResult.errors),
        }
      : null,
  }
}

/** Persist config. seenLinks is FIFO-capped to SEEN_CAP before writing. */
export function writeAutopostConfig(cfg: RssAutopostConfig): void {
  const path = storePath()
  mkdirSync(dirname(path), { recursive: true })
  const bounded: RssAutopostConfig = {
    ...cfg,
    seenLinks: cfg.seenLinks.slice(-SEEN_CAP),
  }
  writeFileSync(path, JSON.stringify(bounded, null, 2) + '\n', {
    mode: 0o600,
    encoding: 'utf8',
  })
}

/** Merge a partial patch into the stored config and persist. Returns the merged config. */
export function patchAutopostConfig(
  patch: Partial<RssAutopostConfig>,
): RssAutopostConfig {
  const merged = { ...readAutopostConfig(), ...patch }
  writeAutopostConfig(merged)
  return merged
}
