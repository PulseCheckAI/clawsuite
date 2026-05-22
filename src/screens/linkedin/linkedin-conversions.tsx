// LinkedIn Conversions API panel — payload builder UI.
//
// Mirrors LinkedIn's official Conversions API payload builder. Submits to
// POST /api/linkedin/conversions which validates + forwards to
// https://api.linkedin.com/rest/conversionEvents.
//
// Hashing note: the user is responsible for providing SHA-256-hashed
// idValues for SHA256_EMAIL idType. This panel does NOT hash on the
// client — if you need hashing, do it before pasting (e.g. via
// `echo -n "email@example.com" | shasum -a 256`).

import { useState } from 'react'
import { Delete02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

const ID_TYPES = [
  'SHA256_EMAIL',
  'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID',
  'ACXIOM_ID',
  'ORACLE_MOAT_ID',
] as const

type IdType = (typeof ID_TYPES)[number]

interface UserIdRow {
  id: string
  idValue: string
  idType: IdType
}

let rowCounter = 0
function nextRowId(): string {
  rowCounter += 1
  return `r${rowCounter}`
}

function FieldLabel({
  label,
  required,
}: {
  label: string
  required?: boolean
}) {
  return (
    <label
      className="font-mono text-[10px] uppercase tracking-[0.22em]"
      style={{ color: 'var(--mc-text-dimmer)' }}
    >
      {label}
      {required ? (
        <span style={{ color: 'var(--mc-rose)' }} className="ml-1">
          *
        </span>
      ) : null}
    </label>
  )
}

function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & { fontMono?: boolean },
) {
  const { fontMono, className, ...rest } = props
  return (
    <input
      {...rest}
      className={`rounded-md border px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
        fontMono ? 'font-mono' : ''
      } ${className ?? ''}`}
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-bg)',
        color: 'var(--mc-text)',
        ['--tw-ring-color' as string]: 'var(--mc-cyan)',
        ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
      }}
    />
  )
}

export function LinkedInConversions() {
  const [conversionUrn, setConversionUrn] = useState(
    'urn:lla:llaPartnerConversion:',
  )
  const [happenedAt, setHappenedAt] = useState<number>(() => Date.now())
  const [userIds, setUserIds] = useState<UserIdRow[]>(() => [
    { id: nextRowId(), idValue: '', idType: 'SHA256_EMAIL' },
  ])
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [amount, setAmount] = useState('')
  const [eventId, setEventId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    text: string
  } | null>(null)

  function addRow() {
    setUserIds((prev) => [
      ...prev,
      { id: nextRowId(), idValue: '', idType: 'SHA256_EMAIL' },
    ])
  }
  function removeRow(id: string) {
    setUserIds((prev) =>
      prev.length <= 1 ? prev : prev.filter((r) => r.id !== id),
    )
  }
  function updateRow(id: string, patch: Partial<UserIdRow>) {
    setUserIds((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    )
  }

  async function submit() {
    setResult(null)
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        conversion: conversionUrn.trim(),
        conversionHappenedAt: happenedAt,
        user: {
          userIds: userIds
            .filter((r) => r.idValue.trim().length > 0)
            .map((r) => ({ idValue: r.idValue.trim(), idType: r.idType })),
        },
      }
      if (amount.trim().length > 0 && currencyCode.trim().length > 0) {
        payload.conversionValue = {
          currencyCode: currencyCode.trim().toUpperCase(),
          amount: amount.trim(),
        }
      }
      if (eventId.trim().length > 0) payload.eventId = eventId.trim()

      const res = await fetch('/api/linkedin/conversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      setResult({
        ok: res.ok && body.ok === true,
        text: JSON.stringify(body, null, 2),
      })
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const isValidUrn = /^urn:lla:llaPartnerConversion:[A-Za-z0-9_-]+$/.test(
    conversionUrn.trim(),
  )
  const hasUserIds = userIds.some((r) => r.idValue.trim().length > 0)
  const canSubmit = isValidUrn && hasUserIds && !submitting

  return (
    <div className="space-y-4">
      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: 'var(--mc-border)',
          background: 'var(--mc-surface)',
        }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: 'var(--mc-text-dimmer)' }}
        >
          Conversion event · POST /rest/conversionEvents
        </p>
        <p className="mt-2 text-[12px]" style={{ color: 'var(--mc-text-dim)' }}>
          Build a single conversion event payload and submit to LinkedIn's
          Conversions API. The forwarder validates URN format, idType enums, and
          idValue presence before sending.{' '}
          <span style={{ color: 'var(--mc-amber)' }}>
            Email idValues must be SHA-256 hashed BEFORE pasting.
          </span>
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <FieldLabel label="Conversion URN" required />
            <Input
              fontMono
              value={conversionUrn}
              onChange={(e) => setConversionUrn(e.target.value)}
              placeholder="urn:lla:llaPartnerConversion:24707929"
            />
            {!isValidUrn && conversionUrn.length > 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--mc-rose)' }}>
                Must match urn:lla:llaPartnerConversion:&lt;id&gt;
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel label="conversionHappenedAt (epoch ms)" required />
            <Input
              fontMono
              type="number"
              value={happenedAt}
              onChange={(e) => setHappenedAt(Number(e.target.value))}
            />
            <button
              type="button"
              onClick={() => setHappenedAt(Date.now())}
              className="self-start font-mono text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--mc-cyan)' }}
            >
              Use now
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel label="eventId (optional, dedup)" />
            <Input
              fontMono
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              placeholder=""
            />
          </div>
        </div>
      </section>

      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: 'var(--mc-border)',
          background: 'var(--mc-surface)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--mc-text-dimmer)' }}
          >
            User identifiers · at least one row{' '}
            <span style={{ color: 'var(--mc-rose)' }}>*</span>
          </p>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-surface-2)',
              color: 'var(--mc-cyan)',
              ['--tw-ring-color' as string]: 'var(--mc-cyan)',
              ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={10} strokeWidth={2} />
            Add row
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {userIds.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[1fr_220px_auto] items-center gap-2"
            >
              <Input
                fontMono
                value={row.idValue}
                onChange={(e) => updateRow(row.id, { idValue: e.target.value })}
                placeholder="idValue (hashed)"
              />
              <select
                value={row.idType}
                onChange={(e) =>
                  updateRow(row.id, { idType: e.target.value as IdType })
                }
                className="rounded-md border px-3 py-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  borderColor: 'var(--mc-border)',
                  background: 'var(--mc-bg)',
                  color: 'var(--mc-text)',
                  ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                  ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
                }}
              >
                {ID_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={userIds.length <= 1}
                aria-label="Remove row"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40"
                style={{
                  borderColor: 'var(--mc-border)',
                  background: 'var(--mc-surface-2)',
                  color: 'var(--mc-rose)',
                  ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                  ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
                }}
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  size={14}
                  strokeWidth={1.8}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: 'var(--mc-border)',
          background: 'var(--mc-surface)',
        }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: 'var(--mc-text-dimmer)' }}
        >
          Conversion value (optional)
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel label="currencyCode (ISO-4217)" />
            <Input
              fontMono
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
              placeholder="USD"
              maxLength={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel label="amount (string)" />
            <Input
              fontMono
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50.0"
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md border px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40"
          style={{
            borderColor: canSubmit ? 'var(--mc-cyan)' : 'var(--mc-border)',
            background: canSubmit ? 'var(--mc-cyan)' : 'var(--mc-surface-2)',
            color: canSubmit ? 'var(--mc-bg)' : 'var(--mc-text-dim)',
            ['--tw-ring-color' as string]: 'var(--mc-cyan)',
            ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit conversion'}
        </button>
        {!isValidUrn ? (
          <span className="text-[11px]" style={{ color: 'var(--mc-rose)' }}>
            URN must be filled before submit.
          </span>
        ) : !hasUserIds ? (
          <span className="text-[11px]" style={{ color: 'var(--mc-rose)' }}>
            At least one userId required.
          </span>
        ) : null}
      </div>

      {result ? (
        <section
          className="rounded-lg border p-4"
          style={{
            borderColor: result.ok ? 'var(--mc-emerald)' : 'var(--mc-rose)',
            background: result.ok
              ? 'var(--mc-emerald-soft)'
              : 'var(--mc-rose-soft)',
          }}
        >
          <p
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{
              color: result.ok ? 'var(--mc-emerald)' : 'var(--mc-rose)',
            }}
          >
            {result.ok ? 'Submitted' : 'Failed'}
          </p>
          <pre
            className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border px-3 py-2 font-mono text-[11px]"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-bg)',
              color: 'var(--mc-text-dim)',
            }}
          >
            {result.text}
          </pre>
        </section>
      ) : null}
    </div>
  )
}
