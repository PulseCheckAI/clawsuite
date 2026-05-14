import { cn } from '@/lib/utils'

export type BarListItem = {
  label: string
  value: number
  formattedValue?: string
  href?: string
}

// Mission Control horizontal bar list — for "Top agents", "Most active
// skills", "Top categories". Each bar is sized proportional to the max.
export function BarList({
  items,
  color = '#FF6B35',
  className,
}: {
  items: Array<BarListItem>
  color?: string
  className?: string
}) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((item, i) => {
        const width = (item.value / max) * 100
        const content = (
          <>
            <span
              className="absolute inset-y-0 left-0 rounded-md transition-all duration-300"
              style={{
                width: `${width}%`,
                background: `linear-gradient(90deg, ${color}33 0%, ${color}1a 100%)`,
                borderLeft: `2px solid ${color}`,
              }}
            />
            <span className="relative z-10 text-sm font-medium px-3 py-1.5 flex items-center justify-between h-full">
              <span className="truncate">{item.label}</span>
              <span className="font-mono text-xs text-primary-700 dark:text-primary-800 ml-2 shrink-0">
                {item.formattedValue ?? item.value}
              </span>
            </span>
          </>
        )
        return (
          <li
            key={i}
            className="relative h-8 rounded-md overflow-hidden bg-[rgba(255,255,255,0.04)]"
          >
            {item.href ? (
              <a href={item.href} className="block h-full">
                {content}
              </a>
            ) : (
              content
            )}
          </li>
        )
      })}
    </ul>
  )
}
