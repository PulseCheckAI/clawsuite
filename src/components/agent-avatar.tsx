'use client'

import { cn } from '@/lib/utils'

export type AgentAvatarSize = 'sm' | 'md' | 'lg'

type AgentAvatarProps = {
  size?: AgentAvatarSize
  className?: string
  iconClassName?: string
}

function getContainerSizeClassName(size: AgentAvatarSize): string {
  if (size === 'sm') return 'size-6'
  if (size === 'lg') return 'size-10'
  return 'size-8'
}

function getLogoSizeClassName(size: AgentAvatarSize): string {
  if (size === 'sm') return 'size-4 rounded overflow-hidden'
  if (size === 'lg') return 'size-6 rounded-lg overflow-hidden'
  return 'size-5 rounded-md overflow-hidden'
}

function AgentAvatar({
  size = 'md',
  className,
  iconClassName,
}: AgentAvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border border-primary-300/70 bg-primary-200/70 text-primary-900',
        getContainerSizeClassName(size),
        className,
      )}
      aria-label="PulseCheck AI agent"
    >
      <img
        src="/pulsecheck-wave.svg"
        alt="PulseCheck AI agent"
        className={cn(
          getLogoSizeClassName(size),
          'object-contain',
          iconClassName,
        )}
      />
    </span>
  )
}

export { AgentAvatar }
