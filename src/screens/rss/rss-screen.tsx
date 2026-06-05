// RSS Cockpit — browse RSSHub feeds and curate items into the Postiz composer.
//
// Flow: pick an RSSHub route -> GET /api/rss/feed -> review items -> per item,
// edit the text and "Send to Postiz" -> POST /api/postiz/post to the selected
// connected channels (Bluesky / Telegram / Dev.to). LinkedIn is rejected
// server-side by the post route, so it never appears as a target here.
//
// Public surface: rendered by src/routes/rss.tsx (lazy). No props.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IntelReader } from './intel-reader'

interface PostizAccount {
  id: string
  identifier: string
  name: string
  disabled: boolean
}
interface RssItem {
  title: string
  link: string
  description: string
  pubDate: string | null
}

const PRESETS: { label: string; route: string }[] = [
  { label: 'Hacker News', route: '/hackernews' },
  { label: 'GitHub Trending', route: '/github/trending/daily/any' },
  { label: 'Product Hunt', route: '/producthunt/today' },
  { label: 'r/restaurateur', route: '/reddit/subreddit/restaurateur/hot' },
  { label: 'TechCrunch', route: '/techcrunch/news' },
]

async function fetchAccounts(): Promise<PostizAccount[]> {
  const res = await fetch('/api/postiz/accounts')
  const data = await res.json()
  if (!data?.ok) throw new Error(data?.error || 'Failed to load channels')
  return (data.accounts || []) as PostizAccount[]
}

async function fetchFeed(
  route: string,
): Promise<{ feedTitle: string; items: RssItem[] }> {
  const res = await fetch(
    `/api/rss/feed?route=${encodeURIComponent(route)}&limit=25`,
  )
  const data = await res.json()
  if (!data?.ok) throw new Error(data?.error || `Feed failed (${res.status})`)
  return { feedTitle: data.feedTitle, items: data.items || [] }
}

interface AutopostConfig {
  enabled: boolean
  feedRoute: string
  feedRoutes: string[]
  platforms: string[]
  intervalMinutes: number
  maxPerRun: number
  contentTemplate: string
  generateImages: boolean
  lastRunAt: string | null
  lastResult: {
    at: string
    posted: number
    skipped: number
    errors: string[]
  } | null
  seenCount: number
}

async function fetchAutopostConfig(): Promise<AutopostConfig> {
  const res = await fetch('/api/rss/autopost-config')
  const data = await res.json()
  if (!data?.ok)
    throw new Error(data?.error || 'Failed to load auto-post config')
  return data.config as AutopostConfig
}

export function RssScreen() {
  const [routeInput, setRouteInput] = useState('/hackernews')
  const [activeRoute, setActiveRoute] = useState('/hackernews')
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const accountsQuery = useQuery({
    queryKey: ['postiz', 'accounts'],
    queryFn: fetchAccounts,
    staleTime: 60_000,
  })

  const feedQuery = useQuery({
    queryKey: ['rss', 'feed', activeRoute],
    queryFn: () => fetchFeed(activeRoute),
    enabled: activeRoute.length > 0,
    retry: false,
  })

  // Guard against a non-array payload (e.g. Postiz backend returning an error
  // object) — `?? []` only covers nullish, so a truthy non-array would crash
  // the whole screen at `accounts.filter`. Array.isArray makes RSS crash-proof.
  const accounts = Array.isArray(accountsQuery.data) ? accountsQuery.data : []
  // Default-select every connected channel until the user toggles one off.
  const selectedIds = useMemo(
    () => accounts.filter((a) => selected[a.id] ?? true).map((a) => a.id),
    [accounts, selected],
  )

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !(s[id] ?? true) }))
  }

  function load() {
    const r = routeInput.trim()
    if (r) setActiveRoute(r.startsWith('/') ? r : '/' + r)
  }

  return (
    <div className="h-full overflow-y-auto p-6 text-white">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">RSS Cockpit</h1>
        <p className="mt-1 text-sm text-white/50">
          Pull any RSSHub feed, then curate items straight into Postiz — posts
          to your connected channels.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Intel Reader</h2>
        <IntelReader />
      </section>

      {/* Feed picker */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={routeInput}
          onChange={(e) => setRouteInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="RSSHub route, e.g. /hackernews"
          className="min-w-[280px] flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-sky-500"
        />
        <button
          onClick={load}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        >
          Load feed
        </button>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.route}
            onClick={() => {
              setRouteInput(p.route)
              setActiveRoute(p.route)
            }}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:border-sky-500 hover:text-white"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Channel selector */}
      <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
          Post to channels
        </div>
        {accountsQuery.isLoading ? (
          <div className="text-sm text-white/40">Loading channels…</div>
        ) : accounts.length === 0 ? (
          <div className="text-sm text-amber-300/80">
            No connected channels. Connect one in the Postiz module first.
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {accounts.map((a) => {
              const on = selected[a.id] ?? true
              return (
                <label
                  key={a.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                    on
                      ? 'border-sky-500/60 bg-sky-500/10 text-white'
                      : 'border-white/10 bg-transparent text-white/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(a.id)}
                    className="accent-sky-500"
                  />
                  <span className="font-medium">{a.identifier}</span>
                  <span className="text-white/40">· {a.name}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>

      {/* Auto-post panel */}
      <AutopostPanel accounts={accounts} />

      {/* Feed items */}
      {feedQuery.isLoading ? (
        <div className="text-sm text-white/40">Loading feed…</div>
      ) : feedQuery.isError ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          Couldn’t load feed:{' '}
          {feedQuery.error instanceof Error
            ? feedQuery.error.message
            : 'Request failed.'}
        </div>
      ) : (feedQuery.data?.items.length ?? 0) === 0 ? (
        <div className="text-sm text-white/40">
          No items in <code>{activeRoute}</code>.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-white/50">
            {feedQuery.data?.feedTitle} — {feedQuery.data?.items.length} items
          </div>
          {feedQuery.data?.items.map((item, i) => (
            <FeedCard
              key={item.link || `rss-item-${i}`}
              item={item}
              platforms={selectedIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FeedCard({ item, platforms }: { item: RssItem; platforms: string[] }) {
  const [text, setText] = useState(`${item.title}\n\n${item.link}`.trim())

  const send = useMutation({
    mutationFn: async () => {
      if (platforms.length === 0) throw new Error('Select at least one channel')
      const res = await fetch('/api/postiz/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, platforms }),
      })
      const data = await res.json()
      if (!data?.ok)
        throw new Error(data?.error || `Post failed (${res.status})`)
      return data
    },
  })

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      {item.link ? (
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold text-sky-300 hover:underline"
        >
          {item.title}
        </a>
      ) : (
        <span className="text-sm font-semibold text-white/80">
          {item.title}
        </span>
      )}
      {item.pubDate && (
        <span className="ml-2 text-xs text-white/30">{item.pubDate}</span>
      )}
      {item.description && (
        <p className="mt-1 line-clamp-2 text-xs text-white/50">
          {item.description}
        </p>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="mt-3 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-sky-500"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={() => send.mutate()}
          disabled={send.isPending || platforms.length === 0}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {send.isPending ? 'Sending…' : 'Send to Postiz'}
        </button>
        {send.isSuccess && (
          <span className="text-xs text-emerald-300">✓ Sent</span>
        )}
        {send.isError && (
          <span className="text-xs text-rose-300">
            {send.error instanceof Error ? send.error.message : 'Failed'}
          </span>
        )}
      </div>
    </div>
  )
}

// Auto-post panel — schedules unattended RSS→Postiz posting. Emerald accents
// distinguish the "automated" surface from the sky-blue manual curation flow.
function AutopostPanel({ accounts }: { accounts: PostizAccount[] }) {
  const qc = useQueryClient()
  const cfgQuery = useQuery({
    queryKey: ['rss', 'autopost', 'config'],
    queryFn: fetchAutopostConfig,
    refetchInterval: 30_000,
  })
  const cfg = cfgQuery.data

  const [feedRoutes, setFeedRoutes] = useState<string[]>([])
  const [feedInput, setFeedInput] = useState('')
  const [platforms, setPlatforms] = useState<string[]>([])
  const [intervalMinutes, setIntervalMinutes] = useState(30)
  const [maxPerRun, setMaxPerRun] = useState(5)
  const [template, setTemplate] = useState('{title}\n\n{link}')
  const [generateImages, setGenerateImages] = useState(false)

  // Hydrate local editors from server config once it loads / changes.
  useEffect(() => {
    if (!cfg) return
    setFeedRoutes(
      cfg.feedRoutes?.length
        ? cfg.feedRoutes
        : cfg.feedRoute
          ? [cfg.feedRoute]
          : [],
    )
    setPlatforms(cfg.platforms)
    setIntervalMinutes(cfg.intervalMinutes)
    setMaxPerRun(cfg.maxPerRun)
    setTemplate(cfg.contentTemplate)
    setGenerateImages(cfg.generateImages ?? false)
  }, [cfg])

  const basePatch = (): Partial<AutopostConfig> => ({
    feedRoutes,
    platforms,
    intervalMinutes,
    maxPerRun,
    contentTemplate: template,
    generateImages,
  })

  const save = useMutation({
    mutationFn: async (patch: Partial<AutopostConfig>) => {
      const res = await fetch('/api/rss/autopost-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!data?.ok)
        throw new Error(data?.error || `Save failed (${res.status})`)
      return data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['rss', 'autopost', 'config'] }),
  })

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/rss/autopost?force=1', { method: 'POST' })
      const data = await res.json()
      if (!data?.ok)
        throw new Error(data?.error || `Run failed (${res.status})`)
      return data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['rss', 'autopost', 'config'] }),
  })

  function addFeed() {
    const raw = feedInput.trim()
    if (!raw) return
    const norm = raw.startsWith('/') ? raw : '/' + raw
    setFeedRoutes((prev) => (prev.includes(norm) ? prev : [...prev, norm]))
    setFeedInput('')
  }
  function removeFeed(route: string) {
    setFeedRoutes((prev) => prev.filter((x) => x !== route))
  }
  function togglePlatform(id: string) {
    setPlatforms((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    )
  }

  const enabled = cfg?.enabled ?? false
  const cfgFeeds = cfg
    ? cfg.feedRoutes?.length
      ? cfg.feedRoutes
      : cfg.feedRoute
        ? [cfg.feedRoute]
        : []
    : []
  const canEnable = feedRoutes.length > 0 && platforms.length > 0
  const dirty =
    cfg != null &&
    (feedRoutes.length !== cfgFeeds.length ||
      feedRoutes.some((r) => !cfgFeeds.includes(r)) ||
      intervalMinutes !== cfg.intervalMinutes ||
      maxPerRun !== cfg.maxPerRun ||
      template !== cfg.contentTemplate ||
      generateImages !== (cfg.generateImages ?? false) ||
      platforms.length !== cfg.platforms.length ||
      platforms.some((p) => !cfg.platforms.includes(p)))

  return (
    <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-white/40">
            Auto-post
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              enabled
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-white/10 text-white/40'
            }`}
          >
            {enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <span className="text-white/50">
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={save.isPending || (!enabled && !canEnable)}
            onChange={(e) =>
              save.mutate({ ...basePatch(), enabled: e.target.checked })
            }
            className="h-4 w-8 cursor-pointer accent-emerald-500 disabled:cursor-not-allowed"
          />
        </label>
      </div>

      <p className="mb-3 text-xs text-white/40">
        Polls the feed every {intervalMinutes}m and posts up to {maxPerRun} NEW
        items to the selected channels. Enabling marks current items as seen, so
        only items appearing afterward are posted.
      </p>

      <div className="mb-2">
        <label
          htmlFor="rss-feed-input"
          className="mb-1 block text-xs text-white/50"
        >
          Feeds — the auto-poster drains all of them into your channels
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="rss-feed-input"
            value={feedInput}
            onChange={(e) => setFeedInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addFeed()
              }
            }}
            placeholder="RSSHub route, e.g. /hackernews — press Enter or Add"
            className="min-w-[240px] flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={addFeed}
            disabled={feedInput.trim() === ''}
            className="cursor-pointer rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add feed
          </button>
        </div>
        {feedRoutes.length > 0 && (
          <ul
            className="mt-2 flex flex-wrap gap-2"
            aria-label="Configured feeds"
          >
            {feedRoutes.map((r) => (
              <li
                key={r}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70"
              >
                <span className="font-mono">{r}</span>
                <button
                  type="button"
                  onClick={() => removeFeed(r)}
                  aria-label={`Remove feed ${r}`}
                  className="cursor-pointer rounded text-white/40 transition-colors hover:text-rose-300"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-xs text-white/50">
          every
          <input
            type="number"
            min={5}
            max={1440}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value) || 30)}
            className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm outline-none focus:border-emerald-500"
          />
          min
        </label>
        <label className="flex items-center gap-1 text-xs text-white/50">
          max
          <input
            type="number"
            min={1}
            max={25}
            value={maxPerRun}
            onChange={(e) => setMaxPerRun(Number(e.target.value) || 5)}
            className="w-14 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm outline-none focus:border-emerald-500"
          />
          /run
        </label>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {accounts.length === 0 ? (
          <span className="text-xs text-amber-300/80">
            No channels connected — connect one in the Postiz module first.
          </span>
        ) : (
          accounts.map((a) => {
            const on = platforms.includes(a.id)
            return (
              <button
                key={a.id}
                onClick={() => togglePlatform(a.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  on
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                    : 'border-white/10 text-white/50 hover:border-white/30'
                }`}
              >
                {a.identifier}
                <span className="text-white/40"> · {a.name}</span>
              </button>
            )
          })
        )}
      </div>

      <textarea
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        rows={2}
        placeholder="{title}\n\n{link}"
        className="mb-3 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs outline-none focus:border-emerald-500"
      />

      <label className="mb-3 flex items-center gap-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={generateImages}
          onChange={(e) => setGenerateImages(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-emerald-500"
        />
        <span>
          Generate a free image per post
          <span className="text-white/35">
            {' '}
            · Pollinations Flux, no API key, attached automatically
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => save.mutate(basePatch())}
          disabled={save.isPending || !dirty}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
        <button
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending || !enabled}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {runNow.isPending ? 'Running…' : 'Run now'}
        </button>
        {!enabled && !canEnable && (
          <span className="text-xs text-white/30">
            set a feed + at least one channel to enable
          </span>
        )}
        {(save.isError || runNow.isError) && (
          <span className="text-xs text-rose-300">
            {(save.error || runNow.error) instanceof Error
              ? (save.error || runNow.error)!.message
              : 'Failed'}
          </span>
        )}
      </div>

      {cfg && (
        <div className="mt-3 border-t border-white/10 pt-3 text-xs text-white/40">
          {cfg.lastResult ? (
            <span>
              Last run{' '}
              {cfg.lastRunAt ? new Date(cfg.lastRunAt).toLocaleString() : '—'}:{' '}
              <span className="text-emerald-300">
                {cfg.lastResult.posted} posted
              </span>
              , {cfg.lastResult.skipped} skipped
              {cfg.lastResult.errors.length > 0 && (
                <span className="text-rose-300">
                  {' '}
                  · {cfg.lastResult.errors[0]}
                </span>
              )}
            </span>
          ) : (
            <span>No runs yet.</span>
          )}
          <span className="ml-2 text-white/30">
            · {cfg.seenCount} items seen
          </span>
        </div>
      )}
    </div>
  )
}
