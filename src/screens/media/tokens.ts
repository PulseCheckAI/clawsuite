// MC_STYLE — design tokens for the Media Studio screen.
// Mirrored from conductor-mission-control.tsx.

import type { CSSProperties } from 'react'

export const MC_STYLE: CSSProperties = {
  ['--mc-bg' as string]: '#070A11',
  ['--mc-surface' as string]: '#0D131D',
  ['--mc-surface-2' as string]: '#12192680',
  ['--mc-border' as string]: 'rgba(0, 229, 255, 0.10)',
  ['--mc-border-bright' as string]: 'rgba(0, 229, 255, 0.32)',
  ['--mc-text' as string]: '#E6F1FF',
  ['--mc-text-dim' as string]: '#8FA3BF',
  ['--mc-text-dimmer' as string]: '#4F6680',
  ['--mc-cyan' as string]: '#00E5FF',
  ['--mc-cyan-soft' as string]: 'rgba(0, 229, 255, 0.12)',
  ['--mc-magenta' as string]: '#FF4FD8',
  ['--mc-magenta-soft' as string]: 'rgba(255, 79, 216, 0.14)',
  ['--mc-amber' as string]: '#FFB547',
  ['--mc-amber-soft' as string]: 'rgba(255, 181, 71, 0.14)',
  ['--mc-emerald' as string]: '#3DF5A1',
  ['--mc-emerald-soft' as string]: 'rgba(61, 245, 161, 0.14)',
  ['--mc-rose' as string]: '#FF6B8B',
  ['--mc-rose-soft' as string]: 'rgba(255, 107, 139, 0.14)',
}

export type AccentColor = 'cyan' | 'magenta' | 'emerald' | 'amber' | 'rose'
