// ── i18n scaffold ────────────────────────────────────────────────────────────
// English is bundled; the other OpenClaw locales can be lazy-loaded later. Screens
// are wired to t() incrementally — until a string is wired it just renders as a
// literal, so this is additive and safe. Matches OpenClaw's supported-locale set.
// ─────────────────────────────────────────────────────────────────────────────

import en from './locales/en.json'

export type Messages = Record<string, string>

export const SUPPORTED_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'pt-BR',
  'de',
  'es',
  'fr',
  'ja-JP',
  'ko',
  'it',
  'tr',
  'uk',
  'id',
  'pl',
  'th',
  'vi',
  'nl',
  'fa',
  'ar',
] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

const bundles: Partial<Record<Locale, Messages>> = { en: en as Messages }
let current: Locale = 'en'

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (SUPPORTED_LOCALES.includes(locale)) current = locale
}

/** Lazy-load a non-bundled locale's messages (no-op for en / already loaded). */
export async function loadLocale(locale: Locale): Promise<void> {
  if (locale === 'en' || bundles[locale]) return
  try {
    const mod = await import(`./locales/${locale}.json`)
    bundles[locale] = (mod.default ?? mod) as Messages
  } catch {
    // locale file not present yet — callers fall back to en via t().
  }
}

/** Translate a key. Falls back to the en bundle, then the provided fallback, then the key. */
export function t(key: string, fallback?: string): string {
  return bundles[current]?.[key] ?? bundles.en?.[key] ?? fallback ?? key
}
