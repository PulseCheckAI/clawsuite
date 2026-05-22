// StudioStatusBar — sticky header with phase indicator and metric chips.

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Activity01Icon,
  AiMagicIcon,
  Alert02Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { Pulse } from './pulse'
import type { AccentColor } from '../tokens'

export function StudioStatusBar({
  activeCount,
  doneCount,
  failedCount,
  onClearHistory,
}: {
  activeCount: number
  doneCount: number
  failedCount: number
  onClearHistory: () => void
}) {
  const phase = activeCount > 0 ? 'GENERATING' : 'STANDBY'
  const phaseColor: AccentColor = activeCount > 0 ? 'cyan' : 'emerald'

  return (
    <div className="sticky top-0 z-30 border-b border-[var(--mc-border)] bg-[var(--mc-bg)]/85 backdrop-blur-md">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <div
            className="relative flex h-9 w-9 items-center justify-center rounded-md border border-[var(--mc-border-bright)]"
            style={{
              backgroundColor: 'var(--mc-cyan-soft)',
              boxShadow: '0 0 24px -8px var(--mc-cyan)',
            }}
          >
            <HugeiconsIcon
              icon={AiMagicIcon}
              size={18}
              style={{ color: 'var(--mc-cyan)' }}
            />
          </div>
          <div className="leading-tight">
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mc-text-dimmer)]">
              MEDIA STUDIO · WAN2GP
            </div>
            <div className="flex items-center gap-2 font-mono text-sm text-[var(--mc-text)]">
              <Pulse active={activeCount > 0} color={phaseColor} />
              <span
                className="font-semibold tracking-wider"
                style={{ color: `var(--mc-${phaseColor})` }}
              >
                {phase}
              </span>
              <span className="ml-2 text-[var(--mc-text-dim)]">
                4K · image + video
              </span>
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3 font-mono text-xs">
          <MetricChip
            icon={Activity01Icon}
            label="ACTIVE"
            value={activeCount}
            color="cyan"
          />
          <MetricChip
            icon={CheckmarkCircle02Icon}
            label="DONE"
            value={doneCount}
            color="emerald"
          />
          <MetricChip
            icon={Alert02Icon}
            label="FAILED"
            value={failedCount}
            color="rose"
          />
          {doneCount + failedCount > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--mc-border)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--mc-text-dim)] hover:border-[var(--mc-border-bright)] hover:text-[var(--mc-text)]"
            >
              <HugeiconsIcon icon={RefreshIcon} size={12} />
              clear history
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MetricChip({
  icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity01Icon
  label: string
  value: React.ReactNode
  color: AccentColor
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-[var(--mc-border)] bg-[var(--mc-surface)] px-2.5 py-1.5">
      <HugeiconsIcon
        icon={icon}
        size={13}
        style={{ color: `var(--mc-${color})` }}
      />
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--mc-text-dimmer)]">
        {label}
      </span>
      <span className="tabular-nums" style={{ color: `var(--mc-${color})` }}>
        {value}
      </span>
    </div>
  )
}
