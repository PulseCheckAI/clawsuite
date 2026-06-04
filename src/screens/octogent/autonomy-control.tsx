/**
 * AutonomyControl — segmented 3-state toggle for setting an agent's autonomy
 * mode (off / approval / auto). Animated indicator slides between segments
 * via motion's layoutId, color-tinted by selected mode. Includes per-agent
 * compact + per-agent wide + master-switch + dot-indicator variants.
 */
import { motion } from 'motion/react'
import {
  type AutonomyMode,
  AUTONOMY_LABEL,
  useAgentAutonomy,
  useGlobalAutonomy,
} from '@/hooks/use-agent-autonomy'

const MODE_COLOR: Record<AutonomyMode, string> = {
  off: 'var(--theme-muted-2)',
  approval: 'var(--theme-warning)',
  auto: 'var(--theme-success)',
}

const MODE_GLYPH: Record<AutonomyMode, string> = {
  off: '◌',
  approval: '◐',
  auto: '●',
}

type Variant = 'compact' | 'wide'

function AutonomyButton({
  mode,
  selected,
  onClick,
  variant,
  groupId,
}: {
  mode: AutonomyMode
  selected: boolean
  onClick: () => void
  variant: Variant
  groupId: string
}) {
  const px = variant === 'wide' ? 'px-3 py-1.5' : 'px-2 py-0.5'
  const fz = variant === 'wide' ? 'text-xs' : 'text-[10px]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={AUTONOMY_LABEL[mode]}
      className={`relative ${px} ${fz} font-medium uppercase tracking-wider transition-colors`}
      style={{
        color: selected ? 'var(--theme-text)' : 'var(--theme-muted-2)',
      }}
    >
      {selected && (
        <motion.span
          layoutId={`autonomy-${groupId}`}
          className="absolute inset-0 rounded-full"
          style={{
            background: `color-mix(in srgb, ${MODE_COLOR[mode]} 22%, transparent)`,
            border: `1px solid ${MODE_COLOR[mode]}`,
          }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        />
      )}
      <span className="relative inline-flex items-center gap-1">
        <span style={{ color: MODE_COLOR[mode] }}>{MODE_GLYPH[mode]}</span>
        <span>{AUTONOMY_LABEL[mode]}</span>
      </span>
    </button>
  )
}

export function AutonomyControl({
  agentId,
  variant = 'compact',
}: {
  agentId: string
  variant?: Variant
}) {
  const { mode, setMode } = useAgentAutonomy(agentId)
  const groupId = `agent-${agentId}`
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border p-0.5"
      style={{
        background: 'color-mix(in srgb, var(--theme-card) 92%, transparent)',
        borderColor: 'var(--theme-border)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <AutonomyButton
        mode="off"
        selected={mode === 'off'}
        onClick={() => setMode('off')}
        variant={variant}
        groupId={groupId}
      />
      <AutonomyButton
        mode="approval"
        selected={mode === 'approval'}
        onClick={() => setMode('approval')}
        variant={variant}
        groupId={groupId}
      />
      <AutonomyButton
        mode="auto"
        selected={mode === 'auto'}
        onClick={() => setMode('auto')}
        variant={variant}
        groupId={groupId}
      />
    </div>
  )
}

export function MasterAutonomyControl() {
  const { mode, setMode } = useGlobalAutonomy()
  const groupId = 'global-default'
  return (
    <div className="flex flex-col gap-1">
      <div
        className="text-[10px] uppercase tracking-[0.18em]"
        style={{ color: 'var(--theme-muted-2)' }}
      >
        Master autonomy (default for all)
      </div>
      <div
        className="inline-flex w-fit items-center gap-0.5 rounded-full border p-0.5"
        style={{
          background: 'color-mix(in srgb, var(--theme-card) 92%, transparent)',
          borderColor: 'var(--theme-border2)',
        }}
      >
        <AutonomyButton
          mode="off"
          selected={mode === 'off'}
          onClick={() => setMode('off')}
          variant="wide"
          groupId={groupId}
        />
        <AutonomyButton
          mode="approval"
          selected={mode === 'approval'}
          onClick={() => setMode('approval')}
          variant="wide"
          groupId={groupId}
        />
        <AutonomyButton
          mode="auto"
          selected={mode === 'auto'}
          onClick={() => setMode('auto')}
          variant="wide"
          groupId={groupId}
        />
      </div>
    </div>
  )
}

/** Compact ring indicator for use on cards where a full 3-state toggle
 * doesn't fit. Color encodes the effective mode; halo on auto. */
export function AutonomyDot({ agentId }: { agentId: string }) {
  const { effective, isOverride } = useAgentAutonomy(agentId)
  return (
    <span
      title={
        isOverride
          ? `${AUTONOMY_LABEL[effective]} (override)`
          : `${AUTONOMY_LABEL[effective]} (default)`
      }
      className="inline-flex size-3 items-center justify-center rounded-full"
      style={{
        background: `color-mix(in srgb, ${MODE_COLOR[effective]} 32%, transparent)`,
        border: `1px solid ${MODE_COLOR[effective]}`,
        boxShadow:
          effective === 'auto' ? `0 0 6px ${MODE_COLOR[effective]}` : undefined,
      }}
    />
  )
}
