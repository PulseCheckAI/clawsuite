// SkillsRail — chip rail for selecting active skills.

import { cn } from '@/lib/utils'
import type { SkillDef } from '@/server/wan2gp-adapter'

export function SkillsRail({
  skills,
  activeIds,
  onToggle,
}: {
  skills: SkillDef[]
  activeIds: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {skills.map((s) => {
        const active = activeIds.has(s.id)
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            title={s.description}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition',
              active
                ? 'text-[#0A0D14]'
                : 'text-[var(--mc-text-dim)] hover:text-[var(--mc-text)]',
            )}
            style={{
              borderColor: active ? 'var(--mc-cyan)' : 'var(--mc-border)',
              backgroundColor: active ? 'var(--mc-cyan)' : 'var(--mc-surface)',
              boxShadow: active ? '0 0 16px -6px var(--mc-cyan)' : undefined,
            }}
          >
            <span>{s.label}</span>
          </button>
        )
      })}
      {skills.length === 0 && (
        <span className="font-mono text-[11px] text-[var(--mc-text-dimmer)]">
          loading skills…
        </span>
      )}
    </div>
  )
}
