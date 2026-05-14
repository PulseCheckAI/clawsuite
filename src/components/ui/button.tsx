'use client'

import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0] select-none duration-150',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
        lg: 'h-10 px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-md': 'size-10',
        'icon-xl': 'size-11 [&_svg]:size-5',
      },
      variant: {
        default:
          'border border-[rgba(255,107,53,0.55)] bg-[rgba(255,107,53,0.18)] text-white backdrop-blur-sm hover:bg-[rgba(255,107,53,0.3)] hover:border-[rgba(255,107,53,0.75)] shadow-sm transition-colors',
        secondary:
          'bg-primary-50 text-primary-950 hover:bg-primary-200 dark:bg-primary-900 dark:text-primary-100 dark:hover:bg-primary-800 outline outline-primary-900/10 dark:outline-primary-700 shadow-2xs',
        outline:
          'border border-[rgba(170,178,195,0.32)] bg-[rgba(255,255,255,0.04)] text-white backdrop-blur-sm hover:bg-[rgba(255,255,255,0.09)] hover:border-[rgba(192,200,215,0.5)] shadow-sm transition-colors',
        ghost:
          'text-primary-900 hover:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-200 hover:text-primary-950 dark:hover:text-primary-950',
        destructive: 'bg-red-600 text-primary-50 hover:bg-red-700 shadow-sm',
      },
    },
  },
)

interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: VariantProps<typeof buttonVariants>['variant']
  size?: VariantProps<typeof buttonVariants>['size']
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>['type'] =
    render ? undefined : 'button'

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    'data-slot': 'button',
    type: typeValue,
  }

  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(defaultProps, props),
    render,
  })
}

export { Button, buttonVariants }
