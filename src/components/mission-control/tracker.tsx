import { cn } from '@/lib/utils'

export type TrackerCell = {
  tone: 'ok' | 'warn' | 'fail' | 'unknown'
  tooltip?: string
}

const TONE_CLASSES = {
  ok: 'bg-emerald-500/80 hover:bg-emerald-400',
  warn: 'bg-amber-500/80 hover:bg-amber-400',
  fail: 'bg-red-500/80 hover:bg-red-400',
  unknown: 'bg-primary-500/60 hover:bg-primary-400',
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
