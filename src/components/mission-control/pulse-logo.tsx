import { cn } from '@/lib/utils'

// PulseCheck AI brand mark — REAL wave PNG from docs/Logos/
// pulsecheck-logo-dark.png (transparent RGBA, 1024×238). The wave
// occupies the leftmost ~28% of the source canvas. We use a wider-than-
// tall container (1.2:1) matching the wave's natural aspect, then
// object-fit:cover + object-position:left to crop the trailing
// whitespace. No background, no card — the PNG's alpha channel keeps
// the navy page bg visible around the wave.
// `variant`/`color` kept for API compat; the PNG ships its own gradient.
export function PulseLogo({
  size = 32,
  variant: _variant = 'gradient',
  glow = true,
  color: _color = '#FF6B35',
  className,
}: {
  size?: number
  variant?: 'solid' | 'gradient'
  glow?: boolean
  color?: string
  className?: string
}) {
  // Source PNG (1024×238): the wave silhouette spans x=53–315 (width 263)
  // with full-height peaks, then a white wordmark "PulseCheck AI" lives
  // x=336–972. A container aspect of 1.4:1 plus object-fit:cover left-
  // anchored renders the full wave shape and stops just before the
  // wordmark starts. Math: visible-source-width = (1.4/4.3) × 1024 ≈ 333px.
  const w = Math.round(size * 1.4)
  const h = size
  // <picture> with WebP first (smaller + sharper gradient encoding) and
  // PNG fallback. The intrinsic source is 1024×238 — plenty of source
  // pixels for any reasonable rendered size, so the browser downsamples
  // cleanly on HiDPI/Retina displays. `image-rendering: auto` lets the
  // browser use its highest-quality resampler for gradient art.
  return (
    <picture>
      <source srcSet="/pulsecheck-wave.webp" type="image/webp" />
      <img
        src="/pulsecheck-wave.png"
        alt="PulseCheck"
        width={w}
        height={h}
        decoding="async"
        className={cn('shrink-0', glow && 'pulse-glow', className)}
        style={{
          width: w,
          height: h,
          objectFit: 'cover',
          objectPosition: 'left center',
          background: 'transparent',
          imageRendering: 'auto',
        }}
      />
    </picture>
  )
}
