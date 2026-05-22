// LinkedIn composer — AI coach chat panel.
//
// Talks to /api/linkedin/coach which is currently a stub (see TODO in that
// route). Renders the conversation as a column with a sticky composer at the
// bottom. Holds history locally; nothing is persisted server-side yet.
//
// The panel intentionally surfaces a "[stub]" badge when the reply comes back
// with stub=true so the operator can never confuse the placeholder with a
// real LLM suggestion.

import { useCallback, useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AiBrain03Icon,
  ArrowUp02Icon,
  BotIcon,
  Loading03Icon,
  UserAccountIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

interface CoachMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  stub?: boolean
  nextActions?: string[]
  createdAt: number
}

interface Props {
  draft: string
  identityType: 'person' | 'organization'
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function LinkedInChatPanel({ draft, identityType }: Props) {
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll on new messages (respects reduced-motion via instant scroll).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({
      top: el.scrollHeight,
      behavior: prefersReduced ? 'auto' : 'smooth',
    })
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return

    const userMsg: CoachMessage = {
      id: uid(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/linkedin/coach', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          draft,
          identityType,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const json = (await res.json()) as
        | {
            ok: true
            reply: {
              role: 'assistant'
              content: string
              stub?: boolean
              nextActions?: string[]
            }
          }
        | { ok: false; error: string }

      if (!res.ok || !json.ok) {
        throw new Error(
          ('error' in json && json.error) ||
            `Coach call failed (HTTP ${res.status})`,
        )
      }

      const assistantMsg: CoachMessage = {
        id: uid(),
        role: 'assistant',
        content: json.reply.content,
        stub: json.reply.stub ?? false,
        nextActions: json.reply.nextActions,
        createdAt: Date.now(),
      }
      setMessages((m) => [...m, assistantMsg])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, draft, identityType, input, messages])

  return (
    <section
      aria-label="LinkedIn AI coach"
      className="flex h-full min-h-0 flex-col rounded-lg border border-primary-800/50 bg-primary-950/30"
    >
      <header className="flex items-center justify-between border-b border-primary-800/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={AiBrain03Icon}
            className="h-4 w-4 text-cyan-400"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-primary-100">
            LinkedIn coach
          </span>
        </div>
        <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
          stub
        </span>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 space-y-3 overflow-y-auto p-3 text-sm"
      >
        {messages.length === 0 ? (
          <div className="rounded-md border border-dashed border-primary-800/50 bg-primary-900/20 p-3 text-xs text-primary-500">
            Ask the coach to refine your draft, suggest hashtags, or pick a
            posting time. The coach endpoint is currently a stub — see the TODO
            in <code>src/routes/api/linkedin/coach.ts</code>.
          </div>
        ) : null}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex gap-2',
              m.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {m.role === 'assistant' ? (
              <HugeiconsIcon
                icon={BotIcon}
                className="mt-1 h-4 w-4 shrink-0 text-cyan-400"
                aria-hidden="true"
              />
            ) : null}
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                m.role === 'user'
                  ? 'border border-cyan-700/40 bg-cyan-900/20 text-cyan-100'
                  : 'border border-primary-800/50 bg-primary-900/40 text-primary-200',
              )}
            >
              {m.stub ? (
                <div className="mb-1 inline-flex items-center gap-1 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                  stub reply
                </div>
              ) : null}
              <div>{m.content}</div>
              {m.nextActions && m.nextActions.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-primary-300">
                  {m.nextActions.map((a, idx) => (
                    <li key={idx}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {m.role === 'user' ? (
              <HugeiconsIcon
                icon={UserAccountIcon}
                className="mt-1 h-4 w-4 shrink-0 text-cyan-300"
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}

        {busy ? (
          <div className="flex items-center gap-2 text-xs text-primary-400">
            <HugeiconsIcon
              icon={Loading03Icon}
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Coach thinking…
          </div>
        ) : null}

        {error ? (
          <div
            className="rounded-md border border-rose-700/50 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-300"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </div>

      <form
        className="flex items-end gap-2 border-t border-primary-800/50 p-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <label htmlFor="linkedin-coach-input" className="sr-only">
          Ask the LinkedIn coach
        </label>
        <textarea
          id="linkedin-coach-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          placeholder="Ask the coach… (Enter to send, Shift+Enter for newline)"
          disabled={busy}
          className={cn(
            'min-h-[36px] flex-1 resize-none rounded-md border border-primary-700/60 bg-primary-900/40 px-3 py-1.5 text-sm text-primary-100 placeholder:text-primary-500',
            'focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <button
          type="submit"
          aria-label="Send to coach"
          disabled={busy || input.trim().length === 0}
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cyan-700/50 bg-cyan-900/40 text-cyan-200',
            'hover:bg-cyan-800/50 focus:outline-none focus:ring-2 focus:ring-cyan-400',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <HugeiconsIcon
            icon={ArrowUp02Icon}
            className="h-4 w-4"
            aria-hidden="true"
          />
        </button>
      </form>
    </section>
  )
}
