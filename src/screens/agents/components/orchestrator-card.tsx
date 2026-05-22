// Orchestrator command panel — Mission Control palette (2026-05-19).
//
// Enterprise redesign: a slim status header at top (~64px) showing live
// orchestrator identity, presence pulse, agent-count badge, and chat-panel
// toggle. The embedded ChatScreen is collapsible — defaulted OPEN at a
// compact 440px height so the operator can still type commands inline,
// but is no longer the dominating 720px hero it used to be. Toggle button
// lets the operator collapse to header-only to maximise screen for the
// agent roster + activity stream.
//
// Behaviour preserved: localStorage-backed display name with a settings
// dialog, lazy ChatScreen mount, prefers-reduced-motion safe.

import { Suspense, lazy, useEffect, useState } from 'react'
import {
  AiBrain03Icon,
  Cancel01Icon,
  Chat01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'

const ChatScreen = lazy(() =>
  import('@/screens/chat/chat-screen').then((m) => ({ default: m.ChatScreen })),
)

const ORCHESTRATOR_NAME_KEY = 'operations:orchestrator:name'
const ORCHESTRATOR_CHAT_EXPANDED_KEY = 'operations:orchestrator:chatExpanded'
const DEFAULT_ORCHESTRATOR_NAME = 'Main Agent'

function readChatExpanded(): boolean {
  if (typeof window === 'undefined') return true
  const v = window.localStorage.getItem(ORCHESTRATOR_CHAT_EXPANDED_KEY)
  // Default OPEN so first-time visitors see the chat; toggle persists.
  if (v === null) return true
  return v === '1'
}

export function OrchestratorCard({ totalAgents }: { totalAgents: number }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatExpanded, setChatExpanded] = useState(readChatExpanded)
  const [orchestratorName, setOrchestratorName] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_ORCHESTRATOR_NAME
    return (
      window.localStorage.getItem(ORCHESTRATOR_NAME_KEY) ||
      DEFAULT_ORCHESTRATOR_NAME
    )
  })
  const [draftName, setDraftName] = useState(orchestratorName)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      ORCHESTRATOR_CHAT_EXPANDED_KEY,
      chatExpanded ? '1' : '0',
    )
  }, [chatExpanded])

  const openSettings = () => {
    setDraftName(orchestratorName)
    setSettingsOpen(true)
  }

  const saveSettings = () => {
    const nextName = draftName.trim() || DEFAULT_ORCHESTRATOR_NAME
    window.localStorage.setItem(ORCHESTRATOR_NAME_KEY, nextName)
    setOrchestratorName(nextName)
    setDraftName(nextName)
    setSettingsOpen(false)
  }

  const isLive = totalAgents > 0

  return (
    <>
      <article
        className="flex flex-col overflow-hidden rounded-2xl border"
        style={{
          borderColor: 'var(--mc-border-bright)',
          borderLeftWidth: '3px',
          borderLeftColor: 'var(--mc-magenta)',
          background: 'var(--mc-surface)',
          boxShadow:
            '0 12px 40px -24px var(--mc-magenta), inset 0 0 0 1px rgba(255,79,216,0.06)',
        }}
      >
        {/* compact command header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border"
            style={{
              borderColor: 'var(--mc-border-bright)',
              background: 'var(--mc-magenta-soft)',
              color: 'var(--mc-magenta)',
            }}
          >
            <HugeiconsIcon icon={AiBrain03Icon} size={18} strokeWidth={1.8} />
            <span
              aria-hidden="true"
              className="motion-reduce:[animation:none!important] absolute -bottom-0.5 -right-0.5 inline-block h-2.5 w-2.5 rounded-full ring-2"
              style={{
                background: isLive
                  ? 'var(--mc-emerald)'
                  : 'var(--mc-text-dimmer)',
                ['--tw-ring-color' as string]: 'var(--mc-surface)',
                animation: isLive
                  ? 'mc-breathe 1.6s ease-in-out infinite'
                  : undefined,
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="font-mono text-[10px] uppercase tracking-[0.22em]"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              Orchestrator · supervisor · {totalAgents} agent
              {totalAgents === 1 ? '' : 's'}
            </p>
            <h2
              className="truncate text-sm font-semibold"
              style={{ color: 'var(--mc-text)' }}
            >
              {orchestratorName}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setChatExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                borderColor: chatExpanded
                  ? 'var(--mc-cyan)'
                  : 'var(--mc-border)',
                background: chatExpanded
                  ? 'var(--mc-cyan-soft)'
                  : 'var(--mc-surface-2)',
                color: chatExpanded ? 'var(--mc-cyan)' : 'var(--mc-text-dim)',
                ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
              }}
              aria-expanded={chatExpanded}
              aria-controls="orchestrator-chat-panel"
            >
              <HugeiconsIcon
                icon={Chat01Icon}
                size={13}
                strokeWidth={1.9}
                aria-hidden="true"
              />
              {chatExpanded ? 'Hide chat' : 'Open chat'}
            </button>
            <button
              type="button"
              onClick={openSettings}
              className="inline-flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-[var(--mc-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                color: 'var(--mc-text-dim)',
                ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
              }}
              aria-label="Orchestrator settings"
              title="Orchestrator settings"
            >
              <HugeiconsIcon
                icon={Settings01Icon}
                size={16}
                strokeWidth={1.8}
              />
            </button>
          </div>
        </div>

        {/* expandable chat panel — defaulted open at a generous 680px */}
        {chatExpanded ? (
          <div
            id="orchestrator-chat-panel"
            className="border-t"
            style={{ borderColor: 'var(--mc-border)' }}
          >
            <div className="h-[680px] overflow-hidden">
              <Suspense
                fallback={
                  <div
                    className="flex h-full w-full items-center justify-center font-mono text-[11px] uppercase tracking-wider"
                    style={{ color: 'var(--mc-text-dim)' }}
                  >
                    <span style={{ color: 'var(--mc-cyan)' }}>$</span>
                    &nbsp;loading chat surface…
                  </div>
                }
              >
                <div className="h-full w-full min-h-0 overflow-hidden">
                  <ChatScreen
                    activeFriendlyId="main"
                    compact
                    isNewChat={false}
                  />
                </div>
              </Suspense>
            </div>
          </div>
        ) : null}
      </article>

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 backdrop-blur-md"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--mc-bg) 70%, transparent)',
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border p-6"
            style={{
              borderColor: 'var(--mc-border-bright)',
              background: 'var(--mc-surface)',
              boxShadow: '0 30px 100px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className="flex size-11 items-center justify-center rounded-lg border"
                  style={{
                    borderColor: 'var(--mc-border-bright)',
                    background: 'var(--mc-magenta-soft)',
                    color: 'var(--mc-magenta)',
                  }}
                >
                  <HugeiconsIcon
                    icon={Settings01Icon}
                    size={20}
                    strokeWidth={1.8}
                  />
                </div>
                <div>
                  <h2
                    className="text-xl font-semibold"
                    style={{ color: 'var(--mc-text)' }}
                  >
                    Orchestrator Settings
                  </h2>
                  <p
                    className="mt-1 text-sm"
                    style={{ color: 'var(--mc-text-dim)' }}
                  >
                    Update the display name used on this card.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="inline-flex size-10 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2"
                style={{
                  borderColor: 'var(--mc-border)',
                  background: 'var(--mc-surface-2)',
                  color: 'var(--mc-text-dim)',
                  ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                }}
                aria-label="Close orchestrator settings"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={18}
                  strokeWidth={1.8}
                />
              </button>
            </div>

            <label className="mt-6 block space-y-2">
              <span
                className="font-mono text-[11px] uppercase tracking-wider"
                style={{ color: 'var(--mc-text-dim)' }}
              >
                Display name
              </span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder={DEFAULT_ORCHESTRATOR_NAME}
                className="w-full rounded-lg border px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  borderColor: 'var(--mc-border)',
                  background: 'var(--mc-bg)',
                  color: 'var(--mc-text)',
                  ['--tw-ring-color' as string]: 'var(--mc-cyan)',
                  ['--tw-ring-offset-color' as string]: 'var(--mc-surface)',
                }}
              />
            </label>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </Button>
              <Button type="button" onClick={saveSettings}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
