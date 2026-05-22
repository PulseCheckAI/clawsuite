import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  type AgentRegistryCardData,
  type AgentRegistryStatus,
} from '@/components/agent-view/agent-registry-card'
import { KillConfirmDialog } from '@/components/agent-view/kill-confirm-dialog'
import { SteerModal } from '@/components/agent-view/steer-modal'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatModelName } from '@/lib/format-model-name'
import { fetchCronJobs } from '@/lib/cron-api'
import { toggleAgentPause } from '@/lib/gateway-api'
import { toast } from '@/components/ui/toast'
import { formatRelativeTime as formatRelativeTimeShort } from '@/screens/dashboard/lib/formatters'
import { AgentHubLayout } from './agent-hub-layout'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'

type AgentGatewayEntry = {
  id?: string
  name?: string
  role?: string
  category?: string
  color?: string
  [key: string]: unknown
}

type AgentsData = {
  defaultId?: string
  mainKey?: string
  scope?: string
  agents?: AgentGatewayEntry[]
  [key: string]: unknown
}

type SessionEntry = {
  key?: string
  friendlyId?: string
  label?: string
  displayName?: string
  title?: string
  derivedTitle?: string
  task?: string
  status?: string
  updatedAt?: number | string
  enabled?: boolean
  [key: string]: unknown
}

type AgentDefinition = {
  id: string
  name: string
  category: string
  role: string
  color: AgentRegistryCardData['color']
  aliases: Array<string>
}

type AgentRuntime = AgentRegistryCardData & {
  matchedSessions: Array<SessionEntry>
}

type AgentConfigToolEntry = {
  id: string
  enabled: boolean
  source: 'allowed' | 'denied' | 'explicit' | 'unknown'
}

type AgentConfigSkillEntry = {
  id: string
  enabled: boolean
}

type AgentConfigChannelEntry = {
  id: string
  enabled: boolean | null
  config: Record<string, unknown>
}

type AgentConfigData = {
  agentId: string
  name: string
  workspacePath: string
  primaryModel: string
  fallbackModels: Array<string>
  modelOverride: string
  tools: Array<AgentConfigToolEntry>
  skills: Array<AgentConfigSkillEntry>
  channels: Array<AgentConfigChannelEntry>
  readOnly: boolean
  supportsPatch: boolean
  sourceMethod?: string
  warning?: string
}

type AgentConfigDraft = {
  modelOverride: string
  tools: Record<string, boolean>
  skills: Record<string, boolean>
  channels: Record<
    string,
    { enabled: boolean | null; config: Record<string, unknown> }
  >
}

type AgentConfigPatchPayload = {
  modelOverride?: string
  tools: Record<string, boolean>
  skills: Record<string, boolean>
  channels: Record<string, Record<string, unknown>>
}

type AgentsScreenVariant = 'mission-control' | 'registry'
type AgentsScreenProps = {
  variant?: AgentsScreenVariant
}

const CATEGORY_ORDER = ['Core', 'Coding', 'System', 'Integrations'] as const

const STATUS_SORT_ORDER: Record<AgentRegistryStatus, number> = {
  active: 0,
  idle: 1,
  available: 2,
  paused: 3,
}

const RUNNING_STATUSES = new Set([
  'running',
  'active',
  'thinking',
  'processing',
  'streaming',
  'in-progress',
  'inprogress',
])

const PAUSED_STATUSES = new Set(['paused', 'pause', 'suspended'])

const ACTIVE_HEARTBEAT_MS = 30_000

// Empty fallback registry — non-registered services (Codex, Memory
// consolidator, Telegram bridge) now live on the Mission Control "System
// Integrations" panel where their state is probed honestly. The Gateway
// Agents page only shows agents the gateway actually knows about.
const FALLBACK_AGENT_REGISTRY: Array<AgentDefinition> = []

function readString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function readTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function deriveFriendlyIdFromKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(':')
  const tail = parts[parts.length - 1]
  return tail && tail.trim().length > 0 ? tail.trim() : trimmed
}

function inferCategoryFromText(text: string): string {
  const normalized = normalizeToken(text)
  if (
    normalized.includes('codex') ||
    normalized.includes('coding') ||
    normalized.includes('developer')
  ) {
    return 'Coding'
  }
  if (
    normalized.includes('memory') ||
    normalized.includes('system') ||
    normalized.includes('ops')
  ) {
    return 'System'
  }
  if (
    normalized.includes('telegram') ||
    normalized.includes('discord') ||
    normalized.includes('slack') ||
    normalized.includes('integration') ||
    normalized.includes('gateway')
  ) {
    return 'Integrations'
  }
  return 'Core'
}

function normalizeCategoryLabel(category: string): string {
  const normalized = normalizeToken(category)
  if (normalized === 'core') return 'Core'
  if (normalized === 'coding') return 'Coding'
  if (normalized === 'system') return 'System'
  if (normalized === 'integrations' || normalized === 'integration') {
    return 'Integrations'
  }
  return category
}

function inferRoleFromCategory(category: string): string {
  if (category === 'Coding') return 'Coding agent'
  if (category === 'System') return 'System agent'
  if (category === 'Integrations') return 'Integration agent'
  return 'Core agent'
}

function inferColorFromCategory(
  category: string,
): AgentRegistryCardData['color'] {
  if (category === 'Coding') return 'blue'
  if (category === 'System') return 'violet'
  if (category === 'Integrations') return 'cyan'
  return 'orange'
}

function dedupe(values: Array<string>): Array<string> {
  const result: Array<string> = []
  const seen = new Set<string>()

  values.forEach((value) => {
    const normalized = normalizeToken(value)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })

  return result
}

function prettyLabel(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function buildAgentConfigDraft(config: AgentConfigData): AgentConfigDraft {
  return {
    modelOverride: config.modelOverride,
    tools: Object.fromEntries(
      config.tools.map((entry) => [entry.id, entry.enabled]),
    ),
    skills: Object.fromEntries(
      config.skills.map((entry) => [entry.id, entry.enabled]),
    ),
    channels: Object.fromEntries(
      config.channels.map((entry) => [
        entry.id,
        { enabled: entry.enabled, config: entry.config },
      ]),
    ),
  }
}

function serializeAgentConfigDraft(draft: AgentConfigDraft | null): string {
  return JSON.stringify(draft ?? null)
}

function buildAgentConfigPatchPayload(
  draft: AgentConfigDraft,
): AgentConfigPatchPayload {
  return {
    ...(draft.modelOverride.trim()
      ? { modelOverride: draft.modelOverride.trim() }
      : {}),
    tools: draft.tools,
    skills: draft.skills,
    channels: Object.fromEntries(
      Object.entries(draft.channels).map(([id, value]) => [
        id,
        {
          ...value.config,
          ...(value.enabled === null ? {} : { enabled: value.enabled }),
        },
      ]),
    ),
  }
}

async function fetchAgentConfig(agentId: string): Promise<AgentConfigData> {
  const response = await fetch(
    `/api/gateway/agents?agentId=${encodeURIComponent(agentId)}`,
  )
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    data?: AgentConfigData
  }

  if (!response.ok || payload.ok === false || !payload.data) {
    throw new Error(payload.error || `HTTP ${response.status}`)
  }

  return payload.data
}

async function patchAgentConfig(
  agentId: string,
  config: AgentConfigPatchPayload,
): Promise<void> {
  const response = await fetch('/api/gateway/agents', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId, config }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || 'Failed to save agent config')
  }
}

function matchesAgentCronJob(
  job: Awaited<ReturnType<typeof fetchCronJobs>>[number],
  definition: AgentDefinition | null,
  runtimeAgent: AgentRuntime | null,
): boolean {
  if (!runtimeAgent) return false

  const tokens = dedupe([
    runtimeAgent.id,
    runtimeAgent.name,
    ...(definition?.aliases ?? []),
  ])

  const searchBlob = normalizeToken(
    [
      job.id,
      job.name,
      job.description ?? '',
      safeStringify(job.payload),
      safeStringify(job.deliveryConfig),
    ].join(' '),
  )

  return tokens.some((token) => {
    const normalized = normalizeToken(token)
    return normalized.length > 0 && searchBlob.includes(normalized)
  })
}

function toAgentDefinition(
  value: unknown,
  index: number,
): AgentDefinition | null {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null

  if (!record) return null

  const id = readString(record.id || record.key || record.agentId)
  const name = readString(record.name || record.label || record.displayName)

  const fallbackId = normalizeToken(id || name)
  if (!fallbackId) return null

  const categoryRaw = readString(record.category || record.group || record.kind)
  const roleRaw = readString(record.role || record.description)
  const colorRaw = normalizeToken(readString(record.color))

  const category = normalizeCategoryLabel(
    categoryRaw.length > 0
      ? categoryRaw
      : inferCategoryFromText(`${fallbackId} ${name}`),
  )

  let color = inferColorFromCategory(category)
  if (
    colorRaw === 'orange' ||
    colorRaw === 'blue' ||
    colorRaw === 'cyan' ||
    colorRaw === 'purple' ||
    colorRaw === 'violet'
  ) {
    color = colorRaw
  }

  const aliasParts = [
    id,
    name,
    fallbackId,
    readString(record.profile),
    readString(record.handle),
  ]

  const primaryNameToken = normalizeToken(name).split('-')[0] || ''
  if (primaryNameToken) aliasParts.push(primaryNameToken)

  return {
    id: fallbackId || `agent-${index + 1}`,
    name: name || id || `Agent ${index + 1}`,
    category,
    role: roleRaw || inferRoleFromCategory(category),
    color,
    aliases: dedupe(aliasParts),
  }
}

function parseAgentDefinitions(
  data: AgentsData | undefined,
): Array<AgentDefinition> | null {
  if (!data || typeof data !== 'object') return null

  const directAgents = Array.isArray(data.agents) ? data.agents : null
  if (directAgents) {
    return directAgents
      .map((entry, index) => toAgentDefinition(entry, index))
      .filter((entry): entry is AgentDefinition => entry !== null)
  }

  const record = data as Record<string, unknown>
  const alternateLists = ['registry', 'agentDefinitions']

  for (const key of alternateLists) {
    const list = record[key]
    if (!Array.isArray(list)) continue

    return list
      .map((entry, index) => toAgentDefinition(entry, index))
      .filter((entry): entry is AgentDefinition => entry !== null)
  }

  const profiles = record.profiles
  if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
    const entries = Object.entries(profiles).map(
      ([profileId, profileValue]) => {
        const profileRecord =
          profileValue &&
          typeof profileValue === 'object' &&
          !Array.isArray(profileValue)
            ? (profileValue as Record<string, unknown>)
            : {}
        return {
          ...profileRecord,
          id: profileId,
          name: readString(profileRecord.name) || profileId,
        }
      },
    )

    return entries
      .map((entry, index) => toAgentDefinition(entry, index))
      .filter((entry): entry is AgentDefinition => entry !== null)
  }

  return null
}

function getSessionSearchBlob(session: SessionEntry): string {
  const values = [
    readString(session.key),
    readString(session.friendlyId),
    readString(session.label),
    readString(session.displayName),
    readString(session.title),
    readString(session.derivedTitle),
    readString(session.task),
    readString(session.agentId),
    readString(session.agent),
    readString(session.profile),
  ]

  return normalizeToken(values.join(' '))
}

function getSessionFriendlyId(session: SessionEntry | undefined): string {
  if (!session) return ''
  const friendlyId = readString(session.friendlyId)
  if (friendlyId) return friendlyId
  return deriveFriendlyIdFromKey(readString(session.key))
}

function getSessionTitle(session: SessionEntry): string {
  return (
    readString(session.label) ||
    readString(session.displayName) ||
    readString(session.title) ||
    readString(session.derivedTitle) ||
    getSessionFriendlyId(session) ||
    readString(session.key) ||
    'Session'
  )
}

function scoreSessionMatch(
  agent: AgentDefinition,
  session: SessionEntry,
): number {
  const sessionKey = normalizeToken(readString(session.key))
  const friendlyId = normalizeToken(readString(session.friendlyId))
  const blob = getSessionSearchBlob(session)

  let best = 0

  for (const alias of agent.aliases) {
    if (!alias) continue

    if (sessionKey === alias || friendlyId === alias) {
      best = Math.max(best, 100)
      continue
    }

    if (
      sessionKey.startsWith(`${alias}-`) ||
      sessionKey.includes(`:${alias}:`) ||
      sessionKey.endsWith(`:${alias}`) ||
      friendlyId.startsWith(`${alias}-`)
    ) {
      best = Math.max(best, 85)
      continue
    }

    if (blob.includes(alias)) {
      best = Math.max(best, 65)
    }
  }

  return best
}

function isPausedSession(session: SessionEntry): boolean {
  const status = normalizeToken(readString(session.status))
  if (PAUSED_STATUSES.has(status)) return true
  if (typeof session.enabled === 'boolean') return session.enabled === false
  return false
}

function deriveAgentStatus(
  session: SessionEntry | undefined,
  pausedOverride: boolean | undefined,
): AgentRegistryStatus {
  if (typeof pausedOverride === 'boolean') {
    if (pausedOverride) return 'paused'
    if (!session) return 'available'
  }

  if (!session) return 'available'

  if (isPausedSession(session)) return 'paused'

  const status = normalizeToken(readString(session.status))
  const updatedAt = readTimestamp(session.updatedAt)
  const staleMs = updatedAt > 0 ? Date.now() - updatedAt : 0
  const runningLike = RUNNING_STATUSES.has(status) || status.length === 0

  if (runningLike && (updatedAt <= 0 || staleMs <= ACTIVE_HEARTBEAT_MS)) {
    return 'active'
  }

  return 'idle'
}

function formatRelativeTime(value: unknown): string {
  const timestamp = readTimestamp(value)
  if (!timestamp) return 'No activity timestamp'

  const diffMs = Math.max(0, Date.now() - timestamp)
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getSessionTokenCount(session: SessionEntry): number {
  const rawValue =
    typeof session.totalTokens === 'number'
      ? session.totalTokens
      : typeof session.tokenCount === 'number'
        ? session.tokenCount
        : 0

  return Number.isFinite(rawValue) ? rawValue : 0
}

function getSessionModelName(session: SessionEntry): string {
  return readString(session.model) || readString(session.agentModel)
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(value)))
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error
    }
  } catch {
    // no-op
  }

  return response.statusText || `HTTP ${response.status}`
}

// ─── enterprise (MC) UI primitives for the registry variant ─────────────────
// Visual vocabulary mirrors operations-screen.tsx / operations-agent-card.tsx
// so the /agents page sits in the same family as /ops, /linkedin, /postiz.

type RegistryFilter = 'all' | 'available' | 'idle' | 'busy' | 'errored'
type McAccent = 'cyan' | 'emerald' | 'amber' | 'magenta' | 'rose'

function mcAccentVar(accent: McAccent): string {
  if (accent === 'emerald') return 'var(--mc-emerald)'
  if (accent === 'amber') return 'var(--mc-amber)'
  if (accent === 'magenta') return 'var(--mc-magenta)'
  if (accent === 'rose') return 'var(--mc-rose)'
  return 'var(--mc-cyan)'
}

function mcAccentSoft(accent: McAccent): string {
  if (accent === 'emerald') return 'var(--mc-emerald-soft)'
  if (accent === 'amber') return 'var(--mc-amber-soft)'
  if (accent === 'magenta') return 'var(--mc-magenta-soft)'
  if (accent === 'rose') return 'var(--mc-rose-soft)'
  return 'var(--mc-cyan-soft)'
}

function McMetricChip({
  label,
  value,
  accent = 'cyan',
}: {
  label: string
  value: ReactNode
  accent?: McAccent
}) {
  return (
    <div
      className="flex items-baseline gap-2 rounded-md border px-3 py-1.5 font-mono text-[11px] tracking-wide"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
        color: 'var(--mc-text-dim)',
      }}
    >
      <span className="uppercase">{label}</span>
      <span
        style={{ color: mcAccentVar(accent) }}
        className="text-[13px] font-semibold tabular-nums"
      >
        {value}
      </span>
    </div>
  )
}

function McSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="font-mono text-[11px] uppercase tracking-[0.18em]"
      style={{ color: 'var(--mc-text-dimmer)' }}
    >
      {children}
    </p>
  )
}

function RegistryStatusBar({
  total,
  available,
  idle,
  busy,
  errored,
  isLoading,
  isError,
  isSyncing,
  updatedAt,
}: {
  total: number
  available: number
  idle: number
  busy: number
  errored: number
  isLoading: boolean
  isError: boolean
  isSyncing: boolean
  updatedAt: number | null
}) {
  const phaseLabel = isError
    ? 'ERROR'
    : isLoading
      ? 'LOADING'
      : isSyncing
        ? 'SYNCING'
        : 'NOMINAL'
  const phaseAccent: McAccent = isError
    ? 'rose'
    : isLoading || isSyncing
      ? 'amber'
      : 'emerald'
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 font-mono"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
      }}
    >
      <div className="flex items-center gap-2 pr-3">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 items-center justify-center rounded border font-bold"
          style={{
            borderColor: 'var(--mc-border-bright)',
            background: 'var(--mc-cyan-soft)',
            color: 'var(--mc-cyan)',
          }}
        >
          §
        </span>
        <div className="leading-tight">
          <p
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--mc-text-dimmer)' }}
          >
            Gateway Agents · /agents
          </p>
          <p className="text-[12px]" style={{ color: 'var(--mc-text)' }}>
            Registered roster
            {updatedAt
              ? ` · Updated ${formatRelativeTimeShort(updatedAt)}`
              : ''}
          </p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <McMetricChip label="Phase" value={phaseLabel} accent={phaseAccent} />
        <McMetricChip
          label="Total"
          value={isLoading ? '—' : total || '—'}
          accent="cyan"
        />
        <McMetricChip
          label="Avail"
          value={isLoading ? '—' : available || '—'}
          accent="cyan"
        />
        <McMetricChip
          label="Idle"
          value={isLoading ? '—' : idle || '—'}
          accent="amber"
        />
        <McMetricChip
          label="Busy"
          value={isLoading ? '—' : busy || '—'}
          accent="emerald"
        />
        <McMetricChip
          label="Err"
          value={isLoading ? '—' : errored || '—'}
          accent="rose"
        />
      </div>
    </div>
  )
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent: McAccent
}) {
  const accentVar = mcAccentVar(accent)
  const accentSoft = mcAccentSoft(accent)
  return (
    <div
      className="relative overflow-hidden rounded-lg border px-4 py-3"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accentVar }}
      />
      <div className="flex items-baseline justify-between gap-2">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: 'var(--mc-text-dimmer)' }}
        >
          {label}
        </p>
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: accentVar, boxShadow: `0 0 6px ${accentSoft}` }}
        />
      </div>
      <p
        className="mt-1 font-mono text-2xl font-semibold tabular-nums"
        style={{ color: accentVar }}
      >
        {value}
      </p>
      {sub ? (
        <p
          className="mt-0.5 truncate text-[11px]"
          style={{ color: 'var(--mc-text-dim)' }}
        >
          {sub}
        </p>
      ) : null}
    </div>
  )
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  accent = 'cyan',
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  accent?: McAccent
}) {
  const accentVar = mcAccentVar(accent)
  const accentSoft = mcAccentSoft(accent)
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background: active ? accentSoft : 'transparent',
        color: active ? accentVar : 'var(--mc-text-dim)',
        ['--tw-ring-color' as string]: accentVar,
        ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
      }}
      aria-pressed={active}
    >
      {label}
      <span
        className="inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-1 text-[10px] tabular-nums"
        style={{
          background: active ? 'var(--mc-surface)' : 'var(--mc-surface-2)',
          color: active ? accentVar : 'var(--mc-text-dimmer)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

// Maps a registry agent's `color` (orange/blue/cyan/purple/violet) AND its
// metadata text (id, name, role) onto a role label + MC accent. Mirrors the
// vocabulary in agent-presets.ts (researcher/builder/writer/analyst/operator)
// when the metadata hints at one; otherwise falls back to a neutral chip from
// the card color.
function deriveRoleChip(agent: {
  id: string
  name: string
  role: string
  category: string
  color: AgentRegistryCardData['color']
}): { label: string; accent: McAccent } {
  const blob =
    `${agent.id} ${agent.name} ${agent.role} ${agent.category}`.toLowerCase()
  if (
    blob.includes('research') ||
    blob.includes('scout') ||
    blob.includes('discover') ||
    blob.includes('intel') ||
    blob.includes('search')
  ) {
    return { label: 'Researcher', accent: 'cyan' }
  }
  if (
    blob.includes('build') ||
    blob.includes('coder') ||
    blob.includes('coding') ||
    blob.includes('engineer') ||
    blob.includes('dev')
  ) {
    return { label: 'Builder', accent: 'emerald' }
  }
  if (
    blob.includes('writer') ||
    blob.includes('content') ||
    blob.includes('copy') ||
    blob.includes('voice')
  ) {
    return { label: 'Writer', accent: 'magenta' }
  }
  if (
    blob.includes('analyst') ||
    blob.includes('metric') ||
    blob.includes('eval') ||
    blob.includes('report')
  ) {
    return { label: 'Analyst', accent: 'amber' }
  }
  if (
    blob.includes('operator') ||
    blob.includes('ops') ||
    blob.includes('orchestr')
  ) {
    return { label: 'Operator', accent: 'rose' }
  }
  // Fallback: derive from the legacy gradient color so the chip still tells
  // the operator something rather than collapsing every card to the same chip.
  if (agent.color === 'blue') return { label: 'Coder', accent: 'cyan' }
  if (agent.color === 'cyan') return { label: 'Integration', accent: 'cyan' }
  if (agent.color === 'purple' || agent.color === 'violet') {
    return { label: 'System', accent: 'magenta' }
  }
  // orange / unknown
  return { label: agent.category || 'Core', accent: 'amber' }
}

function statusToTokens(status: AgentRegistryStatus): {
  label: string
  dot: string
  dotSoft: string
  pulse: boolean
} {
  if (status === 'active') {
    return {
      label: 'Active',
      dot: 'var(--mc-emerald)',
      dotSoft: 'var(--mc-emerald-soft)',
      pulse: true,
    }
  }
  if (status === 'idle') {
    return {
      label: 'Idle',
      dot: 'var(--mc-amber)',
      dotSoft: 'var(--mc-amber-soft)',
      pulse: false,
    }
  }
  if (status === 'paused') {
    return {
      label: 'Paused',
      dot: 'var(--mc-rose)',
      dotSoft: 'var(--mc-rose-soft)',
      pulse: false,
    }
  }
  // available
  return {
    label: 'Available',
    dot: 'var(--mc-cyan)',
    dotSoft: 'var(--mc-cyan-soft)',
    pulse: false,
  }
}

// MC-styled agent card for the /agents registry. Preserves every behavior of
// the legacy AgentRegistryCard (chat / steer / history / spawn, ⋯ menu with
// pause+kill, steer modal, kill-confirm modal, optimistic pause toggle) but
// renders inside the Mission Control palette to match /ops + /linkedin + /postiz.
function RegistryAgentCard({
  agent,
  isSpawning,
  onTap,
  onChat,
  onSpawn,
  onHistory,
  onPauseToggle,
  onKilled,
}: {
  agent: AgentRegistryCardData
  isSpawning: boolean
  onTap: (agent: AgentRegistryCardData) => void
  onChat: (agent: AgentRegistryCardData) => void | Promise<void>
  onSpawn: (agent: AgentRegistryCardData) => void | Promise<void>
  onHistory: (agent: AgentRegistryCardData) => void
  onPauseToggle: (
    agent: AgentRegistryCardData,
    nextPaused: boolean,
  ) => Promise<void>
  onKilled: (agent: AgentRegistryCardData) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [steerOpen, setSteerOpen] = useState(false)
  const [killOpen, setKillOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [pausePending, setPausePending] = useState(false)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    setMenuOpen(false)
    setSteerOpen(false)
    setKillOpen(false)
    setPausePending(false)
    setNotice('')
  }, [agent.id, agent.sessionKey, agent.status])

  const hasSession = Boolean(agent.sessionKey)
  const isPaused = agent.status === 'paused'
  const role = deriveRoleChip(agent)
  const status = statusToTokens(agent.status)
  const roleAccentVar = mcAccentVar(role.accent)

  function showSpawnFirstNotice() {
    setNotice('Spawn agent first')
  }

  function handleSteerIntent() {
    if (!hasSession) {
      showSpawnFirstNotice()
      return
    }
    setSteerOpen(true)
  }

  function handleKillIntent() {
    if (!hasSession) {
      showSpawnFirstNotice()
      return
    }
    setKillOpen(true)
  }

  async function handlePauseToggle() {
    if (pausePending) return
    const nextPaused = !isPaused
    setPausePending(true)
    try {
      await onPauseToggle(agent, nextPaused)
      setMenuOpen(false)
    } finally {
      setPausePending(false)
    }
  }

  const ringStyle: Record<string, string> = {
    ['--tw-ring-color']: 'var(--mc-cyan)',
    ['--tw-ring-offset-color']: 'var(--mc-bg)',
  }

  return (
    <article
      onClick={(event) => {
        const target = event.target as HTMLElement | null
        if (
          target?.closest(
            'button,a,input,textarea,select,[role="button"],[data-no-card-tap]',
          )
        ) {
          return
        }
        onTap(agent)
      }}
      className="group flex min-h-[12rem] cursor-pointer flex-col overflow-hidden rounded-lg border transition-colors motion-reduce:[animation:none]"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
        boxShadow:
          '0 8px 24px -16px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.01)',
        animation: 'mc-event-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = 'var(--mc-border-bright)'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = 'var(--mc-border)'
      }}
    >
      {/* header row: status pulse + name + role chip + ⋯ menu */}
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        <span
          aria-hidden="true"
          className="motion-reduce:[animation:none!important] inline-flex h-2 w-2 shrink-0 rounded-full"
          style={{
            background: status.dot,
            boxShadow: `0 0 8px ${status.dotSoft}`,
            animation: status.pulse
              ? 'mc-breathe 1.6s ease-in-out infinite'
              : undefined,
          }}
          title={status.label}
        />
        <h3
          className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--mc-text)' }}
          title={agent.name}
        >
          {agent.name}
        </h3>
        <span
          className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
          style={{
            borderColor: roleAccentVar,
            background: `color-mix(in srgb, ${roleAccentVar} 12%, transparent)`,
            color: roleAccentVar,
          }}
          title={`Role: ${role.label}`}
        >
          {role.label}
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setMenuOpen((open) => !open)
            }}
            aria-label={`${agent.name} controls`}
            aria-expanded={menuOpen}
            className="inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--mc-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              color: 'var(--mc-text-dim)',
              ...ringStyle,
            }}
          >
            ⋯
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label="Close controls"
                className="fixed inset-0 z-40"
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuOpen(false)
                }}
              />
              <div
                className="absolute right-0 top-9 z-50 w-44 overflow-hidden rounded border p-1 font-mono shadow-xl"
                style={{
                  borderColor: 'var(--mc-border-bright)',
                  background: 'var(--mc-surface)',
                  boxShadow: '0 12px 32px -12px rgba(0,0,0,0.8)',
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setMenuOpen(false)
                    handleSteerIntent()
                  }}
                  className="flex w-full items-center rounded px-2.5 py-1.5 text-left text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    color: 'var(--mc-text)',
                    ...ringStyle,
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'var(--mc-cyan-soft)'
                    event.currentTarget.style.color = 'var(--mc-cyan)'
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent'
                    event.currentTarget.style.color = 'var(--mc-text)'
                  }}
                >
                  Steer
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handlePauseToggle()
                  }}
                  disabled={pausePending}
                  className="flex w-full items-center rounded px-2.5 py-1.5 text-left text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
                  style={{
                    color: 'var(--mc-text)',
                    ...ringStyle,
                  }}
                  onMouseEnter={(event) => {
                    if (event.currentTarget.disabled) return
                    event.currentTarget.style.background =
                      'var(--mc-amber-soft)'
                    event.currentTarget.style.color = 'var(--mc-amber)'
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent'
                    event.currentTarget.style.color = 'var(--mc-text)'
                  }}
                >
                  {pausePending
                    ? isPaused
                      ? 'Resuming…'
                      : 'Pausing…'
                    : isPaused
                      ? 'Resume'
                      : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setMenuOpen(false)
                    handleKillIntent()
                  }}
                  className="flex w-full items-center rounded px-2.5 py-1.5 text-left text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    color: 'var(--mc-rose)',
                    ...ringStyle,
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'var(--mc-rose-soft)'
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent'
                  }}
                >
                  Kill
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* body: status + role */}
      <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-surface-2)',
              color: 'var(--mc-text-dim)',
            }}
          >
            <span style={{ color: status.dot }}>{status.label}</span>
          </span>
          {agent.friendlyId ? (
            <span
              className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{
                borderColor: 'var(--mc-border)',
                background: 'var(--mc-surface-2)',
                color: 'var(--mc-text-dimmer)',
              }}
              title={agent.friendlyId}
            >
              {agent.friendlyId}
            </span>
          ) : null}
        </div>
        {agent.role && agent.role !== role.label ? (
          <p
            className="line-clamp-2 text-[11px] leading-snug"
            style={{ color: 'var(--mc-text-dim)' }}
            title={agent.role}
          >
            {agent.role}
          </p>
        ) : null}
        {notice ? (
          <p
            className="font-mono text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--mc-amber)' }}
          >
            {notice}
          </p>
        ) : null}
      </div>

      {/* action row */}
      <div
        className="grid grid-cols-4 gap-1.5 border-t px-3 py-2"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void onChat(agent)
          }}
          className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-cyan)',
            ...ringStyle,
          }}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleSteerIntent()
          }}
          className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text-dim)',
            ...ringStyle,
          }}
        >
          Steer
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onHistory(agent)
          }}
          className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text-dim)',
            ...ringStyle,
          }}
        >
          History
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void onSpawn(agent)
          }}
          disabled={isSpawning}
          className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: 'var(--mc-border-bright)',
            background: 'var(--mc-cyan-soft)',
            color: 'var(--mc-cyan)',
            ...ringStyle,
          }}
        >
          {isSpawning ? '…' : 'Spawn'}
        </button>
      </div>

      <SteerModal
        open={steerOpen}
        onOpenChange={setSteerOpen}
        agentName={agent.name}
        sessionKey={agent.sessionKey}
      />

      <KillConfirmDialog
        open={killOpen}
        onOpenChange={setKillOpen}
        agentName={agent.name}
        sessionKey={agent.sessionKey}
        onKilled={() => onKilled(agent)}
      />
    </article>
  )
}

export function AgentsScreen({
  variant = 'mission-control',
}: AgentsScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const missionControlEnabled = variant === 'mission-control'
  const [optimisticPausedByAgentId, setOptimisticPausedByAgentId] = useState<
    Record<string, boolean>
  >({})
  const [optimisticPausedByControlKey, setOptimisticPausedByControlKey] =
    useState<Record<string, boolean>>({})
  const [spawningByAgentId, setSpawningByAgentId] = useState<
    Record<string, boolean>
  >({})
  const [historyAgentId, setHistoryAgentId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState('overview')
  const [agentConfigDraft, setAgentConfigDraft] =
    useState<AgentConfigDraft | null>(null)

  // Mobile detection for pull-to-refresh
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  // Pull-to-refresh: attach to the scrollable <main> in workspace-shell
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = document.querySelector(
      'main[data-tour="chat-area"]',
    ) as HTMLElement | null
    scrollContainerRef.current = el
  }, [])

  // handlePullRefresh defined after queries (see below)

  const agentsQuery = useQuery({
    queryKey: ['gateway', 'agents'],
    queryFn: async () => {
      const res = await fetch('/api/gateway/agents')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Gateway error')
      return json.data as AgentsData
    },
    refetchInterval: 15_000,
    retry: 1,
  })

  const sessionsQuery = useQuery({
    queryKey: ['agent-registry', 'sessions'],
    queryFn: async () => {
      const res = await fetch('/api/sessions')
      if (!res.ok) return [] as Array<SessionEntry>
      const payload = (await res.json()) as { sessions?: Array<SessionEntry> }
      return Array.isArray(payload.sessions) ? payload.sessions : []
    },
    refetchInterval: 10_000,
    retry: false,
  })

  const cronJobsQuery = useQuery({
    queryKey: ['cron', 'jobs'],
    queryFn: fetchCronJobs,
    staleTime: 30_000,
    retry: 1,
  })

  const handlePullRefresh = useCallback(() => {
    void agentsQuery.refetch()
    void sessionsQuery.refetch()
  }, [agentsQuery, sessionsQuery])

  const {
    isPulling: agentHubPulling,
    pullDistance: agentHubPullDistance,
    threshold: agentHubThreshold,
  } = usePullToRefresh(isMobile, handlePullRefresh, scrollContainerRef)

  useEffect(() => {
    if (!sessionsQuery.isSuccess) return

    setOptimisticPausedByAgentId((previous) => {
      if (Object.keys(previous).length === 0) return previous
      return {}
    })
    setOptimisticPausedByControlKey((previous) => {
      if (Object.keys(previous).length === 0) return previous
      return {}
    })
  }, [sessionsQuery.dataUpdatedAt, sessionsQuery.isSuccess])

  const parsedDefinitions = useMemo(
    () => parseAgentDefinitions(agentsQuery.data),
    [agentsQuery.data],
  )

  const usingFallbackRegistry =
    !agentsQuery.isLoading && parsedDefinitions === null

  const registryDefinitions = useMemo(() => {
    const merged = new Map<string, AgentDefinition>()

    FALLBACK_AGENT_REGISTRY.forEach((definition) => {
      merged.set(definition.id, definition)
    })
    ;(parsedDefinitions ?? []).forEach((definition) => {
      const existing = merged.get(definition.id)
      if (!existing) {
        merged.set(definition.id, definition)
        return
      }

      merged.set(definition.id, {
        ...existing,
        ...definition,
        aliases: dedupe([...existing.aliases, ...definition.aliases]),
      })
    })

    return Array.from(merged.values())
  }, [parsedDefinitions])

  const runtimeAgents = useMemo(() => {
    const sessions = Array.isArray(sessionsQuery.data) ? sessionsQuery.data : []

    return registryDefinitions.map((definition) => {
      const matchedSessions = sessions
        .map((session) => {
          const score = scoreSessionMatch(definition, session)
          return {
            session,
            score,
            updatedAt: readTimestamp(session.updatedAt),
          }
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score
          return right.updatedAt - left.updatedAt
        })
        .map((candidate) => candidate.session)

      const primarySession = matchedSessions[0]
      const hasOverride = Object.prototype.hasOwnProperty.call(
        optimisticPausedByAgentId,
        definition.id,
      )
      const sessionKey = readString(primarySession?.key)
      const controlKey = sessionKey || definition.id
      const hasControlOverride = Object.prototype.hasOwnProperty.call(
        optimisticPausedByControlKey,
        controlKey,
      )
      const pausedOverride = hasControlOverride
        ? optimisticPausedByControlKey[controlKey]
        : hasOverride
          ? optimisticPausedByAgentId[definition.id]
          : undefined

      const friendlyId = getSessionFriendlyId(primarySession)
      const status = deriveAgentStatus(primarySession, pausedOverride)

      return {
        id: definition.id,
        name: definition.name,
        role: definition.role,
        category: definition.category,
        color: definition.color,
        status,
        sessionKey: sessionKey || undefined,
        friendlyId: friendlyId || undefined,
        controlKey,
        matchedSessions,
      } satisfies AgentRuntime
    })
  }, [
    registryDefinitions,
    sessionsQuery.data,
    optimisticPausedByAgentId,
    optimisticPausedByControlKey,
  ])

  const unmatchedSessions = useMemo(() => {
    const sessions = Array.isArray(sessionsQuery.data) ? sessionsQuery.data : []
    const matchedSessionKeys = new Set<string>()

    runtimeAgents.forEach((agent) => {
      agent.matchedSessions.forEach((session) => {
        const sessionKey = readString(session.key)
        if (sessionKey) matchedSessionKeys.add(sessionKey)
      })
    })

    const cutoff = Date.now() - 10 * 60_000

    return sessions
      .filter((session) => {
        const sessionKey = readString(session.key)
        if (!sessionKey || matchedSessionKeys.has(sessionKey)) return false
        if (!sessionKey.includes('subagent:')) return false
        return readTimestamp(session.updatedAt) >= cutoff
      })
      .sort(
        (left, right) =>
          readTimestamp(right.updatedAt) - readTimestamp(left.updatedAt),
      )
  }, [runtimeAgents, sessionsQuery.data])

  const groupedSections = useMemo(() => {
    const grouped = new Map<string, Array<AgentRuntime>>()

    runtimeAgents.forEach((agent) => {
      const existing = grouped.get(agent.category) ?? []
      existing.push(agent)
      grouped.set(agent.category, existing)
    })

    const orderedCategories = [
      ...CATEGORY_ORDER.filter((category) => grouped.has(category)),
      ...Array.from(grouped.keys())
        .filter((category) => !CATEGORY_ORDER.includes(category as never))
        .sort((left, right) => left.localeCompare(right)),
    ]

    return orderedCategories.map((category) => {
      const agentsInCategory = (grouped.get(category) ?? []).sort(
        (left, right) => {
          const leftPriority = STATUS_SORT_ORDER[left.status] ?? 9
          const rightPriority = STATUS_SORT_ORDER[right.status] ?? 9
          if (leftPriority !== rightPriority)
            return leftPriority - rightPriority
          return left.name.localeCompare(right.name)
        },
      )

      return {
        category,
        agents: agentsInCategory,
      }
    })
  }, [runtimeAgents])

  const selectedHistoryAgent = useMemo(
    () => runtimeAgents.find((agent) => agent.id === historyAgentId) ?? null,
    [historyAgentId, runtimeAgents],
  )

  const selectedConfigAgent = useMemo(
    () => runtimeAgents.find((agent) => agent.id === selectedAgentId) ?? null,
    [runtimeAgents, selectedAgentId],
  )

  const selectedDefinition = useMemo(
    () =>
      registryDefinitions.find((agent) => agent.id === selectedAgentId) ?? null,
    [registryDefinitions, selectedAgentId],
  )

  const agentConfigQuery = useQuery({
    queryKey: ['gateway', 'agents', 'config', selectedAgentId],
    enabled: Boolean(selectedAgentId),
    queryFn: () => fetchAgentConfig(selectedAgentId as string),
    retry: false,
  })

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentConfigDraft(null)
      return
    }
    if (!agentConfigQuery.data) return
    setAgentConfigDraft(buildAgentConfigDraft(agentConfigQuery.data))
  }, [agentConfigQuery.data, selectedAgentId])

  useEffect(() => {
    setDetailTab('overview')
  }, [selectedAgentId])

  const saveAgentConfigMutation = useMutation({
    mutationFn: async ({
      agentId,
      config,
    }: {
      agentId: string
      config: AgentConfigPatchPayload
    }) => patchAgentConfig(agentId, config),
    onSuccess: async (_, variables) => {
      toast('Agent config saved', { type: 'success' })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['gateway', 'agents', 'config', variables.agentId],
        }),
        queryClient.invalidateQueries({ queryKey: ['gateway', 'agents'] }),
      ])
    },
    onError: (error) => {
      toast(
        error instanceof Error ? error.message : 'Failed to save agent config',
        {
          type: 'error',
        },
      )
    },
  })

  const selectedCronJobs = useMemo(() => {
    const jobs = Array.isArray(cronJobsQuery.data) ? cronJobsQuery.data : []
    return jobs.filter((job) =>
      matchesAgentCronJob(job, selectedDefinition, selectedConfigAgent),
    )
  }, [cronJobsQuery.data, selectedConfigAgent, selectedDefinition])

  const selectedAgentConfig = agentConfigQuery.data
  const draftSnapshot = serializeAgentConfigDraft(agentConfigDraft)
  const configSnapshot = useMemo(
    () =>
      serializeAgentConfigDraft(
        selectedAgentConfig ? buildAgentConfigDraft(selectedAgentConfig) : null,
      ),
    [selectedAgentConfig],
  )
  const isConfigDirty =
    Boolean(agentConfigDraft && selectedAgentConfig) &&
    draftSnapshot !== configSnapshot

  const modelOverrideOptions = useMemo(() => {
    const values = dedupe([
      selectedAgentConfig?.primaryModel ?? '',
      ...(selectedAgentConfig?.fallbackModels ?? []),
      agentConfigDraft?.modelOverride ?? '',
      selectedConfigAgent?.matchedSessions[0]
        ? getSessionModelName(selectedConfigAgent.matchedSessions[0])
        : '',
    ]).filter((value) => value.length > 0)

    return values
  }, [
    agentConfigDraft?.modelOverride,
    selectedAgentConfig,
    selectedConfigAgent,
  ])

  async function spawnSessionForAgent(
    agent: AgentRegistryCardData,
  ): Promise<{ sessionKey: string; friendlyId: string } | null> {
    if (spawningByAgentId[agent.id]) return null

    setSpawningByAgentId((previous) => ({ ...previous, [agent.id]: true }))

    try {
      const baseFriendlyId = normalizeToken(agent.id || agent.name || 'agent')
      const friendlyId = `${baseFriendlyId}-${Math.random().toString(36).slice(2, 8)}`

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          friendlyId,
          label: agent.name,
        }),
      })

      if (!response.ok) {
        throw new Error(await readResponseError(response))
      }

      const payload = (await response.json()) as {
        sessionKey?: string
        friendlyId?: string
      }

      const sessionKey = readString(payload.sessionKey)
      const resolvedFriendlyId =
        readString(payload.friendlyId) || deriveFriendlyIdFromKey(sessionKey)

      if (!sessionKey || !resolvedFriendlyId) {
        throw new Error('Failed to create a session for this agent')
      }

      toast(`${agent.name} session started`, { type: 'success' })
      void sessionsQuery.refetch()

      return { sessionKey, friendlyId: resolvedFriendlyId }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to spawn agent session'
      toast(message, { type: 'error' })
      return null
    } finally {
      setSpawningByAgentId((previous) => {
        const next = { ...previous }
        delete next[agent.id]
        return next
      })
    }
  }

  async function handleChat(agent: AgentRegistryCardData) {
    const existingFriendlyId =
      readString(agent.friendlyId) ||
      deriveFriendlyIdFromKey(readString(agent.sessionKey))

    if (existingFriendlyId) {
      void navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: existingFriendlyId },
      })
      return
    }

    const spawned = await spawnSessionForAgent(agent)
    if (!spawned) return

    void navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: spawned.friendlyId },
    })
  }

  async function handleSpawn(agent: AgentRegistryCardData) {
    await spawnSessionForAgent(agent)
  }

  function handleHistory(agent: AgentRegistryCardData) {
    setHistoryAgentId(agent.id)
  }

  async function handlePauseToggle(
    agent: AgentRegistryCardData,
    nextPaused: boolean,
  ) {
    const controlKey = readString(agent.controlKey)
    if (!controlKey) {
      toast('No control key available for this agent', { type: 'warning' })
      return
    }

    const hadPrevious = Object.prototype.hasOwnProperty.call(
      optimisticPausedByAgentId,
      agent.id,
    )
    const previousValue = optimisticPausedByAgentId[agent.id]
    const hadControlPrevious = Object.prototype.hasOwnProperty.call(
      optimisticPausedByControlKey,
      controlKey,
    )
    const previousControlValue = optimisticPausedByControlKey[controlKey]

    setOptimisticPausedByAgentId((previous) => ({
      ...previous,
      [agent.id]: nextPaused,
    }))
    setOptimisticPausedByControlKey((previous) => ({
      ...previous,
      [controlKey]: nextPaused,
    }))

    try {
      const payload = await toggleAgentPause(controlKey, nextPaused)
      const paused =
        typeof payload.paused === 'boolean' ? payload.paused : nextPaused

      setOptimisticPausedByAgentId((previous) => ({
        ...previous,
        [agent.id]: paused,
      }))
      setOptimisticPausedByControlKey((previous) => ({
        ...previous,
        [controlKey]: paused,
      }))

      toast(`${agent.name} ${paused ? 'paused' : 'resumed'}`, {
        type: 'success',
      })
      void sessionsQuery.refetch()
    } catch (error) {
      setOptimisticPausedByAgentId((previous) => {
        const next = { ...previous }
        if (hadPrevious) {
          next[agent.id] = previousValue
        } else {
          delete next[agent.id]
        }
        return next
      })
      setOptimisticPausedByControlKey((previous) => {
        const next = { ...previous }
        if (hadControlPrevious) {
          next[controlKey] = previousControlValue
        } else {
          delete next[controlKey]
        }
        return next
      })

      const message =
        error instanceof Error
          ? error.message
          : `Failed to ${nextPaused ? 'pause' : 'resume'} agent`
      toast(message, { type: 'error' })
    }
  }

  function handleOpenAgentConfig(agent: AgentRegistryCardData) {
    setSelectedAgentId(agent.id)
    setDetailTab('overview')
  }

  function handleCloseAgentConfig() {
    setSelectedAgentId(null)
    setAgentConfigDraft(null)
  }

  function handleReloadAgentConfig() {
    if (!selectedAgentId) return
    void agentConfigQuery.refetch()
  }

  function handleSaveAgentConfig() {
    if (!selectedAgentId || !agentConfigDraft) return
    void saveAgentConfigMutation.mutateAsync({
      agentId: selectedAgentId,
      config: buildAgentConfigPatchPayload(agentConfigDraft),
    })
  }

  function handleToolToggle(toolId: string, enabled: boolean) {
    setAgentConfigDraft((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        tools: {
          ...previous.tools,
          [toolId]: enabled,
        },
      }
    })
  }

  function handleSkillToggle(skillId: string, enabled: boolean) {
    setAgentConfigDraft((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        skills: {
          ...previous.skills,
          [skillId]: enabled,
        },
      }
    })
  }

  function handleChannelToggle(channelId: string, enabled: boolean) {
    setAgentConfigDraft((previous) => {
      if (!previous) return previous
      const current = previous.channels[channelId]
      if (!current) return previous
      return {
        ...previous,
        channels: {
          ...previous.channels,
          [channelId]: {
            ...current,
            enabled,
          },
        },
      }
    })
  }

  function handleKilled(agent: AgentRegistryCardData) {
    setOptimisticPausedByAgentId((previous) => {
      const next = { ...previous }
      delete next[agent.id]
      return next
    })
    setOptimisticPausedByControlKey((previous) => {
      const controlKey = readString(agent.controlKey)
      if (!controlKey) return previous
      const next = { ...previous }
      delete next[controlKey]
      return next
    })
    void sessionsQuery.refetch()
  }

  const [registryFilter, setRegistryFilter] = useState<RegistryFilter>('all')

  const agentHubPullIndicatorStyle = agentHubPulling
    ? {
        transform: `translateY(${Math.min(agentHubPullDistance - 8, 48)}px)`,
        opacity: Math.min(agentHubPullDistance / agentHubThreshold, 1),
      }
    : undefined

  if (missionControlEnabled) {
    return (
      <div className="relative flex min-h-full flex-col overflow-x-hidden md:h-full md:min-h-0 md:bg-surface">
        {/* Pull-to-refresh indicator (mobile) */}
        {isMobile && agentHubPulling ? (
          <div
            className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 transition-all duration-150"
            style={agentHubPullIndicatorStyle}
            aria-hidden
          >
            <div className="flex items-center gap-1.5 rounded-full border border-primary-200 bg-white/90 px-3 py-1.5 shadow-md backdrop-blur-sm dark:border-primary-700 dark:bg-primary-900/90">
              <span
                className={[
                  'size-3 rounded-full border-2 border-accent-500',
                  agentHubPullDistance >= agentHubThreshold
                    ? 'border-t-transparent animate-spin'
                    : 'opacity-50',
                ].join(' ')}
              />
              <span className="text-xs font-medium text-primary-600 dark:text-primary-300">
                {agentHubPullDistance >= agentHubThreshold
                  ? 'Release to refresh'
                  : 'Pull to refresh'}
              </span>
            </div>
          </div>
        ) : null}
        {usingFallbackRegistry ? (
          <div className="border-b border-amber-300/50 bg-amber-50/70 px-6 py-2 text-xs font-medium text-amber-300 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
            Gateway registry unavailable. Showing fallback definitions.
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <AgentHubLayout agents={runtimeAgents} />
        </div>
      </div>
    )
  }

  // ─── Registry variant (MC-themed) ──────────────────────────────────────────
  // Counts feed the status bar + KPI tiles + filter chips. All derived from
  // runtimeAgents — no fabricated metrics, '—' rendered when zero/loading.
  const totalRosterCount = runtimeAgents.length
  const availableCount = runtimeAgents.filter(
    (a) => a.status === 'available',
  ).length
  const idleCount = runtimeAgents.filter((a) => a.status === 'idle').length
  // Treat 'active' (running a session) as busy. The registry status enum has
  // no 'errored' state — 'paused' is the closest signal an operator can act
  // on, so it surfaces as "Errored" in the bar/KPIs.
  const busyCount = runtimeAgents.filter((a) => a.status === 'active').length
  const erroredCount = runtimeAgents.filter((a) => a.status === 'paused').length

  const filteredSections = groupedSections.map((section) => ({
    category: section.category,
    agents: section.agents.filter((agent) => {
      if (registryFilter === 'all') return true
      if (registryFilter === 'available') return agent.status === 'available'
      if (registryFilter === 'idle') return agent.status === 'idle'
      if (registryFilter === 'busy') return agent.status === 'active'
      return agent.status === 'paused'
    }),
  }))
  const visibleAgentCount = filteredSections.reduce(
    (sum, section) => sum + section.agents.length,
    0,
  )

  return (
    <main
      className="relative min-h-full px-3 pb-24 pt-5 md:px-5 md:pt-8"
      style={{
        background:
          'radial-gradient(ellipse at top, rgba(0,229,255,0.05) 0%, transparent 60%), var(--mc-bg)',
        color: 'var(--mc-text)',
      }}
    >
      <style>{`
        @keyframes mc-event-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes mc-breathe {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>

      <section className="mx-auto w-full max-w-[1560px] space-y-4">
        <RegistryStatusBar
          total={totalRosterCount}
          available={availableCount}
          idle={idleCount}
          busy={busyCount}
          errored={erroredCount}
          isLoading={agentsQuery.isLoading && !agentsQuery.data}
          isError={agentsQuery.isError}
          isSyncing={agentsQuery.isFetching && !agentsQuery.isLoading}
          updatedAt={
            agentsQuery.dataUpdatedAt ? agentsQuery.dataUpdatedAt : null
          }
        />

        {usingFallbackRegistry ? (
          <div
            className="rounded-lg border px-3 py-2 font-mono text-[11px] uppercase tracking-wider"
            style={{
              borderColor: 'var(--mc-amber)',
              background: 'var(--mc-amber-soft)',
              color: 'var(--mc-amber)',
            }}
          >
            Gateway registry unavailable · showing fallback definitions
          </div>
        ) : null}

        {/* KPI tiles */}
        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <KpiTile
            label="Available"
            value={agentsQuery.isLoading ? '—' : availableCount || '—'}
            sub={
              totalRosterCount > 0
                ? `of ${totalRosterCount} agent${totalRosterCount === 1 ? '' : 's'}`
                : 'no roster yet'
            }
            accent="cyan"
          />
          <KpiTile
            label="Idle"
            value={agentsQuery.isLoading ? '—' : idleCount || '—'}
            sub={idleCount === 0 ? 'all engaged' : 'standby pool'}
            accent="amber"
          />
          <KpiTile
            label="Busy"
            value={agentsQuery.isLoading ? '—' : busyCount || '—'}
            sub={
              busyCount === 0
                ? 'no live sessions'
                : `${busyCount === 1 ? 'session' : 'sessions'} in flight`
            }
            accent="emerald"
          />
          <KpiTile
            label="Errored"
            value={agentsQuery.isLoading ? '—' : erroredCount || '—'}
            sub={erroredCount === 0 ? 'clean' : 'paused / needs attention'}
            accent="rose"
          />
        </section>

        {/* filter chip row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <McSectionLabel>
            Roster · {visibleAgentCount}
            {registryFilter !== 'all' ? `/${totalRosterCount || '—'}` : ''}
          </McSectionLabel>
          <div
            className="inline-flex flex-wrap items-center gap-1 rounded-md border p-0.5"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-surface-2)',
            }}
            role="toolbar"
            aria-label="Agent filter"
          >
            <FilterChip
              label="All"
              count={totalRosterCount}
              active={registryFilter === 'all'}
              onClick={() => setRegistryFilter('all')}
            />
            <FilterChip
              label="Available"
              count={availableCount}
              active={registryFilter === 'available'}
              onClick={() => setRegistryFilter('available')}
              accent="cyan"
            />
            <FilterChip
              label="Idle"
              count={idleCount}
              active={registryFilter === 'idle'}
              onClick={() => setRegistryFilter('idle')}
              accent="amber"
            />
            <FilterChip
              label="Busy"
              count={busyCount}
              active={registryFilter === 'busy'}
              onClick={() => setRegistryFilter('busy')}
              accent="emerald"
            />
            <FilterChip
              label="Errored"
              count={erroredCount}
              active={registryFilter === 'errored'}
              onClick={() => setRegistryFilter('errored')}
              accent="rose"
            />
          </div>
        </div>

        {/* roster */}
        {agentsQuery.isLoading && !agentsQuery.data ? (
          <section
            className="rounded-lg border px-6 py-12 text-center font-mono text-xs uppercase tracking-wider"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-surface)',
              color: 'var(--mc-text-dim)',
            }}
          >
            <span
              style={{ animation: 'mc-breathe 1.6s ease-in-out infinite' }}
              className="motion-reduce:[animation:none!important]"
            >
              Loading registry…
            </span>
          </section>
        ) : registryDefinitions.length === 0 ? (
          <section
            className="rounded-lg border px-6 py-10"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-surface)',
            }}
          >
            <p
              className="font-mono text-[11px] uppercase tracking-[0.22em]"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              No agents registered
            </p>
            <h2
              className="mt-2 font-mono text-lg font-semibold"
              style={{ color: 'var(--mc-text)' }}
            >
              Add your first agent
            </h2>
            <ul
              className="mt-3 space-y-1 text-[12px]"
              style={{ color: 'var(--mc-text-dim)' }}
            >
              <li>— Create an agent profile</li>
              <li>— Connect a gateway</li>
              <li>— Spawn your first session</li>
            </ul>
            <button
              type="button"
              onClick={() => {
                void navigate({ to: '/settings' })
              }}
              className="mt-5 inline-flex items-center rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                borderColor: 'var(--mc-border-bright)',
                background: 'var(--mc-cyan-soft)',
                color: 'var(--mc-cyan)',
                ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
              }}
            >
              Open Settings
            </button>
          </section>
        ) : (
          <div className="space-y-5">
            {filteredSections.map((section) => (
              <section key={section.category} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <McSectionLabel>
                    — {section.category} ·{' '}
                    {
                      groupedSections.find(
                        (g) => g.category === section.category,
                      )?.agents.length
                    }
                  </McSectionLabel>
                  {registryFilter !== 'all' &&
                  section.agents.length === 0 ? null : (
                    <span
                      className="font-mono text-[10px] tabular-nums"
                      style={{ color: 'var(--mc-text-dimmer)' }}
                    >
                      {section.agents.length} shown
                    </span>
                  )}
                </div>

                {section.agents.length === 0 ? (
                  <div
                    className="rounded-md border border-dashed px-4 py-6 text-center font-mono text-[11px] uppercase tracking-wider"
                    style={{
                      borderColor: 'var(--mc-border)',
                      background: 'var(--mc-surface-2)',
                      color: 'var(--mc-text-dimmer)',
                    }}
                  >
                    — No agents in this tier
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {section.agents.map((agent) => (
                      <RegistryAgentCard
                        key={agent.id}
                        agent={agent}
                        isSpawning={Boolean(spawningByAgentId[agent.id])}
                        onTap={handleOpenAgentConfig}
                        onChat={handleChat}
                        onSpawn={handleSpawn}
                        onHistory={handleHistory}
                        onPauseToggle={handlePauseToggle}
                        onKilled={handleKilled}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}

            {unmatchedSessions.length > 0 && registryFilter === 'all' ? (
              <section className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <McSectionLabel>
                    — Active Sessions · {unmatchedSessions.length}
                  </McSectionLabel>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {unmatchedSessions.map((session, index) => {
                    const sessionKey = readString(session.key)
                    const sessionTarget =
                      getSessionFriendlyId(session) || sessionKey
                    const sessionModel = getSessionModelName(session)
                    const sessionStatus = readString(session.status) || 'active'

                    return (
                      <article
                        key={`${sessionKey}-${index}`}
                        className="overflow-hidden rounded-lg border"
                        style={{
                          borderColor: 'var(--mc-border)',
                          background: 'var(--mc-surface)',
                        }}
                      >
                        <div
                          className="flex items-center gap-2 border-b px-3 py-2"
                          style={{ borderColor: 'var(--mc-border)' }}
                        >
                          <span
                            aria-hidden="true"
                            className="motion-reduce:[animation:none!important] inline-flex h-2 w-2 shrink-0 rounded-full"
                            style={{
                              background: 'var(--mc-emerald)',
                              boxShadow: '0 0 8px var(--mc-emerald-soft)',
                              animation: 'mc-breathe 1.6s ease-in-out infinite',
                            }}
                          />
                          <h3
                            className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--mc-text)' }}
                            title={getSessionTitle(session)}
                          >
                            {getSessionTitle(session)}
                          </h3>
                          <span
                            className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              borderColor: 'var(--mc-border)',
                              background: 'var(--mc-emerald-soft)',
                              color: 'var(--mc-emerald)',
                            }}
                          >
                            {sessionStatus}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2 px-3 py-2.5">
                          <p
                            className="truncate font-mono text-[10px]"
                            style={{ color: 'var(--mc-text-dimmer)' }}
                            title={sessionKey}
                          >
                            {sessionKey}
                          </p>
                          <div
                            className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider"
                            style={{ color: 'var(--mc-text-dim)' }}
                          >
                            {sessionModel ? (
                              <span className="truncate">
                                {formatModelName(sessionModel)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--mc-text-dimmer)' }}>
                                —
                              </span>
                            )}
                            <span>
                              {formatTokenCount(getSessionTokenCount(session))}{' '}
                              tok
                            </span>
                            <span>{formatRelativeTime(session.updatedAt)}</span>
                          </div>
                        </div>
                        {sessionTarget ? (
                          <div
                            className="border-t px-3 py-2"
                            style={{ borderColor: 'var(--mc-border)' }}
                          >
                            <a
                              href={`/chat/${encodeURIComponent(sessionTarget)}`}
                              className="inline-flex w-full items-center justify-center rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                              style={{
                                borderColor: 'var(--mc-border-bright)',
                                background: 'var(--mc-cyan-soft)',
                                color: 'var(--mc-cyan)',
                                ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                                ['--tw-ring-offset-color' as string]:
                                  'var(--mc-bg)',
                              }}
                            >
                              Open Chat
                            </a>
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </section>

      {selectedConfigAgent ? (
        <div className="fixed inset-0 z-[95]">
          <button
            type="button"
            aria-label="Close agent config"
            className="absolute inset-0 bg-primary-950/25 backdrop-blur-sm"
            onClick={handleCloseAgentConfig}
          />

          <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col border-l border-primary-200 bg-surface shadow-2xl">
            <header className="border-b border-primary-200 bg-primary-50/85 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-500">
                    Agent Config
                  </p>
                  <h2 className="mt-1 truncate text-xl font-semibold text-primary-900">
                    {selectedConfigAgent.name}
                  </h2>
                  <p className="mt-1 text-sm text-primary-600">
                    {selectedAgentConfig?.name &&
                    selectedAgentConfig.name !== selectedConfigAgent.name
                      ? `${selectedConfigAgent.role} · ${selectedAgentConfig.name}`
                      : selectedConfigAgent.role}
                  </p>
                  {selectedAgentConfig?.warning ? (
                    <p className="mt-2 text-xs font-medium text-amber-300">
                      {selectedAgentConfig.warning}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReloadAgentConfig}
                    disabled={agentConfigQuery.isFetching}
                  >
                    Reload
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveAgentConfig}
                    disabled={
                      !agentConfigDraft ||
                      !selectedAgentConfig ||
                      selectedAgentConfig.readOnly ||
                      !selectedAgentConfig.supportsPatch ||
                      !isConfigDirty ||
                      saveAgentConfigMutation.isPending
                    }
                  >
                    {saveAgentConfigMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCloseAgentConfig}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {agentConfigQuery.isLoading && !selectedAgentConfig ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="flex items-center gap-2 text-primary-500">
                    <div className="size-4 animate-spin rounded-full border-2 border-primary-300 border-t-primary-600" />
                    <span className="text-sm">Loading agent config...</span>
                  </div>
                </div>
              ) : agentConfigQuery.isError && !selectedAgentConfig ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-50 px-4 py-3 text-sm text-red-400">
                  {agentConfigQuery.error instanceof Error
                    ? agentConfigQuery.error.message
                    : 'Failed to load agent config'}
                </div>
              ) : (
                <Tabs value={detailTab} onValueChange={setDetailTab}>
                  <TabsList className="mb-5 flex w-full flex-wrap gap-2 rounded-2xl border border-primary-200 bg-white p-1 text-primary-500 shadow-sm">
                    <TabsTrigger
                      value="overview"
                      className="min-w-[110px] flex-1"
                    >
                      Overview
                    </TabsTrigger>
                    <TabsTrigger value="tools" className="min-w-[92px] flex-1">
                      Tools
                    </TabsTrigger>
                    <TabsTrigger value="skills" className="min-w-[92px] flex-1">
                      Skills
                    </TabsTrigger>
                    <TabsTrigger
                      value="channels"
                      className="min-w-[102px] flex-1"
                    >
                      Channels
                    </TabsTrigger>
                    <TabsTrigger value="cron" className="min-w-[102px] flex-1">
                      Cron Jobs
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-primary-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                          Agent ID
                        </p>
                        <p className="mt-2 text-sm font-medium text-primary-900">
                          {selectedConfigAgent.id}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-primary-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                          Name
                        </p>
                        <p className="mt-2 text-sm font-medium text-primary-900">
                          {selectedAgentConfig?.name ||
                            selectedConfigAgent.name}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-primary-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                          Workspace Path
                        </p>
                        <p className="mt-2 break-all text-sm font-medium text-primary-900">
                          {selectedAgentConfig?.workspacePath || 'Unavailable'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-primary-200 bg-white p-4 shadow-sm">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                            Primary Model
                          </p>
                          <p className="mt-2 text-sm font-medium text-primary-900">
                            {selectedAgentConfig?.primaryModel
                              ? formatModelName(
                                  selectedAgentConfig.primaryModel,
                                )
                              : 'Unavailable'}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                            Fallbacks
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(selectedAgentConfig?.fallbackModels ?? [])
                              .length > 0 ? (
                              selectedAgentConfig?.fallbackModels.map(
                                (fallback) => (
                                  <span
                                    key={fallback}
                                    className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700"
                                  >
                                    {formatModelName(fallback)}
                                  </span>
                                ),
                              )
                            ) : (
                              <span className="text-sm text-primary-500">
                                No fallback models
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                            Model Override
                          </span>
                          <select
                            value={agentConfigDraft?.modelOverride ?? ''}
                            disabled={
                              !agentConfigDraft ||
                              selectedAgentConfig?.readOnly ||
                              !selectedAgentConfig?.supportsPatch
                            }
                            onChange={(event) => {
                              const nextValue = event.target.value
                              setAgentConfigDraft((previous) =>
                                previous
                                  ? {
                                      ...previous,
                                      modelOverride: nextValue,
                                    }
                                  : previous,
                              )
                            }}
                            className="mt-2 h-10 w-full rounded-xl border border-primary-200 bg-primary-50 px-3 text-sm text-primary-900 outline-none transition focus:border-primary-300"
                          >
                            <option value="">Use agent default</option>
                            {modelOverrideOptions.map((option) => (
                              <option key={option} value={option}>
                                {formatModelName(option)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-600">
                          {selectedAgentConfig?.sourceMethod
                            ? `Loaded via ${selectedAgentConfig.sourceMethod}`
                            : selectedAgentConfig?.readOnly
                              ? 'Read-only fallback display'
                              : 'Config ready'}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="tools" className="space-y-3">
                    {(selectedAgentConfig?.tools ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-primary-200 bg-white px-4 py-6 text-sm text-primary-500 shadow-sm">
                        No tool policy was exposed for this agent.
                      </div>
                    ) : (
                      selectedAgentConfig?.tools.map((tool) => (
                        <div
                          key={tool.id}
                          className="flex items-center justify-between gap-4 rounded-2xl border border-primary-200 bg-white px-4 py-3 shadow-sm"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-primary-900">
                              {prettyLabel(tool.id)}
                            </p>
                            <p className="text-xs text-primary-500">
                              {tool.source === 'allowed'
                                ? 'Allowed by policy'
                                : tool.source === 'denied'
                                  ? 'Denied by policy'
                                  : tool.source === 'explicit'
                                    ? 'Explicit per-agent rule'
                                    : 'Policy source unknown'}
                            </p>
                          </div>
                          <Switch
                            checked={
                              agentConfigDraft?.tools[tool.id] ?? tool.enabled
                            }
                            disabled={
                              selectedAgentConfig.readOnly ||
                              !selectedAgentConfig.supportsPatch
                            }
                            onCheckedChange={(checked) =>
                              handleToolToggle(tool.id, Boolean(checked))
                            }
                          />
                        </div>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="skills" className="space-y-3">
                    {(selectedAgentConfig?.skills ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-primary-200 bg-white px-4 py-6 text-sm text-primary-500 shadow-sm">
                        No active skills were exposed for this agent.
                      </div>
                    ) : (
                      selectedAgentConfig?.skills.map((skill) => (
                        <div
                          key={skill.id}
                          className="flex items-center justify-between gap-4 rounded-2xl border border-primary-200 bg-white px-4 py-3 shadow-sm"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-primary-900">
                              {prettyLabel(skill.id)}
                            </p>
                            <p className="text-xs text-primary-500">
                              {skill.id}
                            </p>
                          </div>
                          <Switch
                            checked={
                              agentConfigDraft?.skills[skill.id] ??
                              skill.enabled
                            }
                            disabled={
                              selectedAgentConfig.readOnly ||
                              !selectedAgentConfig.supportsPatch
                            }
                            onCheckedChange={(checked) =>
                              handleSkillToggle(skill.id, Boolean(checked))
                            }
                          />
                        </div>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="channels" className="space-y-3">
                    {(selectedAgentConfig?.channels ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-primary-200 bg-white px-4 py-6 text-sm text-primary-500 shadow-sm">
                        No per-channel config was exposed for this agent.
                      </div>
                    ) : (
                      selectedAgentConfig?.channels.map((channel) => {
                        const draftChannel =
                          agentConfigDraft?.channels[channel.id]
                        const channelConfig =
                          draftChannel?.config ?? channel.config
                        const channelJson = safeStringify(channelConfig)
                        return (
                          <div
                            key={channel.id}
                            className="rounded-2xl border border-primary-200 bg-white p-4 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-primary-900">
                                  {prettyLabel(channel.id)}
                                </p>
                                <p className="text-xs text-primary-500">
                                  Responds on {channel.id}
                                </p>
                              </div>
                              {channel.enabled !== null ? (
                                <Switch
                                  checked={
                                    draftChannel?.enabled ?? channel.enabled
                                  }
                                  disabled={
                                    selectedAgentConfig.readOnly ||
                                    !selectedAgentConfig.supportsPatch
                                  }
                                  onCheckedChange={(checked) =>
                                    handleChannelToggle(
                                      channel.id,
                                      Boolean(checked),
                                    )
                                  }
                                />
                              ) : (
                                <span className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-medium text-primary-600">
                                  Display only
                                </span>
                              )}
                            </div>

                            <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/70 p-3">
                              {channelJson ? (
                                <pre className="overflow-x-auto text-xs leading-5 text-primary-700">
                                  {channelJson}
                                </pre>
                              ) : (
                                <p className="text-xs text-primary-500">
                                  No extra channel config provided.
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </TabsContent>

                  <TabsContent value="cron" className="space-y-3">
                    <div className="flex items-center justify-between rounded-2xl border border-primary-200 bg-white px-4 py-3 shadow-sm">
                      <div>
                        <p className="text-sm font-medium text-primary-900">
                          Assigned cron jobs
                        </p>
                        <p className="text-xs text-primary-500">
                          Matched against agent id, name, aliases, payload, and
                          delivery config.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void navigate({ to: '/cron' })}
                      >
                        Open Cron Screen
                      </Button>
                    </div>

                    {cronJobsQuery.isLoading ? (
                      <div className="rounded-2xl border border-primary-200 bg-white px-4 py-6 text-sm text-primary-500 shadow-sm">
                        Loading cron jobs...
                      </div>
                    ) : cronJobsQuery.isError ? (
                      <div className="rounded-2xl border border-red-500/30 bg-red-50 px-4 py-6 text-sm text-red-400 shadow-sm">
                        {cronJobsQuery.error instanceof Error
                          ? cronJobsQuery.error.message
                          : 'Failed to load cron jobs'}
                      </div>
                    ) : selectedCronJobs.length === 0 ? (
                      <div className="rounded-2xl border border-primary-200 bg-white px-4 py-6 text-sm text-primary-500 shadow-sm">
                        No cron jobs matched this agent.
                      </div>
                    ) : (
                      selectedCronJobs.map((job) => (
                        <div
                          key={job.id}
                          className="rounded-2xl border border-primary-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-primary-900">
                                {job.name}
                              </p>
                              <p className="mt-1 text-xs text-primary-500">
                                {job.id}
                              </p>
                            </div>
                            <span className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-medium text-primary-700">
                              {job.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 text-sm text-primary-700 md:grid-cols-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-500">
                                Schedule
                              </p>
                              <p className="mt-1">{job.schedule}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-500">
                                Status
                              </p>
                              <p className="mt-1">{job.status || 'Unknown'}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-500">
                                Last Run
                              </p>
                              <p className="mt-1">
                                {job.lastRun?.startedAt
                                  ? new Date(
                                      job.lastRun.startedAt,
                                    ).toLocaleString()
                                  : 'Never'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {selectedHistoryAgent ? (
        <div className="fixed inset-0 z-[90] md:hidden">
          <button
            type="button"
            aria-label="Close history"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setHistoryAgentId(null)}
          />

          <div className="absolute inset-x-4 top-[12vh] rounded-2xl border border-white/30 bg-white/90 p-4 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-primary-900/90">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="truncate pr-2 text-base font-bold text-primary-900 dark:text-primary-100">
                {selectedHistoryAgent.name} history
              </h3>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:border-primary-700 dark:bg-primary-800 dark:text-primary-300 dark:hover:bg-primary-700 sm:px-4 sm:py-2 sm:text-sm"
                onClick={() => setHistoryAgentId(null)}
              >
                Close
              </button>
            </div>

            {selectedHistoryAgent.matchedSessions.length === 0 ? (
              <p className="text-xs text-primary-600 dark:text-primary-300">
                No recent sessions for this agent yet.
              </p>
            ) : (
              <div className="max-h-[48vh] space-y-2 overflow-auto">
                {selectedHistoryAgent.matchedSessions
                  .slice(0, 8)
                  .map((session, index) => {
                    const friendlyId = getSessionFriendlyId(session)
                    const sessionModel = getSessionModelName(session)
                    return (
                      <div
                        key={`${readString(session.key)}-${readString(session.friendlyId)}-${index}`}
                        className="rounded-xl border border-white/30 bg-white/60 p-2.5 dark:border-white/10 dark:bg-primary-900/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-primary-900 dark:text-primary-100">
                            {getSessionTitle(session)}
                          </p>
                          <span className="text-[10px] text-primary-500 dark:text-primary-400">
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] font-medium text-primary-600 dark:text-primary-300">
                            {sessionModel
                              ? `${readString(session.status) || 'unknown'} · ${formatModelName(sessionModel)}`
                              : readString(session.status) || 'unknown'}
                          </span>
                          {friendlyId ? (
                            <button
                              type="button"
                              onClick={() => {
                                setHistoryAgentId(null)
                                void navigate({
                                  to: '/chat/$sessionKey',
                                  params: { sessionKey: friendlyId },
                                })
                              }}
                              className="min-h-11 rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-accent-700 transition-colors hover:bg-accent-50 dark:border-primary-700 dark:bg-primary-800 dark:text-accent-300 dark:hover:bg-accent-950/30 sm:px-4 sm:py-2 sm:text-sm"
                            >
                              Open Chat
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  )
}
