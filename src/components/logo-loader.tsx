'use client'

import { cn } from '@/lib/utils'

export type LogoLoaderProps = {
  className?: string
}

function LogoLoader({ className }: LogoLoaderProps) {
  return (
    <span className="logo-loader-track" aria-hidden="true">
      <img
        src="/pulsecheck-wave.svg"
        alt="PulseCheck"
        className={cn('logo-loader-icon size-4 object-contain', className)}
      />
    </span>
  )
}

export { LogoLoader }
