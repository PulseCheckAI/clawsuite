// Shared redaction utility — masks credentials in error strings, upstream
// response bodies, and any other text that may be surfaced to clients or
// logs. Ported from debug-analyzer.ts (which keeps its own private copy
// for module locality) and broadened slightly to cover Postiz-style
// X-Api-Key reflection paths.
//
// IMPORTANT: this is a defense-in-depth scrubber, not a substitute for
// not putting secrets into strings in the first place. Always prefer
// "log the variable NAME, not the VALUE".

const REDACT_PATTERNS: ReadonlyArray<RegExp> = [
  // OAuth bearer tokens (LinkedIn, Postiz session bearer, generic)
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  // OpenAI-style secret keys
  /\bsk-[A-Za-z0-9_-]{8,}\b/gi,
  // Anthropic-style admin keys
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/gi,
  // Anthropic service-account keys
  /\bsk-svcacct-[A-Za-z0-9_-]{8,}\b/gi,
  // Generic key- prefix
  /\bkey-[A-Za-z0-9_-]{8,}\b/gi,
  // Supabase publishable / service keys
  /\bsb(?:p|_publishable|_secret)?_[A-Za-z0-9_-]{20,}\b/gi,
  // X-Api-Key header reflections (Postiz)
  /\bX-Api-Key:\s*[A-Za-z0-9_-]{8,}\b/gi,
  // Authorization headers with any token style
  /\bAuthorization:\s*[A-Za-z0-9._~+/=-]{8,}\b/gi,
  // CommonPaper-style keys
  /\bzpka_[A-Za-z0-9_-]{8,}\b/gi,
  // Postiz Cloud OAuth access tokens (e.g. pos_aBcDeFg…) — short variants
  // (8-31 chars after the prefix) would otherwise slip past the generic
  // 32+ char catch-all below.
  /\bpos_[A-Za-z0-9_-]{8,}\b/gi,
  // Postiz Cloud OAuth client secrets (pcs_…) — same reasoning as pos_.
  /\bpcs_[A-Za-z0-9_-]{8,}\b/gi,
  // Catch-all: 32+ char alphanumeric tokens (last so the more specific
  // patterns above mask the actual format first; this is a safety net
  // for unknown future credential shapes).
  /\b[A-Za-z0-9]{32,}\b/g,
]

/**
 * Mask credential-shaped substrings inside `value`. Returns a new string
 * with each matched run replaced by `[REDACTED]`. Pure function; never
 * mutates the input.
 *
 * Use this on:
 *   - Error messages caught from `fetch()` / SDK calls before logging
 *   - `hint` fields in API route responses that echo upstream bodies
 *   - Anywhere user-controlled or external-system content may flow to
 *     a logger or to the client
 */
export function maskApiKeys(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value
  return REDACT_PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, '[REDACTED]'),
    value,
  )
}

/**
 * Convenience wrapper for `unknown` error values — handles Error,
 * string, and other shapes uniformly. Use in catch blocks:
 *
 *   } catch (err) {
 *     console.error('post failed:', redactError(err))
 *   }
 */
export function redactError(err: unknown): string {
  if (err instanceof Error) return maskApiKeys(err.message)
  if (typeof err === 'string') return maskApiKeys(err)
  return maskApiKeys(String(err))
}
