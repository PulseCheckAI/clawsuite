// QueueRow — a single live row in the active job queue.

import { HugeiconsIcon } from '@hugeicons/react'
import { StopCircleIcon } from '@hugeicons/core-free-icons'
import { Pulse, statusColor } from './pulse'
import type { QueueEntry } from '../types'

export function QueueRow({
  entry,
  onCancel,
}: {
  entry: QueueEntry
  onCancel: (jobId: string) => void
}) {
  const color = statusColor(entry.status)
  const active = entry.status === 'running' || entry.status === 'queued'
  const progressPct = Math.max(
    0,
    Math.min(100, entry.progress ?? (entry.status === 'queued' ? 5 : 0)),
  )
  return (
    <div
      className="relative rounded-lg border bg-[var(--mc-surface)] px-3 py-2.5"
      style={{
        borderColor: active ? `var(--mc-${color})` : 'var(--mc-border)',
        boxShadow: active ? `0 0 18px -10px var(--mc-${color})` : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <Pulse active={active} color={color} />
        <span
          className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: `var(--mc-${color})` }}
        >
          {entry.status}
        </span>
        <span className="font-mono text-[10px] text-[var(--mc-text-dimmer)]">
          {entry.kind} · {entry.effectiveResolution} → {entry.targetWidth}×
          {entry.targetHeight}
        </span>
        {entry.phase && (
          <span className="font-mono text-[10px] text-[var(--mc-text-dim)]">
            · {entry.phase}
          </span>
        )}
        {active && (
          <button
            type="button"
            onClick={() => onCancel(entry.jobId)}
            className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--mc-rose)]/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--mc-rose)] hover:bg-[var(--mc-rose-soft)]"
            aria-label="Cancel generation"
          >
            <HugeiconsIcon icon={StopCircleIcon} size={11} />
            cancel
          </button>
        )}
      </div>
      <div className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-[var(--mc-text)]">
        {entry.prompt}
      </div>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--mc-surface-2)' }}
      >
        <div
          className="h-full transition-all duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${progressPct}%`,
            background: `var(--mc-${color})`,
            boxShadow: active ? `0 0 8px var(--mc-${color})` : undefined,
          }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-[var(--mc-text-dimmer)]">
        <span className="truncate">job {entry.jobId.slice(0, 8)}</span>
        <span>
          {entry.progress != null
            ? `${Math.round(entry.progress)}%`
            : entry.status === 'queued'
              ? 'waiting…'
              : ''}
        </span>
      </div>
      {entry.error && (
        <div className="mt-1.5 rounded border border-[var(--mc-rose)]/40 bg-[var(--mc-rose-soft)] px-2 py-1 font-mono text-[10px] text-[var(--mc-rose)]">
          {entry.error}
        </div>
      )}
    </div>
  )
}
