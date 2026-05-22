// Intel reader: source sidebar + semantic search + item list with AI summary,
// tags, relevance, read/save, and thumbs feedback. Calls /api/intel/* routes.
// a11y/UX: SVG icons (no emoji), cursor-pointer, focus-visible rings, optimistic
// read/save, dark theme to match the RSS Cockpit screen.

import { useCallback, useEffect, useState } from 'react'

interface ItemAi {
  summary: string | null
  tags: string[]
  relevance_score: number | null
}

interface Source {
  id: string
  label: string
  folder: string | null
}

interface Item {
  id: string
  source_id: string
  title: string
  link: string
  raw_snippet: string
  pub_date: string | null
  read: boolean
  saved: boolean
  item_ai?: ItemAi | null
  similarity?: number
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.5a.56.56 0 0 1 1.04 0l2.13 4.78 5.2.46c.5.04.7.66.32 1l-3.95 3.4 1.18 5.1c.11.49-.42.87-.85.61L12 16.7l-4.55 2.65c-.43.26-.96-.12-.85-.6l1.18-5.1-3.95-3.4c-.38-.34-.18-.96.32-1l5.2-.46 2.13-4.79Z"
      />
    </svg>
  )
}

const BTN =
  'cursor-pointer rounded-md transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'

function relColor(score: number): string {
  if (score >= 0.66) return 'bg-emerald-500/20 text-emerald-300'
  if (score >= 0.33) return 'bg-amber-500/20 text-amber-300'
  return 'bg-white/10 text-white/50'
}

function ItemCard({
  it,
  onState,
  onVote,
}: {
  it: Item
  onState: (id: string, patch: { read?: boolean; saved?: boolean }) => void
  onVote: (id: string, vote: 1 | -1) => void
}) {
  const ai = it.item_ai ?? null
  return (
    <li
      className={`rounded-md border border-white/10 p-3 transition-colors duration-200 ${
        it.read
          ? 'bg-white/[0.03] opacity-60'
          : 'bg-white/[0.06] hover:border-emerald-400/50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <a
          href={it.link}
          target="_blank"
          rel="noreferrer"
          onClick={() => onState(it.id, { read: true })}
          className={`font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
            it.read ? 'text-white/50' : 'text-white'
          }`}
        >
          {it.title}
        </a>
        <div className="flex shrink-0 items-center gap-1">
          {typeof it.similarity === 'number' && (
            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-xs text-sky-300">
              {it.similarity.toFixed(2)}
            </span>
          )}
          {ai && typeof ai.relevance_score === 'number' && (
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${relColor(ai.relevance_score)}`}
              title="AI relevance vs your interest profile"
            >
              rel {ai.relevance_score.toFixed(2)}
            </span>
          )}
          <button
            onClick={() => onState(it.id, { saved: !it.saved })}
            aria-label={it.saved ? 'Unsave item' : 'Save item'}
            aria-pressed={it.saved}
            className={`${BTN} p-1.5 ${
              it.saved ? 'text-amber-400' : 'text-white/40 hover:text-amber-400'
            }`}
          >
            <StarIcon filled={it.saved} />
          </button>
        </div>
      </div>

      {ai?.summary ? (
        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-emerald-100/80">
          {ai.summary}
        </p>
      ) : (
        it.raw_snippet && (
          <p className="mt-1 text-sm leading-relaxed text-white/60">
            {it.raw_snippet}
          </p>
        )
      )}

      {ai && ai.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ai.tags.map((t) => (
            <span
              key={t}
              className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-white/40">
        <button
          onClick={() => onState(it.id, { read: !it.read })}
          className={`${BTN} px-1 py-0.5 hover:text-white/80`}
        >
          {it.read ? 'Mark unread' : 'Mark read'}
        </button>
        <button
          onClick={() => onVote(it.id, 1)}
          className={`${BTN} px-1 py-0.5 hover:text-emerald-300`}
          aria-label="More like this"
        >
          ▲ more
        </button>
        <button
          onClick={() => onVote(it.id, -1)}
          className={`${BTN} px-1 py-0.5 hover:text-rose-300`}
          aria-label="Less like this"
        >
          ▼ less
        </button>
        {it.pub_date && (
          <time dateTime={it.pub_date}>
            {new Date(it.pub_date).toLocaleDateString()}
          </time>
        )}
      </div>
    </li>
  )
}

export function IntelReader() {
  const [sources, setSources] = useState<Source[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  // search mode
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Item[] | null>(null)
  const [searching, setSearching] = useState(false)

  // ask mode (LightRAG graph+vector RAG → cited synthesized answer)
  const [askQ, setAskQ] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState<string | null>(null)

  const runAsk = useCallback(async () => {
    const q = askQ.trim()
    if (!q) return
    setAsking(true)
    setAnswer(null)
    setAskErr(null)
    try {
      const r = await fetch(
        `/api/intel/ask?q=${encodeURIComponent(q)}&mode=hybrid`,
      )
        .then((x) => x.json())
        .catch(() => null)
      if (r?.ok) setAnswer(r.answer || '(no answer returned)')
      else setAskErr(r?.error || 'Knowledge engine unavailable')
    } finally {
      setAsking(false)
    }
  }, [askQ])

  const loadSources = useCallback(async () => {
    const r = await fetch('/api/intel/sources')
      .then((x) => x.json())
      .catch(() => null)
    if (r?.ok) setSources(r.sources)
  }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    const q = new URLSearchParams()
    if (active) q.set('sourceId', active)
    if (unreadOnly) q.set('unread', '1')
    const r = await fetch(`/api/intel/items?${q.toString()}`)
      .then((x) => x.json())
      .catch(() => null)
    if (r?.ok) setItems(r.items)
    setLoading(false)
  }, [active, unreadOnly])

  useEffect(() => {
    void loadSources()
  }, [loadSources])
  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      await fetch('/api/intel/ingest', { method: 'POST' })
      await Promise.all([loadSources(), loadItems()])
    } finally {
      setBusy(false)
    }
  }, [loadSources, loadItems])

  const runSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      const r = await fetch(`/api/intel/search?q=${encodeURIComponent(q)}&k=20`)
        .then((x) => x.json())
        .catch(() => null)
      setResults(r?.ok ? (r.results as Item[]) : [])
    } finally {
      setSearching(false)
    }
  }, [query])

  const setItemFlag = useCallback(
    async (id: string, patch: { read?: boolean; saved?: boolean }) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
      )
      setResults((prev) =>
        prev
          ? prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
          : prev,
      )
      await fetch('/api/intel/items', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      }).catch(() => {
        void loadItems()
      })
    },
    [loadItems],
  )

  const vote = useCallback(async (id: string, v: 1 | -1) => {
    await fetch('/api/intel/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item_id: id, vote: v }),
    }).catch(() => {})
  }, [])

  const shown = results ?? items
  const isSearch = results !== null

  return (
    <div className="flex gap-4">
      <aside className="w-56 shrink-0 space-y-1">
        <button
          onClick={refresh}
          disabled={busy}
          aria-busy={busy}
          className={`${BTN} flex w-full items-center justify-center gap-2 bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h5M20 20v-5h-5M4.6 9a8 8 0 0 1 14-2.3M19.4 15a8 8 0 0 1-14 2.3"
            />
          </svg>
          {busy ? 'Refreshing…' : 'Refresh feeds'}
        </button>

        <label className="flex cursor-pointer items-center gap-2 px-1 py-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="cursor-pointer accent-emerald-500"
          />
          Unread only
        </label>

        <button
          onClick={() => setActive(null)}
          aria-pressed={active === null}
          className={`${BTN} block w-full px-2 py-2 text-left text-sm hover:bg-white/10 ${
            active === null
              ? 'bg-white/10 font-medium text-white'
              : 'text-white/70'
          }`}
        >
          All sources
        </button>
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            aria-pressed={active === s.id}
            title={s.label}
            className={`${BTN} block w-full truncate px-2 py-2 text-left text-sm hover:bg-white/10 ${
              active === s.id
                ? 'bg-white/10 font-medium text-white'
                : 'text-white/70'
            }`}
          >
            {s.label}
          </button>
        ))}
      </aside>

      <div className="flex-1">
        {/* Ask your brain — LightRAG graph+vector RAG (cited answer) */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void runAsk()
          }}
          className="mb-3"
        >
          <div className="flex gap-2">
            <input
              value={askQ}
              onChange={(e) => setAskQ(e.target.value)}
              placeholder="Ask your knowledge base (feeds + notes)…"
              className="flex-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={asking}
              className={`${BTN} bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50`}
            >
              {asking ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          {askErr && (
            <p className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
              {askErr}
            </p>
          )}
          {answer && (
            <div className="mt-2 whitespace-pre-line rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-sm leading-relaxed text-emerald-50/90">
              {answer}
            </div>
          )}
        </form>

        {/* Semantic search */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch()
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Semantic search across enriched items…"
            className="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={searching}
            className={`${BTN} bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20 disabled:opacity-50`}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
          {isSearch && (
            <button
              type="button"
              onClick={() => {
                setResults(null)
                setQuery('')
              }}
              className={`${BTN} px-3 py-2 text-sm text-white/60 hover:text-white`}
            >
              Clear
            </button>
          )}
        </form>

        {isSearch && (
          <p className="mb-2 text-xs text-white/40">
            {shown.length} semantic {shown.length === 1 ? 'match' : 'matches'}{' '}
            for “{query}”
          </p>
        )}

        <ul className="space-y-2" aria-busy={loading || searching}>
          {!loading && !searching && shown.length === 0 && (
            <li className="rounded-md border border-white/10 p-6 text-center text-sm text-white/40">
              {isSearch
                ? 'No semantic matches. Enrich more items, or try another query.'
                : 'No items yet. Add a source and hit Refresh feeds.'}
            </li>
          )}
          {shown.map((it) => (
            <ItemCard key={it.id} it={it} onState={setItemFlag} onVote={vote} />
          ))}
        </ul>
      </div>
    </div>
  )
}
