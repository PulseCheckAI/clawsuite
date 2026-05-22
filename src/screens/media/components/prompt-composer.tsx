// PromptComposer — multiline prompt input with resolution + FPS controls.

import { useRef } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Rocket01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Pulse } from './pulse'

export function PromptComposer({
  prompt,
  setPrompt,
  width,
  height,
  fps,
  setWidth,
  setHeight,
  setFps,
  kind,
  onSubmit,
  isSubmitting,
  canSubmit,
}: {
  prompt: string
  setPrompt: (v: string) => void
  width: number
  height: number
  fps: number
  setWidth: (n: number) => void
  setHeight: (n: number) => void
  setFps: (n: number) => void
  kind: 'image' | 'video'
  onSubmit: () => void
  isSubmitting: boolean
  canSubmit: boolean
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div
      className="overflow-hidden rounded-2xl border border-[var(--mc-border-bright)] bg-[var(--mc-surface)]"
      style={{ boxShadow: '0 0 80px -30px var(--mc-cyan)' }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--mc-border)] px-4 py-2.5">
        <Pulse active={false} color="cyan" />
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--mc-text-dimmer)]">
          PROMPT · stdin · {kind === 'video' ? 'T2V' : 'T2I'}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--mc-text-dimmer)]">
          {prompt.length} chars
        </span>
      </div>
      <textarea
        ref={taRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
            e.preventDefault()
            onSubmit()
          }
        }}
        rows={4}
        placeholder={
          kind === 'video'
            ? '> A 2-second clip of steam rising off a brisket on a stainless prep counter…'
            : '> A high-contrast hero shot of an empty restaurant pass at dawn, anamorphic…'
        }
        className="block w-full resize-none bg-transparent px-4 py-3 font-mono text-[15px] leading-relaxed text-[var(--mc-text)] placeholder:text-[var(--mc-text-dimmer)] focus:outline-none"
        spellCheck={false}
      />
      <div className="grid gap-3 border-t border-[var(--mc-border)] bg-[var(--mc-surface-2)] px-4 py-3 sm:grid-cols-3">
        <NumberField
          label="WIDTH"
          value={width}
          onChange={setWidth}
          min={64}
          max={7680}
          step={64}
        />
        <NumberField
          label="HEIGHT"
          value={height}
          onChange={setHeight}
          min={64}
          max={4320}
          step={64}
        />
        {kind === 'video' ? (
          <NumberField
            label="FPS"
            value={fps}
            onChange={setFps}
            min={1}
            max={60}
            step={1}
          />
        ) : (
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mc-text-dimmer)]">
            <div>target</div>
            <div className="mt-1 text-[var(--mc-text-dim)] normal-case tracking-normal text-[12px]">
              {width}×{height}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--mc-border)] bg-[var(--mc-surface)] px-4 py-2.5">
        <span className="font-mono text-[11px] text-[var(--mc-text-dimmer)]">
          defaults · 4K UHD ({width}×{height}
          {kind === 'video' ? ` @ ${fps}fps` : ''})
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition',
            canSubmit
              ? 'text-[#0A0D14] hover:brightness-110'
              : 'cursor-not-allowed bg-[var(--mc-surface-2)] text-[var(--mc-text-dimmer)]',
          )}
          style={
            canSubmit
              ? {
                  backgroundColor: 'var(--mc-cyan)',
                  boxShadow: '0 0 24px -6px var(--mc-cyan)',
                }
              : undefined
          }
        >
          <HugeiconsIcon icon={Rocket01Icon} size={14} />
          {isSubmitting ? 'SUBMITTING…' : 'GENERATE'}
          <span className="ml-2 hidden rounded border border-current/40 px-1.5 py-0.5 text-[9px] opacity-70 md:inline">
            ⌘ ↵
          </span>
        </button>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mc-text-dimmer)]">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const next = parseInt(e.target.value, 10)
          if (Number.isFinite(next)) {
            onChange(Math.max(min, Math.min(max, next)))
          }
        }}
        className="rounded-md border border-[var(--mc-border)] bg-[var(--mc-bg)] px-2 py-1.5 font-mono text-[12px] tabular-nums text-[var(--mc-text)] focus:border-[var(--mc-border-bright)] focus:outline-none"
      />
    </label>
  )
}
