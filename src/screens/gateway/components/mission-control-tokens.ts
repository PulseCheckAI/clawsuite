export type MissionControlStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'aborted'
  | 'stopped'

export const HUB_SPACING = {
  section: 'space-y-4',
  cardPadding: 'p-4',
  blockPadding: 'px-3 py-2.5',
  inlineGap: 'gap-2',
} as const

export const HUB_RADIUS = {
  card: 'rounded-2xl',
  block: 'rounded-xl',
  pill: 'rounded-full',
  button: 'rounded-lg',
} as const

export const HUB_COLORS = {
  surface:
    'border border-primary-200 bg-white/80 dark:border-primary-700 dark:bg-primary-900/70',
  mutedSurface:
    'border border-primary-200 bg-primary-50/60 dark:border-primary-700 dark:bg-primary-800/40',
  softSurface:
    'border border-primary-200 bg-primary-50/40 dark:border-primary-700 dark:bg-primary-900/20',
  heading: 'text-primary-900 dark:text-primary-100',
  body: 'text-primary-700 dark:text-primary-300',
  muted: 'text-primary-500 dark:text-primary-400',
} as const

export const HUB_STATUS = {
  ready: 'bg-emerald-500/10 text-emerald-400 dark:bg-emerald-950/30 dark:text-emerald-300',
  paused: 'bg-amber-500/10 text-amber-300 dark:bg-amber-950/30 dark:text-amber-300',
  blocked: 'bg-red-500/10 text-red-400 dark:bg-red-950/30 dark:text-red-300',
  neutral: 'bg-primary-200 text-primary-600 dark:bg-primary-800 dark:text-primary-300',
} as const

export const HUB_TYPE = {
  overline: 'text-[11px] font-semibold uppercase tracking-[0.14em]',
  title: 'text-lg font-semibold',
  subtitle: 'text-sm',
  body: 'text-xs',
  mono: 'font-mono text-[10px]',
} as const

export const MISSION_CONTROL_STATUS_META: Record<
  MissionControlStatus,
  {
    label: string
    className: string
  }
> = {
  running: {
    label: 'Running',
    className:
      'border border-emerald-500/30 bg-emerald-50 text-emerald-400 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  paused: {
    label: 'Paused',
    className:
      'border border-amber-500/40 bg-amber-50 text-amber-300 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300',
  },
  completed: {
    label: 'Completed',
    className:
      'border border-primary-200 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-800 dark:text-primary-300',
  },
  aborted: {
    label: 'Aborted',
    className:
      'border border-red-500/30 bg-red-50 text-red-400 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300',
  },
  stopped: {
    label: 'Stopped',
    className:
      'border border-primary-200 bg-primary-100 text-primary-600 dark:border-primary-700 dark:bg-primary-800 dark:text-primary-400',
  },
}

export function mapSessionStatusToMissionControlStatus(
  value: string,
): MissionControlStatus {
  const status = value.trim().toLowerCase()
  if (
    status === 'active' ||
    status === 'running' ||
    status === 'thinking' ||
    status === 'processing' ||
    status === 'streaming'
  ) {
    return 'running'
  }
  if (
    status === 'idle' ||
    status === 'paused' ||
    status === 'pause' ||
    status === 'suspended'
  ) {
    return 'paused'
  }
  if (status === 'aborted' || status === 'error' || status === 'failed') {
    return 'aborted'
  }
  if (status === 'stopped') {
    return 'stopped'
  }
  return 'completed'
}
