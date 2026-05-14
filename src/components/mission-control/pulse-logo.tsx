import { cn } from '@/lib/utils'

// PulseCheck AI brand mark — canonical pulse waveform from
// pulsecheck-ai/os/dashboard/index.html. Two render modes:
//   - solid: stroke is single color (default pulse-orange)
//   - gradient: stroke fills via the pulse gradient (red→orange→amber→yellow)
// Set `glow` for the animated pulse-glow filter (defined in styles.css).
export function PulseLogo({
  size = 32,
  variant = 'gradient',
  glow = true,
  color = '#FF6B35',
  className,
}: {
  size?: number
  variant?: 'solid' | 'gradient'
  glow?: boolean
  color?: string
  className?: string
}) {
  const gradientId = 'pulse-logo-grad'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cn('shrink-0', glow && 'pulse-glow', className)}
      aria-hidden="true"
      role="img"
    >
      {variant === 'gradient' ? (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#E63946" />
            <stop offset="40%" stopColor="#FF6B35" />
            <stop offset="70%" stopColor="#FF9F1C" />
            <stop offset="100%" stopColor="#FFD166" />
          </linearGradient>
        </defs>
      ) : null}
      <path
        d="M 8 50 L 22 50 C 26 30, 30 18, 34 38 C 38 60, 42 72, 48 50 C 53 30, 58 12, 66 16 C 74 20, 78 38, 84 50 L 92 50"
        stroke={variant === 'gradient' ? `url(#${gradientId})` : color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
