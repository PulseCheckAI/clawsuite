import { cn } from '@/lib/utils'

export type DeltaTone = 'positive' | 'negative' | 'neutral'

// Mission Control delta chip — colored % change with arrow.
export function BadgeDelta({
  value,
  tone,
  className,
}: {
  value: string
  tone: DeltaTone
  className?: string
}) {
  const cls =
    tone === 'positive'
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      : tone === 'negative'
        ? 'text-red-400 bg-red-500/10 border-red-500/30'
        : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'

  const arrow = tone === 'positive' ? '▲' : tone === 'negative' ? '▼' : '◆'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono font-semibold tracking-tight',
        cls,
        className,
      )}
    >
      <span aria-hidden>{arrow}</span>
      <span>{value}</span>
    </span>
  )
}
