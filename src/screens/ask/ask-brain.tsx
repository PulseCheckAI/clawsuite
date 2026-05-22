import { useCallback, useState } from 'react'

// "Ask your brain" — a first-class PulseOS surface over the LightRAG knowledge
// engine. The council-endorsed kernel: PulseOS is a READER of the shared brain
// (markdown + LightRAG); this page is that reader. It calls the existing
// /api/intel/ask route (graph+vector RAG → cited answer). No new infra.

type RagMode = 'hybrid' | 'local' | 'global' | 'mix' | 'naive'
const MODES: RagMode[] = ['hybrid', 'local', 'global', 'mix', 'naive']

const EXAMPLES = [
  'What are the four spines of PulseCheck OS?',
  'What is MarginOps and what does it detect?',
  'How does the Growth lead-gen spine work end to end?',
  "What are PulseCheck's biggest open risks right now?",
]

interface Turn {
  q: string
  mode: RagMode
  answer: string | null
  error: string | null
}

export function AskBrainScreen() {
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<RagMode>('hybrid')
  const [asking, setAsking] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim()
      if (!text || asking) return
      setAsking(true)
      setTurns((t) => [{ q: text, mode, answer: null, error: null }, ...t])
      try {
        const r = await fetch('/api/intel/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: text, mode }),
        })
          .then((x) => x.json())
          .catch(() => null)
        setTurns((t) =>
          t.map((it, i) =>
            i === 0
              ? {
                  ...it,
                  answer: r?.ok ? r.answer || '(no answer returned)' : null,
                  error: r?.ok
                    ? null
                    : r?.error || 'Knowledge engine unavailable',
                }
              : it,
          ),
        )
      } finally {
        setAsking(false)
      }
    },
    [asking, mode],
  )

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-semibold text-white">🧠 Ask your brain</h1>
        <p className="text-sm text-white/50">
          Cited answers synthesized from the PulseCheck knowledge engine
          (LightRAG graph + vector RAG over your docs &amp; notes).
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(q)
        }}
        className="flex flex-col gap-2"
      >
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void ask(q)
            }
          }}
          rows={3}
          placeholder="Ask anything about PulseCheck — architecture, MarginOps, growth, strategy…  (⌘/Ctrl+Enter to send)"
          className="w-full resize-y rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-500"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as RagMode)}
            title="Retrieval mode"
            className="rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-white/80 outline-none focus:border-emerald-500"
          >
            {MODES.map((m) => (
              <option key={m} value={m} className="bg-zinc-900">
                {m}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={asking || !q.trim()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {asking ? 'Thinking…' : 'Ask'}
          </button>
          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQ(ex)
                  void ask(ex)
                }}
                disabled={asking}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-emerald-500/50 hover:text-white disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </form>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {turns.length === 0 && (
          <p className="text-sm text-white/30">
            Ask a question to query your knowledge base.
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={turns.length - i}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-white/40">
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                {t.mode}
              </span>
              <span className="font-medium text-white/70">{t.q}</span>
            </div>
            {t.answer === null && t.error === null && (
              <p className="text-sm text-emerald-300/70">Thinking…</p>
            )}
            {t.error && (
              <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
                {t.error}
              </p>
            )}
            {t.answer && (
              <div className="whitespace-pre-line text-sm leading-relaxed text-emerald-50/90">
                {t.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
