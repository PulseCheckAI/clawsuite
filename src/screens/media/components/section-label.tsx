// SectionLabel — small section heading with leading icon.

import { HugeiconsIcon } from '@hugeicons/react'
import { Activity01Icon } from '@hugeicons/core-free-icons'

export function SectionLabel({
  icon,
  label,
  sub,
}: {
  icon: typeof Activity01Icon
  label: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--mc-border)] pb-2">
      <HugeiconsIcon
        icon={icon}
        size={14}
        style={{ color: 'var(--mc-cyan)' }}
      />
      <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--mc-text)]">
        {label}
      </span>
      {sub ? (
        <span className="ml-2 font-mono text-[10px] text-[var(--mc-text-dimmer)]">
          {sub}
        </span>
      ) : null}
    </div>
  )
}
