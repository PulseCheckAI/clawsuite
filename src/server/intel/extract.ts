// Full-text extraction. Phase 1: fetch + strip (no new dep). SSRF posture
// mirrors feed.ts — http(s) only, size cap, abort timeout.

const MAX_HTML_BYTES = 1_500_000
const FETCH_TIMEOUT_MS = 15_000
const DEFAULT_MAX_CHARS = 20_000

export function isExtractableUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const u = new URL(url.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function htmlToText(html: string, max = DEFAULT_MAX_CHARS): string {
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// Best-effort: returns null on any failure (item stays readable via snippet).
export async function extractFullText(url: string): Promise<string | null> {
  if (!isExtractableUrl(url)) return null
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const ct = res.headers.get('content-type') ?? ''
  if (!/text\/html|application\/xhtml/i.test(ct)) return null
  const html = await res.text().catch(() => '')
  if (!html || html.length > MAX_HTML_BYTES) return null
  const text = htmlToText(html)
  return text.length > 0 ? text : null
}
