// ── composition-form-shared ─────────────────────────────────────────────────
// Shared bits for the three typed render forms (MarginLeakRecap,
// WeeklyKpiRecap, OutreachHook). Lives next to the forms so the route file
// doesn't bloat with form scaffolding.
//
// Conventions match voice.agents.tsx / voice.voices.tsx: voice-hub tokens
// via CSSProperties + inline styles, no new top-level UI deps, plain TS
// validators (no zod runtime in browser — schemas are in
// os/remotion-studio/src/types/props.ts but that's a separate workspace).
// ────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react'

// ── Shared grade type (mirrors GradeSchema in
// os/remotion-studio/src/types/props.ts; that file's the SSOT). ─────────────
export type CompositionGrade = 'excellent' | 'good' | 'warning' | 'critical'

export const GRADE_VALUES: ReadonlyArray<CompositionGrade> = [
  'excellent',
  'good',
  'warning',
  'critical',
]

// ── Validation helpers ──────────────────────────────────────────────────────
// Plain regex/range checks — no zod in the browser bundle. The render
// server validates with zod server-side (the SSOT). These client-side
// checks just give the operator instant feedback before the network hop.

export const BRAND_COLOR_RE = /^#[0-9a-fA-F]{6}$/
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Empty validators-by-field map. Use FieldErrors<TFields> in form state. */
export type FieldErrors<TFields extends string> = Partial<
  Record<TFields, string>
>

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function isOptionalUrl(v: string): boolean {
  if (v.trim().length === 0) return true
  try {
    // URL constructor throws on bad input — matches zod's .url() semantics.
    // eslint-disable-next-line no-new
    new URL(v)
    return true
  } catch {
    return false
  }
}

/** Trim then normalize an optional URL: '' → null, otherwise return the
 * trimmed string. Used when serializing form state to the props payload —
 * the renderer's schema expects `logo_url: string | null`. */
export function trimOptionalUrl(v: string): string | null {
  const t = v.trim()
  return t.length === 0 ? null : t
}

/** Parse comma/whitespace-separated numbers. Skips empty tokens. Returns
 * `null` if any token fails to parse — caller treats that as a validation
 * error and surfaces a message. */
export function parseNumberList(raw: string): Array<number> | null {
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  const out: Array<number> = []
  for (const t of tokens) {
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    out.push(n)
  }
  return out
}

/** Format an integer cent value as a USD dollar string for under-input
 * helper text. Matches the formatMoney helper in
 * screens/dashboard/lib/formatters.ts but is duplicated here to keep
 * media-form components decoupled from the dashboard screens tree. */
export function formatCentsAsDollars(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

// ── Form-field primitives ──────────────────────────────────────────────────
// Mirror the FormField + inputStyle pattern used in media.walkthroughs.tsx
// + voice.agents.tsx so the typed forms look identical to the rest of
// voice-hub.

export function FormFieldShell({
  label,
  htmlFor,
  hint,
  error,
  counter,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string | null
  counter?: string
  children: ReactNode
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <label
          htmlFor={htmlFor}
          className="font-mono"
          style={{
            display: 'block',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--vh-text-muted)',
          }}
        >
          {label}
        </label>
        {counter && (
          <span
            className="font-mono"
            style={{ fontSize: 10, color: 'var(--vh-text-faint)' }}
          >
            {counter}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--vh-blocked)',
          }}
        >
          {error}
        </div>
      ) : hint ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--vh-text-faint)',
          }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  )
}

export const formInputStyle: CSSProperties = {
  width: '100%',
  minHeight: 40,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--vh-glass-border)',
  background: 'var(--vh-base-elevated)',
  color: 'var(--vh-text)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
}

export const formTextareaStyle: CSSProperties = {
  ...formInputStyle,
  fontFamily: 'inherit',
  lineHeight: 1.45,
  minHeight: 72,
  resize: 'vertical',
}

export const sectionTitleStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--vh-text-muted)',
  marginTop: 6,
  marginBottom: 2,
}

export const fieldsetStyle: CSSProperties = {
  border: '1px solid var(--vh-glass-border)',
  borderRadius: 10,
  padding: 12,
  margin: 0,
  display: 'grid',
  gap: 10,
}

export const fieldsetLegendStyle: CSSProperties = {
  padding: '0 6px',
  fontFamily: 'monospace',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--vh-text)',
}

// ── Grade radio (shared by all three forms) ────────────────────────────────

export function GradeRadioGroup({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string
  value: CompositionGrade
  onChange: (g: CompositionGrade) => void
  disabled: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Grade"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {GRADE_VALUES.map((g) => {
        const checked = value === g
        return (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={disabled ? undefined : () => onChange(g)}
            disabled={disabled}
            data-grade={g}
            data-name={name}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: checked ? gradeFg(g) : 'var(--vh-text-muted)',
              background: checked ? gradeBg(g) : 'transparent',
              border: `1px solid ${
                checked ? gradeBorder(g) : 'var(--vh-glass-border)'
              }`,
            }}
          >
            {g}
          </button>
        )
      })}
    </div>
  )
}

function gradeFg(g: CompositionGrade): string {
  switch (g) {
    case 'excellent':
    case 'good':
      return 'var(--vh-compliant)'
    case 'warning':
      return 'var(--vh-warming)'
    case 'critical':
      return 'var(--vh-blocked)'
  }
}
function gradeBg(g: CompositionGrade): string {
  switch (g) {
    case 'excellent':
    case 'good':
      return 'var(--vh-compliant-soft)'
    case 'warning':
      return 'var(--vh-warming-soft)'
    case 'critical':
      return 'var(--vh-blocked-soft)'
  }
}
function gradeBorder(g: CompositionGrade): string {
  switch (g) {
    case 'excellent':
    case 'good':
      return 'var(--vh-compliant-border)'
    case 'warning':
      return 'var(--vh-warming-border)'
    case 'critical':
      return 'var(--vh-blocked-border)'
  }
}

// ── Form-prop shapes + defaults (mirrored from
// os/remotion-studio/src/Root.tsx + types/props.ts; SSOT lives there) ───────

export interface MarginLeakRecapFormProps {
  org: { name: string; logo_url: string | null }
  leak: {
    title: string
    recoverable_cents: number
    trend_points: Array<number>
    grade: CompositionGrade
  }
  brand_color: string
}

export interface WeeklyKpiRecapFormProps {
  org: { name: string; logo_url: string | null }
  week_start: string
  kpis: {
    prime_cost: { value: string; delta_pct: number; grade: CompositionGrade }
    labor: { value: string; delta_pct: number; grade: CompositionGrade }
    sales: { value: string; delta_pct: number; grade: CompositionGrade }
    leak_count: { value: string; delta_pct: number; grade: CompositionGrade }
  }
  summary_line: string
  brand_color: string
}

export interface OutreachHookFormProps {
  prospect: { name: string; logo_url: string | null }
  pain_point: string
  evidence_line: string
  brand_color: string
}

export const MARGIN_LEAK_DEFAULTS: MarginLeakRecapFormProps = {
  org: { name: 'The Corner Table', logo_url: null },
  leak: {
    title: 'Prime cost over target',
    recoverable_cents: 574600,
    trend_points: [
      62.1, 61.4, 63.2, 64.0, 65.5, 63.8, 64.9, 66.2, 65.7, 64.3, 65.1, 67.0,
      66.4, 67.8,
    ],
    grade: 'critical',
  },
  brand_color: '#ff6b35',
}

export const WEEKLY_KPI_DEFAULTS: WeeklyKpiRecapFormProps = {
  org: { name: 'The Corner Table', logo_url: null },
  week_start: '2026-05-19',
  kpis: {
    prime_cost: { value: '67.8%', delta_pct: 3.2, grade: 'critical' },
    labor: { value: '34.1%', delta_pct: -1.5, grade: 'warning' },
    sales: { value: '$48,300', delta_pct: 2.1, grade: 'good' },
    leak_count: { value: '10 leaks', delta_pct: 0.0, grade: 'warning' },
  },
  summary_line:
    'Prime cost still drifting — labor stabilizing. Three actions in your inbox.',
  brand_color: '#ff6b35',
}

export const OUTREACH_HOOK_DEFAULTS: OutreachHookFormProps = {
  prospect: { name: 'Acropolis Greek Taverna', logo_url: null },
  pain_point: 'prime cost',
  evidence_line: 'Your prime cost runs 4.2pts above peer-group median.',
  brand_color: '#ff6b35',
}

// ── Load-defaults button (shared header for every typed form) ──────────────

export function FormHeaderRow({
  onLoadDefaults,
  disabled,
}: {
  onLoadDefaults: () => void
  disabled: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginBottom: 4,
      }}
    >
      <button
        type="button"
        onClick={disabled ? undefined : onLoadDefaults}
        disabled={disabled}
        aria-label="Load Corner Table defaults"
        style={{
          minHeight: 30,
          padding: '0 12px',
          borderRadius: 8,
          border: '1px solid var(--vh-glass-border-bright)',
          background: 'transparent',
          color: 'var(--vh-text-muted)',
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
        }}
      >
        Load defaults
      </button>
    </div>
  )
}
