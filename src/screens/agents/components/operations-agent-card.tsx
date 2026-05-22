// OperationsAgentCard — enterprise fleet-console row (2026-05-19).
//
// Replaces the casual 19rem chat-hero card with a slim 14rem command row:
// status pulse + name + monospace model chip on top, description + metric
// chips in the body, collapsible inline chat at the bottom (default closed,
// last-message preview line when collapsed, persisted per-agent in
// localStorage). The expandable cron-jobs panel is preserved with a slim,
// palette-consistent toggle. All --mc-* tokens used directly.
//
// Behaviour preserved: useAgentChat, useMutation toggleCronJob / runCronJob,
// onOpenSettings prop, play/pause semantics, error toasts.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight01Icon,
  ArrowUp01Icon,
  Chat01Icon,
  Clock01Icon,
  PauseIcon,
  PlayIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/prompt-kit/markdown'
import { toast } from '@/components/ui/toast'
import { runCronJob, toggleCronJob } from '@/lib/cron-api'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/screens/dashboard/lib/formatters'
import {
  useAgentChat,
  type OperationsChatMessage,
} from '../hooks/use-agent-chat'
import type { OperationsAgent } from '../hooks/use-operations'

// ─── helpers ───────────────────────────────────────────────────────────────

type StatusTone = 'active' | 'idle' | 'error'

function getStatusTokens(status: OperationsAgent['status'], isPaused: boolean) {
  // Paused agent reads as amber/idle even if status was 'active'.
  const tone: StatusTone =
    status === 'error'
      ? 'error'
      : status === 'active' && !isPaused
        ? 'active'
        : 'idle'

  if (tone === 'error') {
    return {
      tone,
      dot: 'var(--mc-rose)',
      dotSoft: 'var(--mc-rose-soft)',
      label: 'Error',
      pulse: false,
    }
  }
  if (tone === 'active') {
    return {
      tone,
      dot: 'var(--mc-cyan)',
      dotSoft: 'var(--mc-cyan-soft)',
      label: 'Active',
      pulse: true,
    }
  }
  return {
    tone,
    dot: 'var(--mc-amber)',
    dotSoft: 'var(--mc-amber-soft)',
    label: 'Idle',
    pulse: false,
  }
}

function stripEmojiPrefix(value: string) {
  return value
    .replace(
      /^((\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Presentation}|\p{Emoji}️)(‍(\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Presentation}|\p{Emoji}️))*)\s*/u,
      '',
    )
    .trim()
}

function displayJobName(jobName: string, agentId: string) {
  const prefix = `ops:${agentId}:`
  if (jobName.startsWith(prefix)) {
    return jobName.slice(prefix.length).replace(/-/g, ' ')
  }
  return jobName
}

function describeJob(job: OperationsAgent['jobs'][number]) {
  return job.description?.trim() || job.schedule
}

function singleLinePreview(content: string, max = 96): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function chatExpandedKey(agentId: string): string {
  return `operations:agent:${agentId}:chatExpanded`
}

function readChatExpanded(agentId: string): boolean {
  if (typeof window === 'undefined') return false
  // Default COLLAPSED — first-time visitors see a compact card.
  const v = window.localStorage.getItem(chatExpandedKey(agentId))
  return v === '1'
}

// ─── tiny ui primitives (card-scoped, mirror operations-screen patterns) ───

function MetricChip({
  label,
  value,
  accent = 'cyan',
}: {
  label: string
  value: ReactNode
  accent?: 'cyan' | 'emerald' | 'amber' | 'magenta' | 'rose'
}) {
  const accentVar =
    accent === 'emerald'
      ? 'var(--mc-emerald)'
      : accent === 'amber'
        ? 'var(--mc-amber)'
        : accent === 'magenta'
          ? 'var(--mc-magenta)'
          : accent === 'rose'
            ? 'var(--mc-rose)'
            : 'var(--mc-cyan)'
  return (
    <div
      className="inline-flex items-baseline gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface-2)',
        color: 'var(--mc-text-dimmer)',
      }}
    >
      <span>{label}</span>
      <span
        className="text-[11px] font-semibold normal-case tabular-nums"
        style={{ color: accentVar }}
      >
        {value}
      </span>
    </div>
  )
}

function ModelChip({ value }: { value: string }) {
  return (
    <span
      className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface-2)',
        color: 'var(--mc-text-dim)',
      }}
      title={value}
    >
      {value}
    </span>
  )
}

// Color → role mapping mirrors ROLE_COLORS in agent-presets.ts. Renders
// a colored function/job label next to the agent name so the operator
// can see at a glance what each agent is for.
function roleFromColor(
  color: string | undefined,
): { label: string; accent: string } | null {
  if (!color) return null
  const c = color.toLowerCase().trim()
  if (c === '#00e5ff') return { label: 'Researcher', accent: 'var(--mc-cyan)' }
  if (c === '#3df5a1') return { label: 'Builder', accent: 'var(--mc-emerald)' }
  if (c === '#ff4fd8') return { label: 'Writer', accent: 'var(--mc-magenta)' }
  if (c === '#ffb547') return { label: 'Analyst', accent: 'var(--mc-amber)' }
  if (c === '#ff6b8b') return { label: 'Operator', accent: 'var(--mc-rose)' }
  return null
}

function RoleChip({ color }: { color: string | undefined }) {
  const role = roleFromColor(color)
  if (!role) return null
  return (
    <span
      className="inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
      style={{
        borderColor: role.accent,
        background: `color-mix(in srgb, ${role.accent} 12%, transparent)`,
        color: role.accent,
      }}
      title={`Role: ${role.label}`}
    >
      {role.label}
    </span>
  )
}

// ─── inline chat (collapsible, capped ~140px) ──────────────────────────────

export function OperationsInlineChat({
  agentName,
  messages,
  sendMessage,
  isSending,
  error,
}: {
  agentName: string
  messages: OperationsChatMessage[]
  sendMessage: (message: string) => Promise<unknown>
  isSending: boolean
  error: string | null
}) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const renderedMessages = useMemo(() => messages.slice(-50), [messages])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [renderedMessages])

  async function handleSend() {
    const message = draft.trim()
    if (!message || isSending) return
    await sendMessage(message)
    setDraft('')
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface-2)',
      }}
    >
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2"
        style={{ maxHeight: 140 }}
      >
        {renderedMessages.length > 0 ? (
          <div className="space-y-1.5">
            {renderedMessages.map((message) => {
              const isUser = message.role === 'user'
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex',
                    isUser ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className="max-w-[92%] rounded-md px-2 py-1.5 text-[11px] leading-relaxed"
                    style={
                      isUser
                        ? {
                            background: 'var(--mc-cyan-soft)',
                            color: 'var(--mc-text)',
                            border: '1px solid var(--mc-border-bright)',
                          }
                        : {
                            background: 'var(--mc-surface)',
                            color: 'var(--mc-text)',
                            border: '1px solid var(--mc-border)',
                          }
                    }
                  >
                    {message.role === 'assistant' ? (
                      <Markdown>{message.content}</Markdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p
            className="my-auto text-center font-mono text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--mc-text-dimmer)' }}
          >
            No messages yet
          </p>
        )}
      </div>

      <div
        className="border-t px-2 py-1.5"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        {error ? (
          <p
            className="mb-1 font-mono text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--mc-rose)' }}
          >
            {error}
          </p>
        ) : null}
        <div
          className="flex items-center gap-1.5 rounded border px-1.5 py-1"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-bg)',
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder={`Message ${stripEmojiPrefix(agentName)}…`}
            className="h-6 flex-1 bg-transparent px-1 font-mono text-[11px] outline-none"
            style={{ color: 'var(--mc-text)' }}
          />
          <Button
            size="icon-sm"
            className="h-6 w-6 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              background: 'var(--mc-cyan)',
              color: 'var(--mc-bg)',
              ['--tw-ring-color' as string]: 'var(--mc-cyan)',
              ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
            }}
            onClick={() => void handleSend()}
            disabled={!draft.trim() || isSending}
            aria-label={isSending ? 'Sending message' : 'Send message'}
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={13}
              strokeWidth={1.9}
            />
          </Button>
        </div>
      </div>
    </section>
  )
}

// ─── card ──────────────────────────────────────────────────────────────────

export function OperationsAgentCard({
  agent,
  onOpenSettings,
}: {
  agent: OperationsAgent
  onOpenSettings: (agentId: string) => void
}) {
  const queryClient = useQueryClient()
  const displayName = stripEmojiPrefix(agent.name)
  const [showCronPanel, setShowCronPanel] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [chatExpanded, setChatExpanded] = useState(() =>
    readChatExpanded(agent.id),
  )
  const { messages, sendMessage, isSending, error } = useAgentChat(
    agent.sessionKey,
  )
  const cronJobCount = agent.jobs.length
  const status = getStatusTokens(agent.status, isPaused)
  const isActive = status.tone === 'active'

  // Persist chat-expanded preference per-agent.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      chatExpandedKey(agent.id),
      chatExpanded ? '1' : '0',
    )
  }, [agent.id, chatExpanded])

  const toggleMutation = useMutation({
    mutationFn: async (payload: { jobId: string; enabled: boolean }) =>
      toggleCronJob(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['operations', 'cron'] })
    },
    onError: (mutationError) => {
      toast(
        mutationError instanceof Error
          ? mutationError.message
          : 'Failed to update cron job',
        { type: 'error' },
      )
    },
  })

  const runCronMutation = useMutation({
    mutationFn: async (jobId: string) => runCronJob(jobId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['operations', 'cron'] })
      toast('Cron job started', { type: 'success' })
    },
    onError: (mutationError) => {
      toast(
        mutationError instanceof Error
          ? mutationError.message
          : 'Failed to run cron job',
        { type: 'error' },
      )
    },
  })

  async function handlePlayPause() {
    if (isActive) {
      setIsPaused(true)
      return
    }
    setIsPaused(false)
    await sendMessage('Run your primary task now')
  }

  // Last assistant or user message preview for collapsed chat row.
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
  const lastMessagePreview = lastMessage
    ? singleLinePreview(lastMessage.content)
    : ''

  const descriptionText = agent.meta.description?.trim() || '[no description]'

  return (
    <article
      className="flex min-h-[14rem] flex-col overflow-hidden rounded-lg border"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'var(--mc-surface)',
        boxShadow:
          '0 8px 24px -16px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.01)',
      }}
    >
      {/* ─── header row ─────────────────────────────────────────────────── */}
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
          title={displayName}
        >
          {displayName}
        </h3>
        <RoleChip color={agent.meta.color} />
        {agent.shortModel ? <ModelChip value={agent.shortModel} /> : null}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={
              isActive ? `Pause ${displayName}` : `Run ${displayName} now`
            }
            title={isActive ? 'Pause' : 'Run now'}
            onClick={() => void handlePlayPause()}
            disabled={isSending && !isActive}
            className="inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--mc-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              color: isActive ? 'var(--mc-amber)' : 'var(--mc-cyan)',
              ['--tw-ring-color' as string]: 'var(--mc-cyan)',
              ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
            }}
          >
            <HugeiconsIcon
              icon={isActive ? PauseIcon : PlayIcon}
              size={14}
              strokeWidth={1.9}
            />
          </button>
          <button
            type="button"
            aria-label={`Open settings for ${displayName}`}
            title="Settings"
            onClick={() => onOpenSettings(agent.id)}
            className="inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--mc-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              color: 'var(--mc-text-dim)',
              ['--tw-ring-color' as string]: 'var(--mc-cyan)',
              ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
            }}
          >
            <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* ─── body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <p
          className={cn(
            'min-w-0 line-clamp-2 text-[11px] leading-snug',
            !agent.meta.description?.trim() && 'italic',
          )}
          style={{
            color: agent.meta.description?.trim()
              ? 'var(--mc-text-dim)'
              : 'var(--mc-text-dimmer)',
          }}
          title={descriptionText}
        >
          {descriptionText}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <MetricChip
            label="Jobs"
            value={cronJobCount > 0 ? cronJobCount : '—'}
            accent={cronJobCount > 0 ? 'cyan' : 'amber'}
          />
          {agent.nextRunAt ? (
            <MetricChip
              label="Next"
              value={formatRelativeTime(agent.nextRunAt)}
              accent="magenta"
            />
          ) : null}
          <MetricChip
            label="Last"
            value={
              agent.lastActivityAt
                ? formatRelativeTime(agent.lastActivityAt)
                : '—'
            }
            accent={agent.lastActivityAt ? 'emerald' : 'amber'}
          />
        </div>
      </div>

      {/* ─── cron jobs toggle + panel ───────────────────────────────────── */}
      <div className="px-3">
        <button
          type="button"
          onClick={() => setShowCronPanel((value) => !value)}
          aria-expanded={showCronPanel}
          aria-controls={`cron-panel-${agent.id}`}
          aria-label={
            cronJobCount > 0
              ? `${showCronPanel ? 'Hide' : 'Show'} ${cronJobCount} cron job${cronJobCount === 1 ? '' : 's'} for ${displayName}`
              : `${showCronPanel ? 'Hide' : 'Show'} cron jobs for ${displayName}`
          }
          className="inline-flex w-full items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            borderColor: showCronPanel
              ? 'var(--mc-border-bright)'
              : 'var(--mc-border)',
            background: showCronPanel
              ? 'var(--mc-cyan-soft)'
              : 'var(--mc-surface-2)',
            color: showCronPanel ? 'var(--mc-cyan)' : 'var(--mc-text-dim)',
            ['--tw-ring-color' as string]: 'var(--mc-cyan)',
            ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
          }}
        >
          <HugeiconsIcon icon={Clock01Icon} size={11} strokeWidth={2} />
          <span>Cron Jobs</span>
          <span
            className="inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] tabular-nums"
            style={{
              background: 'var(--mc-surface)',
              color: showCronPanel ? 'var(--mc-cyan)' : 'var(--mc-text-dimmer)',
            }}
          >
            {cronJobCount}
          </span>
          <HugeiconsIcon
            icon={showCronPanel ? ArrowUp01Icon : ArrowRight01Icon}
            size={11}
            strokeWidth={2}
            className="ml-auto"
          />
        </button>

        <AnimatePresence initial={false}>
          {showCronPanel ? (
            <motion.section
              key="cron-panel"
              id={`cron-panel-${agent.id}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div
                className="mt-2 rounded border px-2 py-2"
                style={{
                  borderColor: 'var(--mc-border)',
                  background: 'var(--mc-surface-2)',
                }}
              >
                {agent.jobs.length > 0 ? (
                  <>
                    <div className="max-h-[180px] space-y-1.5 overflow-y-auto pr-1">
                      {agent.jobs.map((job) => (
                        <div
                          key={job.id}
                          className="flex items-center gap-2 rounded border px-2 py-1.5"
                          style={{
                            borderColor: 'var(--mc-border)',
                            background: 'var(--mc-bg)',
                          }}
                        >
                          <label className="relative inline-flex cursor-pointer items-center">
                            <input
                              type="checkbox"
                              checked={job.enabled}
                              onChange={() =>
                                toggleMutation.mutate({
                                  jobId: job.id,
                                  enabled: !job.enabled,
                                })
                              }
                              className="peer sr-only"
                              aria-label={
                                job.enabled ? 'Disable job' : 'Enable job'
                              }
                            />
                            <span
                              className="h-4 w-7 rounded-full transition-colors"
                              style={{
                                background: job.enabled
                                  ? 'var(--mc-cyan)'
                                  : 'var(--mc-surface)',
                                border: '1px solid var(--mc-border)',
                              }}
                            />
                            <span
                              className="absolute left-[2px] top-[2px] h-3 w-3 rounded-full transition-transform peer-checked:translate-x-3"
                              style={{
                                background: job.enabled
                                  ? 'var(--mc-bg)'
                                  : 'var(--mc-text-dim)',
                              }}
                            />
                          </label>
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate font-mono text-[11px]"
                              style={{ color: 'var(--mc-text)' }}
                            >
                              {displayJobName(job.name, agent.id)}
                            </p>
                            <p
                              className="truncate text-[10px]"
                              style={{ color: 'var(--mc-text-dimmer)' }}
                            >
                              {describeJob(job)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => runCronMutation.mutate(job.id)}
                            disabled={runCronMutation.isPending}
                            className="inline-flex h-6 w-6 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            style={{
                              borderColor: 'var(--mc-border)',
                              background: 'var(--mc-surface)',
                              color: 'var(--mc-cyan)',
                              ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                              ['--tw-ring-offset-color' as string]:
                                'var(--mc-bg)',
                            }}
                            aria-label={`Run ${displayJobName(job.name, agent.id)} now`}
                          >
                            <HugeiconsIcon
                              icon={PlayIcon}
                              size={11}
                              strokeWidth={2}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <a
                        href="/cron"
                        className="inline-flex items-center rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                        style={{
                          borderColor: 'var(--mc-border)',
                          background: 'var(--mc-surface)',
                          color: 'var(--mc-text-dim)',
                          ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                          ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
                        }}
                      >
                        + Add Job
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p
                      className="font-mono text-[10px] uppercase tracking-wider"
                      style={{ color: 'var(--mc-text-dimmer)' }}
                    >
                      No scheduled jobs
                    </p>
                    <a
                      href="/cron"
                      className="inline-flex items-center rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      style={{
                        borderColor: 'var(--mc-border)',
                        background: 'var(--mc-surface)',
                        color: 'var(--mc-text-dim)',
                        ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                        ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
                      }}
                    >
                      + Add Job
                    </a>
                  </div>
                )}
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      {/* ─── chat toggle + panel ─────────────────────────────────────────── */}
      <div className="mt-auto px-3 pb-3 pt-2">
        <button
          type="button"
          onClick={() => setChatExpanded((v) => !v)}
          aria-expanded={chatExpanded}
          aria-controls={`chat-panel-${agent.id}`}
          aria-label={
            chatExpanded
              ? `Hide chat with ${displayName}`
              : `Open chat with ${displayName}`
          }
          className="inline-flex w-full items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            borderColor: chatExpanded
              ? 'var(--mc-border-bright)'
              : 'var(--mc-border)',
            background: chatExpanded
              ? 'var(--mc-cyan-soft)'
              : 'var(--mc-surface-2)',
            color: chatExpanded ? 'var(--mc-cyan)' : 'var(--mc-text-dim)',
            ['--tw-ring-color' as string]: 'var(--mc-cyan)',
            ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
          }}
        >
          <HugeiconsIcon icon={Chat01Icon} size={11} strokeWidth={2} />
          <span>Chat</span>
          {!chatExpanded && lastMessagePreview ? (
            <span
              className="ml-1 min-w-0 flex-1 truncate text-left normal-case tracking-normal"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              {lastMessagePreview}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <HugeiconsIcon
            icon={chatExpanded ? ArrowUp01Icon : ArrowRight01Icon}
            size={11}
            strokeWidth={2}
          />
        </button>

        <AnimatePresence initial={false}>
          {chatExpanded ? (
            <motion.div
              key="chat-panel"
              id={`chat-panel-${agent.id}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2">
                <OperationsInlineChat
                  agentName={agent.name}
                  messages={messages}
                  sendMessage={sendMessage}
                  isSending={isSending}
                  error={error}
                />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </article>
  )
}
