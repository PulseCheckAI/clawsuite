import { cn } from '@/lib/utils'

// Mission Control donut gauge — circular percentage indicator with
// pulse-orange stroke. Pure SVG, no chart library.
export function DonutGauge({
  value,
  max = 100,
  size = 96,
  stroke = 8,
  color = '#FF6B35',
  trackColor = 'currentColor',
  label,
  caption,
  className,
}: {
  value: number
  max?: number
  size?: number
  stroke?: number
  color?: string
  trackColor?: string
  label?: string
  caption?: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(1, value / max))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = circumference * pct
  const gap = circumference - dash

  return (
    <div className={cn('inline-flex flex-col items-center gap-1', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={trackColor}
            strokeWidth={stroke}
            strokeOpacity={0.12}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${gap}`}
            strokeLinecap="round"
            fill="none"
            style={{ transition: 'stroke-dasharray 400ms ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-extrabold tracking-tight">
            {label ?? `${Math.round(pct * 100)}%`}
          </span>
        </div>
      </div>
      {caption ? (
        <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-primary-700 dark:text-primary-800">
          {caption}
        </span>
      ) : null}
    </div>
  )
}
