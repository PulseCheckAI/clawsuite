import { cn } from '@/lib/utils'

export type TrackerCell = {
  tone: 'ok' | 'warn' | 'fail' | 'unknown'
  tooltip?: string
}

// Tracker cell tones. `unknown` uses an explicit silver-translucent fill
// (not bg-primary-*) so empty days stay visible against navy — the global
// pulsecheck-navy crush would otherwise collapse it into the body bg.
const TONE_CLASSES = {
  ok: 'bg-emerald-500/85 hover:bg-emerald-400',
  warn: 'bg-amber-500/85 hover:bg-amber-400',
  fail: 'bg-red-500/85 hover:bg-red-400',
  unknown:
    'bg-[rgba(170,178,195,0.18)] hover:bg-[rgba(170,178,195,0.3)] border border-[rgba(170,178,195,0.1)]',
}

// Mission Control daily-uptime tracker — segmented bar like a GitHub
// contributions row, used for daily pipeline health / SLO.
export function Tracker({
  cells,
  className,
  cellWidth = 4,
  cellHeight = 28,
}: {
  cells: Array<TrackerCell>
  className?: string
  cellWidth?: number
  cellHeight?: number
}) {
  return (
    <div className={cn('flex items-stretch gap-0.5', className)}>
      {cells.map((cell, i) => (
        <span
          key={i}
          title={cell.tooltip}
          aria-label={cell.tooltip ?? cell.tone}
          className={cn(
            'rounded-sm transition-colors duration-150 cursor-default',
            TONE_CLASSES[cell.tone],
          )}
          style={{ width: cellWidth, height: cellHeight }}
        />
      ))}
    </div>
  )
}
