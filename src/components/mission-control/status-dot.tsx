import { cn } from '@/lib/utils'

export type StatusTone = 'live' | 'idle' | 'warn' | 'down' | 'unknown'

const TONE_CLASSES: Record<StatusTone, string> = {
  live: 'bg-emerald-500',
  idle: 'bg-blue-500',
  warn: 'bg-amber-500',
  down: 'bg-red-500',
  unknown: 'bg-zinc-500',
}

// Animated pulse dot — matches the artifacts-panel/11-mission-control.html
// status indicators. .pulse-status-dot keyframes live in styles.css.
export function StatusDot({
  tone,
  pulse = true,
  size = 8,
  className,
}: {
  tone: StatusTone
  pulse?: boolean
  size?: number
  className?: string
}) {
  return (
    <span
      role="status"
      aria-label={`status: ${tone}`}
      className={cn(
        'inline-block rounded-full shrink-0',
        TONE_CLASSES[tone],
        pulse && tone === 'live' && 'pulse-status-dot',
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}
