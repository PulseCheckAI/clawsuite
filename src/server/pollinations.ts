// Pollinations image engine — free, no-key, server-callable image generation.
//
// Pollinations returns a Flux image at a STABLE public GET URL, so the autopost
// pipeline just hands that URL to Postiz as a media URL and Postiz fetches it
// directly — no job polling, no download/re-host, no cross-container plumbing.
//
// Verified live: GET https://image.pollinations.ai/prompt/<enc>?... → real JPEG
// (1280x720 Flux, ~1.2s, no API key). Docs: github.com/pollinations/pollinations
//
// Quality note (honest): this is Flux-grade — strong, on-topic HD stills, NOT a
// pixel-perfect "100% match" (no generative model is). For local 4K/Nano-Banana
// or video, route through the WAN2GP adapter instead; this is the always-on,
// zero-setup fallback.

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt'

export interface PollinationsImageOptions {
  width?: number
  height?: number
  /** Pollinations model: 'flux' (default, best), 'turbo' (faster). */
  model?: string
  /** Deterministic output when set. */
  seed?: number
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(v), min), max)
}

/**
 * Build a brand-appropriate image prompt from a feed item. The image should
 * illustrate the item's topic in a clean editorial style with NO text/watermark
 * (text rendered by image models is unreliable and looks off on social).
 */
export function imagePromptForItem(item: {
  title?: string | null
  description?: string | null
}): string {
  const title = (item.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const subject = title || 'a modern professional scene'
  return [
    subject,
    'editorial photograph',
    'clean composition',
    'soft natural lighting',
    'shallow depth of field',
    'high detail',
    'no text, no watermark, no logos',
  ].join(', ')
}

/** Construct the stable Pollinations image URL (the URL IS the image). */
export function pollinationsImageUrl(
  prompt: string,
  opts: PollinationsImageOptions = {},
): string {
  const width = clampInt(opts.width ?? 1280, 256, 1920)
  const height = clampInt(opts.height ?? 720, 256, 1920)
  const model =
    opts.model && /^[a-z0-9-]+$/i.test(opts.model) ? opts.model : 'flux'
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: 'true',
    enhance: 'true',
  })
  if (typeof opts.seed === 'number' && Number.isFinite(opts.seed)) {
    params.set('seed', String(Math.trunc(opts.seed)))
  }
  return `${POLLINATIONS_BASE}/${encodeURIComponent(prompt.trim())}?${params.toString()}`
}

/** Convenience: prompt + URL for a feed item in one call. */
export function imageUrlForItem(
  item: { title?: string | null; description?: string | null },
  opts?: PollinationsImageOptions,
): string {
  return pollinationsImageUrl(imagePromptForItem(item), opts)
}
