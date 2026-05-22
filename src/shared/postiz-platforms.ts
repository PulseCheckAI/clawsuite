// Postiz platform constants + pure string helpers. Browser-safe by design —
// NO Node imports allowed in this file. The previous home for these helpers
// was `src/routes/api/postiz/_client.ts`, but that module pulls in
// `postiz-oauth-store.ts → node:fs`, which Vite cannot externalize for the
// browser bundle. The frontend (`src/screens/postiz/postiz-screen.tsx`) and
// every server route share this module so both sides have a single source
// of truth for the LinkedIn-exclusion rule and per-platform char limits.
//
// IMPORTANT: do not add `node:fs`, `node:path`, `node:crypto`, or any other
// Node-only import here. Anything that needs them belongs in `_client.ts`
// or `postiz-oauth-store.ts`.

/** Platforms Postiz supports, EXCLUDING LinkedIn (out of scope for this module). */
export const POSTIZ_SUPPORTED_PLATFORMS = [
  'x',
  'instagram',
  'instagram-standalone',
  'facebook',
  'youtube',
  'tiktok',
  'reddit',
  'threads',
  'bluesky',
  'mastodon',
  'pinterest',
  'telegram',
  'discord',
  'slack',
  'dribbble',
  'lemmy',
  'farcaster',
  'nostr',
  'vk',
  'medium',
  'devto',
  'hashnode',
  'wordpress',
] as const

export type PostizPlatform = (typeof POSTIZ_SUPPORTED_PLATFORMS)[number]

/**
 * Platforms this module explicitly REFUSES to post to. The runtime check
 * below uses a `startsWith('linkedin')` prefix match — this constant exists
 * as documentation of the known variants we've observed in production
 * (linkedin, linkedin-page, linkedin-personal, linkedin-company …). Any
 * future hyphenated variant is automatically covered by the prefix match.
 */
export const POSTIZ_FORBIDDEN_PLATFORMS = [
  'linkedin',
  'linkedin-page',
  'linkedin-personal',
  'linkedin-company',
] as const

export function isForbiddenPlatform(value: string): boolean {
  const v = value.toLowerCase().trim()
  // Prefix match — catches every hyphenated LinkedIn variant Postiz may
  // emit (linkedin-page, linkedin-personal, linkedin-company, …) without
  // needing to keep an enumerated list up to date.
  return v.startsWith('linkedin')
}

/**
 * Drop any LinkedIn entries from an array of platform identifiers / records.
 * The accessor extracts a string from each item (e.g. (x) => x.identifier).
 */
export function stripLinkedIn<T>(items: T[], getKey: (x: T) => string): T[] {
  return items.filter((x) => !isForbiddenPlatform(getKey(x)))
}

/** Per-platform character limits used by the composer's character counter. */
export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  threads: 500,
  bluesky: 300,
  mastodon: 500,
  instagram: 2200,
  'instagram-standalone': 2200,
  facebook: 63206,
  youtube: 5000,
  tiktok: 2200,
  reddit: 40000,
  pinterest: 500,
  telegram: 4096,
  discord: 2000,
  slack: 40000,
  dribbble: 275,
  lemmy: 10000,
  farcaster: 320,
  nostr: 10000,
  vk: 16000,
  medium: 100000,
  devto: 100000,
  hashnode: 250000,
  wordpress: 100000,
}

export function getCharLimit(platform: string): number {
  return PLATFORM_CHAR_LIMITS[platform.toLowerCase()] ?? 5000
}
