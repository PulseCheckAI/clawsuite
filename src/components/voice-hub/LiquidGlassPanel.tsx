// LiquidGlassPanel — the base translucent surface every voice-hub component
// inherits from. Web translation of Apple's iOS 26 Liquid Glass material:
// backdrop-filter blur + saturate, semi-transparent navy fill, 1px hairline
// border + a 1px inner rim (top-edge highlight), bottom-weighted depth
// shadow for "floating" feel (antigravity principle).
//
// Why a component (not a CSS class)? Three reasons:
//   1. We attach `data-voice-hub` so tokens cascade even if a panel is
//      rendered outside HubOverview (e.g. portals, dialogs).
//   2. The `glow` prop swaps the outer shadow for a semantic-status glow
//      (active / compliant / blocked) WITHOUT animating box-shadow (which
//      is forbidden continuous-animation per antigravity execution rules).
//   3. `as` polymorphism lets it become <section>, <aside>, <article>
//      cleanly, preserving semantics for screen readers.
//
// Consumers:
//   - src/components/voice-hub/HubOverview.tsx (composes 6+ instances)
//   - src/components/voice-hub/DialerKeypad.tsx (used as keypad frame)

import { forwardRef, type ElementType, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@/lib/utils'

export type LiquidGlassGlow = 'active' | 'compliant' | 'blocked' | 'none'

type DivMotionProps = HTMLMotionProps<'div'>

export interface LiquidGlassPanelProps extends Omit<
  DivMotionProps,
  'ref' | 'children'
> {
  children?: ReactNode
  /** Render as a different element. Default 'div'. Use 'section'/'article'
   *  to communicate landmark semantics. */
  as?: 'div' | 'section' | 'article' | 'aside' | 'header'
  /** Semantic-status outer glow. Renders as a soft halo, not animated. */
  glow?: LiquidGlassGlow
  /** Adds interactive hover lift + cursor. Use for clickable panels. */
  interactive?: boolean
  /** Density preset — affects padding + corner radius. */
  density?: 'comfortable' | 'compact'
  className?: string
}

const GLOW_VAR: Record<Exclude<LiquidGlassGlow, 'none'>, string> = {
  active: 'var(--vh-shadow-glow-active)',
  compliant: 'var(--vh-shadow-glow-compliant)',
  blocked: 'var(--vh-shadow-glow-blocked)',
}

export const LiquidGlassPanel = forwardRef<
  HTMLDivElement,
  LiquidGlassPanelProps
>(function LiquidGlassPanel(
  {
    children,
    as = 'div',
    glow = 'none',
    interactive = false,
    density = 'comfortable',
    className,
    style,
    ...rest
  },
  ref,
) {
  // Compose box-shadow: rest shadow + optional semantic glow. Static —
  // we never animate box-shadow itself (antigravity perf rule).
  const restShadow = 'var(--vh-shadow-rest)'
  const composedShadow =
    glow === 'none' ? restShadow : `${restShadow}, ${GLOW_VAR[glow]}`

  const padding = density === 'compact' ? '12px 14px' : '18px 20px'
  const radius = density === 'compact' ? 12 : 16

  // motion[tag] gives a motion-enabled component for any HTML tag.
  const MotionTag = motion[as] as ElementType

  return (
    <MotionTag
      ref={ref}
      // antigravity: weightless entrance — slight drop + fade
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 220,
        damping: 28,
        mass: 1.1,
      }}
      whileHover={
        interactive
          ? { y: -2, transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] } }
          : undefined
      }
      whileTap={interactive ? { scale: 0.985 } : undefined}
      data-voice-hub
      data-glow={glow}
      className={cn(
        'relative overflow-hidden',
        interactive && 'cursor-pointer',
        className,
      )}
      style={{
        // Glass material — references tokens from voice-hub-tokens.css
        backgroundColor: 'var(--vh-glass-bg)',
        backdropFilter:
          'blur(var(--vh-glass-blur)) saturate(var(--vh-glass-saturate))',
        WebkitBackdropFilter:
          'blur(var(--vh-glass-blur)) saturate(var(--vh-glass-saturate))',
        border: '1px solid var(--vh-glass-border)',
        borderRadius: radius,
        padding,
        boxShadow: composedShadow,
        color: 'var(--vh-text)',
        willChange: 'transform',
        ...style,
      }}
      {...rest}
    >
      {/* Inner rim highlight — 1px white-alpha line along the top edge.
          Pure decoration; pointer-events: none keeps it out of hit-tests. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          pointerEvents: 'none',
          boxShadow: 'inset 0 1px 0 0 var(--vh-glass-rim)',
        }}
      />
      {children}
    </MotionTag>
  )
})
