import { Area, AreaChart, ResponsiveContainer } from 'recharts'

// Mission Control sparkline — minimal, no axes, no tooltip by default.
// Mirrors Tremor Raw's SparkAreaChart pattern but built directly on Recharts
// (already a PulseOS dep at 3.8.1).
export function SparkArea({
  data,
  color = '#FF6B35',
  height = 48,
  className,
}: {
  data: Array<number>
  color?: string
  height?: number
  className?: string
}) {
  const series = data.map((v, i) => ({ i, v }))
  return (
    <div
      className={className}
      style={{ width: '100%', height, minWidth: 0, minHeight: height }}
    >
      <ResponsiveContainer width="99%" height={height}>
        <AreaChart
          data={series}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient
              id={`spark-${color.replace('#', '')}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${color.replace('#', '')})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
