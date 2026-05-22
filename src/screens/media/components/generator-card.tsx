// GeneratorCard — selectable generator profile card.

import type { CSSProperties } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AiImageIcon,
  AiMagicIcon,
  AiVideoIcon,
  MachineRobotIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type {
  GeneratorProfile,
  GeneratorProfileId,
} from '@/server/wan2gp-adapter'

export function GeneratorCard({
  profile,
  selected,
  onSelect,
}: {
  profile: GeneratorProfile
  selected: boolean
  onSelect: (id: GeneratorProfileId) => void
}) {
  const available = profile.available
  const icon =
    profile.vendor === 'wan2gp'
      ? profile.kind === 'video'
        ? AiVideoIcon
        : AiImageIcon
      : profile.vendor === 'comfyui'
        ? MachineRobotIcon
        : AiMagicIcon
  const color = available ? 'cyan' : 'amber'

  const baseStyle: CSSProperties = {
    borderColor: selected
      ? 'var(--mc-cyan)'
      : available
        ? 'var(--mc-border)'
        : 'rgba(255,181,71,0.18)',
    boxShadow: selected ? '0 0 24px -10px var(--mc-cyan)' : undefined,
    backgroundColor: available ? 'var(--mc-surface)' : 'rgba(13,19,29,0.5)',
    opacity: available ? 1 : 0.62,
    cursor: available ? 'pointer' : 'not-allowed',
  }

  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => available && onSelect(profile.id)}
      className={cn(
        'group relative flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition',
        available && 'hover:border-[var(--mc-border-bright)]',
      )}
      style={baseStyle}
      aria-pressed={selected}
      aria-label={`${profile.label}${available ? '' : ' (coming soon)'}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
          style={{
            borderColor: `var(--mc-${color})`,
            background: `var(--mc-${color}-soft)`,
          }}
        >
          <HugeiconsIcon
            icon={icon}
            size={16}
            style={{ color: `var(--mc-${color})` }}
          />
        </span>
        <div className="leading-tight">
          <div className="font-mono text-[13px] font-semibold text-[var(--mc-text)]">
            {profile.label}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mc-text-dimmer)]">
            {profile.kind} · {profile.vendor}
          </div>
        </div>
        {!available && (
          <span
            className="ml-auto rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{
              borderColor: 'var(--mc-amber)',
              color: 'var(--mc-amber)',
            }}
          >
            [coming soon]
          </span>
        )}
        {available && selected && (
          <span
            className="ml-auto rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{
              borderColor: 'var(--mc-cyan)',
              color: 'var(--mc-cyan)',
            }}
          >
            selected
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-[var(--mc-text-dim)]">
        {profile.description}
      </p>
      {!available && (
        <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--mc-amber)]">
          [plugin not loaded] · TODO: wire adapter
        </div>
      )}
    </button>
  )
}
