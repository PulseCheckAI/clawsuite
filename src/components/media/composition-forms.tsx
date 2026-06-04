// ── composition-forms ───────────────────────────────────────────────────────
// Three typed render forms (MarginLeakRecap, WeeklyKpiRecap, OutreachHook).
// Co-located in one file because they share the same form-state shape
// pattern and re-use ~all primitives from ./composition-form-shared. Lives
// in src/components/media/ so the route file (media.walkthroughs.tsx) stays
// focused on layout + the sheet plumbing.
//
// Each form:
//   * Holds local state in a single useState (form-fields-as-strings, parse
//     on submit so half-typed numbers don't explode).
//   * Validates client-side with plain TS predicates that mirror the zod
//     constraints in os/remotion-studio/src/types/props.ts. The render
//     server revalidates with zod server-side (the SSOT); this is operator-
//     feedback only.
//   * Renders a hidden <button type="submit"> so Enter-to-submit works; the
//     parent sheet drives the visible action bar via a ref + requestSubmit().
//   * Calls onSubmit(payload) with the typed shape after validation passes.
//
// Why typed forms over the prior single JSON textarea: operators get
// per-field validation, no "I had a typo in the JSON" surprises, and the
// renderer's prop shape is documented in the UI itself.
// ────────────────────────────────────────────────────────────────────────────

import { type RefObject, useCallback, useMemo, useState } from 'react'
import {
  BRAND_COLOR_RE,
  type CompositionGrade,
  type FieldErrors,
  FormFieldShell,
  FormHeaderRow,
  GradeRadioGroup,
  ISO_DATE_RE,
  MARGIN_LEAK_DEFAULTS,
  type MarginLeakRecapFormProps,
  OUTREACH_HOOK_DEFAULTS,
  type OutreachHookFormProps,
  WEEKLY_KPI_DEFAULTS,
  type WeeklyKpiRecapFormProps,
  fieldsetLegendStyle,
  fieldsetStyle,
  formInputStyle,
  formTextareaStyle,
  formatCentsAsDollars,
  isNonEmptyString,
  isOptionalUrl,
  parseNumberList,
  trimOptionalUrl,
} from './composition-form-shared'

// ──────────────────────────────────────────────────────────────────────────
//   1. MarginLeakRecapForm
// ──────────────────────────────────────────────────────────────────────────

interface MLState {
  orgName: string
  orgLogoUrl: string
  leakTitle: string
  leakRecoverableCents: string
  leakTrendPointsRaw: string
  leakGrade: CompositionGrade
  brandColor: string
}

type MLField =
  | 'orgName'
  | 'orgLogoUrl'
  | 'leakTitle'
  | 'leakRecoverableCents'
  | 'leakTrendPointsRaw'
  | 'brandColor'

function mlDefaultsToForm(d: MarginLeakRecapFormProps): MLState {
  return {
    orgName: d.org.name,
    orgLogoUrl: d.org.logo_url ?? '',
    leakTitle: d.leak.title,
    leakRecoverableCents: String(d.leak.recoverable_cents),
    leakTrendPointsRaw: d.leak.trend_points.join(', '),
    leakGrade: d.leak.grade,
    brandColor: d.brand_color,
  }
}

function mlValidate(state: MLState): {
  errors: FieldErrors<MLField>
  payload: MarginLeakRecapFormProps | null
} {
  const errors: FieldErrors<MLField> = {}
  if (!isNonEmptyString(state.orgName)) errors.orgName = 'Org name is required'
  if (!isOptionalUrl(state.orgLogoUrl))
    errors.orgLogoUrl = 'Logo URL must be a valid http(s) URL'
  if (!isNonEmptyString(state.leakTitle))
    errors.leakTitle = 'Leak title is required'

  const centsNum = Number(state.leakRecoverableCents)
  if (
    !Number.isFinite(centsNum) ||
    !Number.isInteger(centsNum) ||
    centsNum < 0
  ) {
    errors.leakRecoverableCents = 'Must be a non-negative integer (cents)'
  }

  const trend = parseNumberList(state.leakTrendPointsRaw)
  if (trend === null) {
    errors.leakTrendPointsRaw =
      'Comma-separated numbers only (e.g. 62.1, 61.4, 63.2)'
  } else if (trend.length < 2 || trend.length > 60) {
    errors.leakTrendPointsRaw = `Need 2-60 points (got ${trend.length})`
  }

  if (!BRAND_COLOR_RE.test(state.brandColor)) {
    errors.brandColor = 'Hex color in #RRGGBB form'
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null }

  const payload: MarginLeakRecapFormProps = {
    org: {
      name: state.orgName.trim(),
      logo_url: trimOptionalUrl(state.orgLogoUrl),
    },
    leak: {
      title: state.leakTitle.trim(),
      recoverable_cents: centsNum,
      trend_points: trend!,
      grade: state.leakGrade,
    },
    brand_color: state.brandColor,
  }
  return { errors, payload }
}

export function MarginLeakRecapForm({
  formRef,
  busy,
  onSubmit,
}: {
  formRef: RefObject<HTMLFormElement | null>
  busy: boolean
  onSubmit: (payload: MarginLeakRecapFormProps) => void | Promise<void>
}) {
  const [state, setState] = useState<MLState>(() =>
    mlDefaultsToForm(MARGIN_LEAK_DEFAULTS),
  )
  const [errors, setErrors] = useState<FieldErrors<MLField>>({})

  const set = useCallback(<K extends keyof MLState>(k: K, v: MLState[K]) => {
    setState((prev) => ({ ...prev, [k]: v }))
    setErrors((prev) => {
      if (!(k in prev)) return prev
      const next = { ...prev }
      delete next[k as unknown as MLField]
      return next
    })
  }, [])

  const handleLoadDefaults = useCallback(() => {
    setState(mlDefaultsToForm(MARGIN_LEAK_DEFAULTS))
    setErrors({})
  }, [])

  const centsHelp = useMemo(() => {
    const n = Number(state.leakRecoverableCents)
    if (!Number.isFinite(n) || n < 0) return '—'
    return formatCentsAsDollars(n)
  }, [state.leakRecoverableCents])

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        const result = mlValidate(state)
        setErrors(result.errors)
        if (result.payload) void onSubmit(result.payload)
      }}
      style={{ display: 'grid', gap: 12 }}
      aria-busy={busy}
    >
      <FormHeaderRow onLoadDefaults={handleLoadDefaults} disabled={busy} />

      <fieldset style={fieldsetStyle}>
        <legend style={fieldsetLegendStyle}>Organization</legend>
        <FormFieldShell
          label="Org name"
          htmlFor="mlr-org-name"
          error={errors.orgName}
        >
          <input
            id="mlr-org-name"
            type="text"
            value={state.orgName}
            onChange={(e) => set('orgName', e.target.value)}
            disabled={busy}
            style={formInputStyle}
            autoComplete="off"
          />
        </FormFieldShell>
        <FormFieldShell
          label="Logo URL (optional)"
          htmlFor="mlr-org-logo"
          hint="Leave blank to fall back to initials over a brand-color tile."
          error={errors.orgLogoUrl}
        >
          <input
            id="mlr-org-logo"
            type="url"
            value={state.orgLogoUrl}
            onChange={(e) => set('orgLogoUrl', e.target.value)}
            disabled={busy}
            placeholder="https://example.com/logo.png"
            style={formInputStyle}
            autoComplete="off"
          />
        </FormFieldShell>
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={fieldsetLegendStyle}>Leak</legend>
        <FormFieldShell
          label="Title"
          htmlFor="mlr-leak-title"
          error={errors.leakTitle}
        >
          <input
            id="mlr-leak-title"
            type="text"
            value={state.leakTitle}
            onChange={(e) => set('leakTitle', e.target.value)}
            disabled={busy}
            style={formInputStyle}
            autoComplete="off"
          />
        </FormFieldShell>

        <FormFieldShell
          label="Recoverable (cents)"
          htmlFor="mlr-leak-cents"
          hint={`Integer cents (BIGINT). Displayed as: ${centsHelp}`}
          error={errors.leakRecoverableCents}
        >
          <input
            id="mlr-leak-cents"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={state.leakRecoverableCents}
            onChange={(e) => set('leakRecoverableCents', e.target.value)}
            disabled={busy}
            style={formInputStyle}
          />
        </FormFieldShell>

        <FormFieldShell
          label="Trend points"
          htmlFor="mlr-leak-trend"
          hint="2-60 numbers, comma- or space-separated. Renderer normalizes; units don't matter, only shape."
          error={errors.leakTrendPointsRaw}
        >
          <textarea
            id="mlr-leak-trend"
            value={state.leakTrendPointsRaw}
            onChange={(e) => set('leakTrendPointsRaw', e.target.value)}
            disabled={busy}
            rows={3}
            spellCheck={false}
            style={{ ...formTextareaStyle, fontFamily: 'monospace' }}
          />
        </FormFieldShell>

        <FormFieldShell label="Grade" htmlFor="mlr-leak-grade">
          <GradeRadioGroup
            name="leak.grade"
            value={state.leakGrade}
            onChange={(g) => set('leakGrade', g)}
            disabled={busy}
          />
        </FormFieldShell>
      </fieldset>

      <FormFieldShell
        label="Brand color"
        htmlFor="mlr-brand-color"
        hint="Hex #RRGGBB. Defaults to PulseCheck orange."
        error={errors.brandColor}
      >
        <input
          id="mlr-brand-color"
          type="text"
          value={state.brandColor}
          onChange={(e) => set('brandColor', e.target.value)}
          disabled={busy}
          style={{ ...formInputStyle, fontFamily: 'monospace' }}
          autoComplete="off"
        />
      </FormFieldShell>

      <button type="submit" aria-hidden="true" style={{ display: 'none' }} />
    </form>
  )
}

// ──────────────────────────────────────────────────────────────────────────
//   2. WeeklyKpiRecapForm
// ──────────────────────────────────────────────────────────────────────────

type KpiSlot = 'prime_cost' | 'labor' | 'sales' | 'leak_count'

interface KpiSubState {
  value: string
  deltaPct: string
  grade: CompositionGrade
}

interface WKState {
  orgName: string
  orgLogoUrl: string
  weekStart: string
  kpis: Record<KpiSlot, KpiSubState>
  summaryLine: string
  brandColor: string
}

// Per-field error keys are flat (kpi-by-kpi) so the FormFieldShell error
// prop can target one fieldset row at a time.
type WKField =
  | 'orgName'
  | 'orgLogoUrl'
  | 'weekStart'
  | 'summaryLine'
  | 'brandColor'
  | `kpi.${KpiSlot}.value`
  | `kpi.${KpiSlot}.deltaPct`

const SUMMARY_LINE_MAX = 180
const KPI_SLOTS: ReadonlyArray<KpiSlot> = [
  'prime_cost',
  'labor',
  'sales',
  'leak_count',
]
const KPI_LABELS: Record<KpiSlot, string> = {
  prime_cost: 'Prime cost',
  labor: 'Labor',
  sales: 'Sales',
  leak_count: 'Leak count',
}

function wkDefaultsToForm(d: WeeklyKpiRecapFormProps): WKState {
  const kpis = {} as Record<KpiSlot, KpiSubState>
  for (const slot of KPI_SLOTS) {
    const k = d.kpis[slot]
    kpis[slot] = {
      value: k.value,
      deltaPct: String(k.delta_pct),
      grade: k.grade,
    }
  }
  return {
    orgName: d.org.name,
    orgLogoUrl: d.org.logo_url ?? '',
    weekStart: d.week_start,
    kpis,
    summaryLine: d.summary_line,
    brandColor: d.brand_color,
  }
}

function wkValidate(state: WKState): {
  errors: FieldErrors<WKField>
  payload: WeeklyKpiRecapFormProps | null
} {
  const errors: FieldErrors<WKField> = {}
  if (!isNonEmptyString(state.orgName)) errors.orgName = 'Org name is required'
  if (!isOptionalUrl(state.orgLogoUrl))
    errors.orgLogoUrl = 'Logo URL must be a valid http(s) URL'
  if (!ISO_DATE_RE.test(state.weekStart))
    errors.weekStart = 'Week start must be YYYY-MM-DD'

  const kpiPayload = {} as WeeklyKpiRecapFormProps['kpis']
  for (const slot of KPI_SLOTS) {
    const k = state.kpis[slot]
    if (!isNonEmptyString(k.value)) {
      errors[`kpi.${slot}.value` as WKField] = 'Value is required'
    }
    const deltaNum = Number(k.deltaPct)
    if (!Number.isFinite(deltaNum)) {
      errors[`kpi.${slot}.deltaPct` as WKField] = 'Must be a number'
    } else {
      kpiPayload[slot] = {
        value: k.value.trim(),
        delta_pct: deltaNum,
        grade: k.grade,
      }
    }
  }

  if (!isNonEmptyString(state.summaryLine)) {
    errors.summaryLine = 'Summary line is required'
  } else if (state.summaryLine.length > SUMMARY_LINE_MAX) {
    errors.summaryLine = `Max ${SUMMARY_LINE_MAX} chars (got ${state.summaryLine.length})`
  }

  if (!BRAND_COLOR_RE.test(state.brandColor)) {
    errors.brandColor = 'Hex color in #RRGGBB form'
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null }

  const payload: WeeklyKpiRecapFormProps = {
    org: {
      name: state.orgName.trim(),
      logo_url: trimOptionalUrl(state.orgLogoUrl),
    },
    week_start: state.weekStart,
    kpis: kpiPayload,
    summary_line: state.summaryLine.trim(),
    brand_color: state.brandColor,
  }
  return { errors, payload }
}

export function WeeklyKpiRecapForm({
  formRef,
  busy,
  onSubmit,
}: {
  formRef: RefObject<HTMLFormElement | null>
  busy: boolean
  onSubmit: (payload: WeeklyKpiRecapFormProps) => void | Promise<void>
}) {
  const [state, setState] = useState<WKState>(() =>
    wkDefaultsToForm(WEEKLY_KPI_DEFAULTS),
  )
  const [errors, setErrors] = useState<FieldErrors<WKField>>({})

  const setTop = useCallback(<K extends keyof WKState>(k: K, v: WKState[K]) => {
    setState((prev) => ({ ...prev, [k]: v }))
    setErrors((prev) => {
      if (!(k in prev)) return prev
      const next = { ...prev }
      delete next[k as unknown as WKField]
      return next
    })
  }, [])

  const setKpi = useCallback(
    <K extends keyof KpiSubState>(slot: KpiSlot, k: K, v: KpiSubState[K]) => {
      setState((prev) => ({
        ...prev,
        kpis: { ...prev.kpis, [slot]: { ...prev.kpis[slot], [k]: v } },
      }))
      const fieldKey =
        `kpi.${slot}.${k === 'deltaPct' ? 'deltaPct' : 'value'}` as WKField
      setErrors((prev) => {
        if (!(fieldKey in prev)) return prev
        const next = { ...prev }
        delete next[fieldKey]
        return next
      })
    },
    [],
  )

  const handleLoadDefaults = useCallback(() => {
    setState(wkDefaultsToForm(WEEKLY_KPI_DEFAULTS))
    setErrors({})
  }, [])

  const summaryCounter = `${state.summaryLine.length}/${SUMMARY_LINE_MAX}`

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        const result = wkValidate(state)
        setErrors(result.errors)
        if (result.payload) void onSubmit(result.payload)
      }}
      style={{ display: 'grid', gap: 12 }}
      aria-busy={busy}
    >
      <FormHeaderRow onLoadDefaults={handleLoadDefaults} disabled={busy} />

      <fieldset style={fieldsetStyle}>
        <legend style={fieldsetLegendStyle}>Organization</legend>
        <FormFieldShell
          label="Org name"
          htmlFor="wkr-org-name"
          error={errors.orgName}
        >
          <input
            id="wkr-org-name"
            type="text"
            value={state.orgName}
            onChange={(e) => setTop('orgName', e.target.value)}
            disabled={busy}
            style={formInputStyle}
            autoComplete="off"
          />
        </FormFieldShell>
        <FormFieldShell
          label="Logo URL (optional)"
          htmlFor="wkr-org-logo"
          hint="Leave blank to fall back to initials over a brand-color tile."
          error={errors.orgLogoUrl}
        >
          <input
            id="wkr-org-logo"
            type="url"
            value={state.orgLogoUrl}
            onChange={(e) => setTop('orgLogoUrl', e.target.value)}
            disabled={busy}
            placeholder="https://example.com/logo.png"
            style={formInputStyle}
            autoComplete="off"
          />
        </FormFieldShell>
      </fieldset>

      <FormFieldShell
        label="Week start"
        htmlFor="wkr-week-start"
        hint="ISO date (YYYY-MM-DD), usually the Monday of the week."
        error={errors.weekStart}
      >
        <input
          id="wkr-week-start"
          type="date"
          value={state.weekStart}
          onChange={(e) => setTop('weekStart', e.target.value)}
          disabled={busy}
          style={formInputStyle}
        />
      </FormFieldShell>

      {KPI_SLOTS.map((slot) => {
        const k = state.kpis[slot]
        const valueErr = errors[`kpi.${slot}.value` as WKField]
        const deltaErr = errors[`kpi.${slot}.deltaPct` as WKField]
        return (
          <fieldset key={slot} style={fieldsetStyle}>
            <legend style={fieldsetLegendStyle}>{KPI_LABELS[slot]}</legend>
            <FormFieldShell
              label="Value (display string)"
              htmlFor={`wkr-${slot}-value`}
              hint='Pre-formatted (e.g. "67.8%", "$48,300", "10 leaks"). Renderer does NOT re-derive.'
              error={valueErr}
            >
              <input
                id={`wkr-${slot}-value`}
                type="text"
                value={k.value}
                onChange={(e) => setKpi(slot, 'value', e.target.value)}
                disabled={busy}
                style={formInputStyle}
                autoComplete="off"
              />
            </FormFieldShell>
            <FormFieldShell
              label="Delta % (week over week)"
              htmlFor={`wkr-${slot}-delta`}
              hint="Signed percent points. e.g. -3.2 = down 3.2pts."
              error={deltaErr}
            >
              <input
                id={`wkr-${slot}-delta`}
                type="number"
                inputMode="decimal"
                step="0.1"
                value={k.deltaPct}
                onChange={(e) => setKpi(slot, 'deltaPct', e.target.value)}
                disabled={busy}
                style={formInputStyle}
              />
            </FormFieldShell>
            <FormFieldShell label="Grade" htmlFor={`wkr-${slot}-grade`}>
              <GradeRadioGroup
                name={`kpis.${slot}.grade`}
                value={k.grade}
                onChange={(g) => setKpi(slot, 'grade', g)}
                disabled={busy}
              />
            </FormFieldShell>
          </fieldset>
        )
      })}

      <FormFieldShell
        label="Summary line"
        htmlFor="wkr-summary"
        hint={`Closing one-liner. Max ${SUMMARY_LINE_MAX} chars.`}
        counter={summaryCounter}
        error={errors.summaryLine}
      >
        <textarea
          id="wkr-summary"
          value={state.summaryLine}
          onChange={(e) => setTop('summaryLine', e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={SUMMARY_LINE_MAX}
          style={formTextareaStyle}
        />
      </FormFieldShell>

      <FormFieldShell
        label="Brand color"
        htmlFor="wkr-brand-color"
        hint="Hex #RRGGBB. Defaults to PulseCheck orange."
        error={errors.brandColor}
      >
        <input
          id="wkr-brand-color"
          type="text"
          value={state.brandColor}
          onChange={(e) => setTop('brandColor', e.target.value)}
          disabled={busy}
          style={{ ...formInputStyle, fontFamily: 'monospace' }}
          autoComplete="off"
        />
      </FormFieldShell>

      <button type="submit" aria-hidden="true" style={{ display: 'none' }} />
    </form>
  )
}

// ──────────────────────────────────────────────────────────────────────────
//   3. OutreachHookForm
// ──────────────────────────────────────────────────────────────────────────

interface OHState {
  prospectName: string
  prospectLogoUrl: string
  painPoint: string
  evidenceLine: string
  brandColor: string
}

type OHField =
  | 'prospectName'
  | 'prospectLogoUrl'
  | 'painPoint'
  | 'evidenceLine'
  | 'brandColor'

const PAIN_POINT_MIN = 2
const PAIN_POINT_MAX = 60
const EVIDENCE_MIN = 8
const EVIDENCE_MAX = 180

function ohDefaultsToForm(d: OutreachHookFormProps): OHState {
  return {
    prospectName: d.prospect.name,
    prospectLogoUrl: d.prospect.logo_url ?? '',
    painPoint: d.pain_point,
    evidenceLine: d.evidence_line,
    brandColor: d.brand_color,
  }
}

function ohValidate(state: OHState): {
  errors: FieldErrors<OHField>
  payload: OutreachHookFormProps | null
} {
  const errors: FieldErrors<OHField> = {}
  if (!isNonEmptyString(state.prospectName))
    errors.prospectName = 'Prospect name is required'
  if (!isOptionalUrl(state.prospectLogoUrl))
    errors.prospectLogoUrl = 'Logo URL must be a valid http(s) URL'

  const painLen = state.painPoint.trim().length
  if (painLen < PAIN_POINT_MIN || painLen > PAIN_POINT_MAX) {
    errors.painPoint = `Pain point must be ${PAIN_POINT_MIN}-${PAIN_POINT_MAX} chars (got ${painLen})`
  }

  const evLen = state.evidenceLine.trim().length
  if (evLen < EVIDENCE_MIN || evLen > EVIDENCE_MAX) {
    errors.evidenceLine = `Evidence line must be ${EVIDENCE_MIN}-${EVIDENCE_MAX} chars (got ${evLen})`
  }

  if (!BRAND_COLOR_RE.test(state.brandColor)) {
    errors.brandColor = 'Hex color in #RRGGBB form'
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null }

  const payload: OutreachHookFormProps = {
    prospect: {
      name: state.prospectName.trim(),
      logo_url: trimOptionalUrl(state.prospectLogoUrl),
    },
    pain_point: state.painPoint.trim(),
    evidence_line: state.evidenceLine.trim(),
    brand_color: state.brandColor,
  }
  return { errors, payload }
}

export function OutreachHookForm({
  formRef,
  busy,
  onSubmit,
}: {
  formRef: RefObject<HTMLFormElement | null>
  busy: boolean
  onSubmit: (payload: OutreachHookFormProps) => void | Promise<void>
}) {
  const [state, setState] = useState<OHState>(() =>
    ohDefaultsToForm(OUTREACH_HOOK_DEFAULTS),
  )
  const [errors, setErrors] = useState<FieldErrors<OHField>>({})

  const set = useCallback(<K extends keyof OHState>(k: K, v: OHState[K]) => {
    setState((prev) => ({ ...prev, [k]: v }))
    setErrors((prev) => {
      if (!(k in prev)) return prev
      const next = { ...prev }
      delete next[k as unknown as OHField]
      return next
    })
  }, [])

  const handleLoadDefaults = useCallback(() => {
    setState(ohDefaultsToForm(OUTREACH_HOOK_DEFAULTS))
    setErrors({})
  }, [])

  const painCounter = `${state.painPoint.length}/${PAIN_POINT_MAX}`
  const evidenceCounter = `${state.evidenceLine.length}/${EVIDENCE_MAX}`

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        const result = ohValidate(state)
        setErrors(result.errors)
        if (result.payload) void onSubmit(result.payload)
      }}
      style={{ display: 'grid', gap: 12 }}
      aria-busy={busy}
    >
      <FormHeaderRow onLoadDefaults={handleLoadDefaults} disabled={busy} />

      <fieldset style={fieldsetStyle}>
        <legend style={fieldsetLegendStyle}>Prospect</legend>
        <FormFieldShell
          label="Prospect name"
          htmlFor="oh-prospect-name"
          error={errors.prospectName}
        >
          <input
            id="oh-prospect-name"
            type="text"
            value={state.prospectName}
            onChange={(e) => set('prospectName', e.target.value)}
            disabled={busy}
            style={formInputStyle}
            autoComplete="off"
          />
        </FormFieldShell>
        <FormFieldShell
          label="Logo URL (optional)"
          htmlFor="oh-prospect-logo"
          hint="Leave blank to fall back to initials over a brand-color tile."
          error={errors.prospectLogoUrl}
        >
          <input
            id="oh-prospect-logo"
            type="url"
            value={state.prospectLogoUrl}
            onChange={(e) => set('prospectLogoUrl', e.target.value)}
            disabled={busy}
            placeholder="https://example.com/logo.png"
            style={formInputStyle}
            autoComplete="off"
          />
        </FormFieldShell>
      </fieldset>

      <FormFieldShell
        label="Pain point"
        htmlFor="oh-pain"
        hint={`Short topic, e.g. "prime cost", "labor variance". ${PAIN_POINT_MIN}-${PAIN_POINT_MAX} chars.`}
        counter={painCounter}
        error={errors.painPoint}
      >
        <input
          id="oh-pain"
          type="text"
          value={state.painPoint}
          onChange={(e) => set('painPoint', e.target.value)}
          disabled={busy}
          maxLength={PAIN_POINT_MAX}
          style={formInputStyle}
          autoComplete="off"
        />
      </FormFieldShell>

      <FormFieldShell
        label="Evidence line"
        htmlFor="oh-evidence"
        hint={`One-line evidence (typically a peer-benchmark gap). ${EVIDENCE_MIN}-${EVIDENCE_MAX} chars.`}
        counter={evidenceCounter}
        error={errors.evidenceLine}
      >
        <textarea
          id="oh-evidence"
          value={state.evidenceLine}
          onChange={(e) => set('evidenceLine', e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={EVIDENCE_MAX}
          style={formTextareaStyle}
        />
      </FormFieldShell>

      <FormFieldShell
        label="Brand color"
        htmlFor="oh-brand-color"
        hint="Hex #RRGGBB. Defaults to PulseCheck orange."
        error={errors.brandColor}
      >
        <input
          id="oh-brand-color"
          type="text"
          value={state.brandColor}
          onChange={(e) => set('brandColor', e.target.value)}
          disabled={busy}
          style={{ ...formInputStyle, fontFamily: 'monospace' }}
          autoComplete="off"
        />
      </FormFieldShell>

      <button type="submit" aria-hidden="true" style={{ display: 'none' }} />
    </form>
  )
}

// Re-export the shared types so the parent route only needs one import.
export type {
  MarginLeakRecapFormProps,
  WeeklyKpiRecapFormProps,
  OutreachHookFormProps,
}
