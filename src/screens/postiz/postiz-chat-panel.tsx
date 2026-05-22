// Postiz composer — AI coach chat panel.
//
// Talks to /api/postiz/coach. Same shape as LinkedInChatPanel — the coach
// endpoint may return a stub when no LLM provider is reachable, in which case
// we render a clear "stub reply" badge so the operator never confuses a
// deterministic heuristic with a real model's suggestion.
//
// Holds history locally; nothing persisted server-side.
//
// Called from: src/screens/postiz/postiz-composer.tsx (right column).

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
  platforms: string[]
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function PostizChatPanel({ draft, platforms }: Props) {
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

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
      const res = await fetch('/api/postiz/coach', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          draft,
          platforms,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const payload = (await res.json()) as
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

      if (!res.ok || !payload.ok) {
        throw new Error(
          ('error' in payload && payload.error) ||
            `Coach call failed (HTTP ${res.status})`,
        )
      }

      const assistantMsg: CoachMessage = {
        id: uid(),
        role: 'assistant',
        content: payload.reply.content,
        stub: payload.reply.stub ?? false,
        nextActions: payload.reply.nextActions,
        createdAt: Date.now(),
      }
      setMessages((m) => [...m, assistantMsg])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, draft, input, messages, platforms])

  return (
    <section
      aria-label="Postiz AI coach"
      className="flex h-full min-h-0 flex-col rounded-lg border"
      style={{
        borderColor: 'var(--mc-border-bright)',
        background: 'var(--mc-surface)',
      }}
    >
      <header
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={AiBrain03Icon}
            className="h-4 w-4"
            style={{ color: 'var(--mc-cyan)' }}
            aria-hidden="true"
          />
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--mc-text)' }}
          >
            Multi-platform coach
          </span>
        </div>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
          style={{
            background: 'var(--mc-amber-soft)',
            color: 'var(--mc-amber)',
          }}
        >
          may stub
        </span>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 space-y-3 overflow-y-auto p-3 text-sm"
      >
        {messages.length === 0 ? (
          <div
            className="rounded-md border border-dashed p-3 text-xs"
            style={{
              borderColor: 'var(--mc-border-bright)',
              background: 'var(--mc-surface-2)',
              color: 'var(--mc-text-dim)',
            }}
          >
            Ask the coach to refine your draft, suggest per-platform variants,
            pick hashtags, or recommend posting windows. LinkedIn is out of
            scope — use the LinkedIn module for LinkedIn-specific coaching.
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
                className="mt-1 h-4 w-4 shrink-0"
                style={{ color: 'var(--mc-cyan)' }}
                aria-hidden="true"
              />
            ) : null}
            <div
              className="max-w-[85%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm"
              style={
                m.role === 'user'
                  ? {
                      borderColor: 'var(--mc-cyan)',
                      background: 'var(--mc-cyan-soft)',
                      color: 'var(--mc-text)',
                    }
                  : {
                      borderColor: 'var(--mc-border-bright)',
                      background: 'var(--mc-surface-2)',
                      color: 'var(--mc-text)',
                    }
              }
            >
              {m.stub ? (
                <div
                  className="mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                  style={{
                    background: 'var(--mc-amber-soft)',
                    color: 'var(--mc-amber)',
                  }}
                >
                  stub reply
                </div>
              ) : null}
              <div>{m.content}</div>
              {m.nextActions && m.nextActions.length > 0 ? (
                <ul
                  className="mt-2 list-disc space-y-1 pl-4 text-xs"
                  style={{ color: 'var(--mc-text-dim)' }}
                >
                  {m.nextActions.map((a, idx) => (
                    <li key={idx}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {m.role === 'user' ? (
              <HugeiconsIcon
                icon={UserAccountIcon}
                className="mt-1 h-4 w-4 shrink-0"
                style={{ color: 'var(--mc-cyan)' }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}

        {busy ? (
          <div
            className="flex items-center gap-2 text-xs"
            style={{ color: 'var(--mc-text-dim)' }}
          >
            <HugeiconsIcon
              icon={Loading03Icon}
              className="h-3.5 w-3.5 animate-spin motion-reduce:[animation:none!important]"
              aria-hidden="true"
            />
            Coach thinking…
          </div>
        ) : null}

        {error ? (
          <div
            className="rounded-md border px-2 py-1.5 text-xs"
            role="alert"
            style={{
              borderColor: 'var(--mc-rose)',
              background: 'var(--mc-rose-soft)',
              color: 'var(--mc-rose)',
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      <form
        className="flex items-end gap-2 border-t p-2"
        style={{ borderColor: 'var(--mc-border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <label htmlFor="postiz-coach-input" className="sr-only">
          Ask the Postiz coach
        </label>
        <textarea
          id="postiz-coach-input"
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
            'min-h-[36px] flex-1 resize-none rounded-md border px-3 py-1.5 text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          style={{
            borderColor: 'var(--mc-border-bright)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text)',
          }}
        />
        <button
          type="submit"
          aria-label="Send to coach"
          disabled={busy || input.trim().length === 0}
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          style={{
            borderColor: 'var(--mc-cyan)',
            background: 'var(--mc-cyan-soft)',
            color: 'var(--mc-cyan)',
          }}
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
