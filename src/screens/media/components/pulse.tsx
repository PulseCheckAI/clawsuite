// Pulse — small animated status indicator + statusColor helper.

import type { MediaJobStatus } from '@/server/wan2gp-adapter'
import type { AccentColor } from '../tokens'

export function Pulse({
  active,
  color = 'cyan',
}: {
  active: boolean
  color?: AccentColor
}) {
  const colorVar = `var(--mc-${color})`
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {active && (
        <span
          className="absolute inset-0 rounded-full animate-ping motion-reduce:hidden"
          style={{ backgroundColor: colorVar, opacity: 0.5 }}
        />
      )}
      <span
        className="relative inline-block h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: colorVar,
          boxShadow: active ? `0 0 12px 1px ${colorVar}` : 'none',
        }}
      />
    </span>
  )
}

export function statusColor(s: MediaJobStatus['status']): AccentColor {
  switch (s) {
    case 'running':
      return 'cyan'
    case 'done':
      return 'emerald'
    case 'failed':
      return 'rose'
    case 'queued':
      return 'amber'
    default:
      return 'amber'
  }
}
