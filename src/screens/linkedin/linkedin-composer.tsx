// LinkedIn composer — left = post editor + media; right = AI coach chat.
//
// Reuses the identities query (already polled by the parent screen for the
// Insights tab) via TanStack Query's cache — passing the data through props
// keeps this component decoupled from the API.

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  Loading03Icon,
  Rocket01Icon,
  UserAccountIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { LinkedInChatPanel } from './linkedin-chat-panel'
import {
  LinkedInMediaUploader,
  type UploadedMedia,
} from './linkedin-media-uploader'

export interface IdentityOption {
  identity_type: 'person' | 'organization'
  linkedin_id: string
  display_name: string
  scopes: string[]
  organization_id?: string
}

interface Props {
  identities: IdentityOption[]
  identitiesLoading: boolean
  identitiesError: string | null
}

interface PostResponse {
  ok: boolean
  tool?: string
  postUrn?: string
  postUrl?: string | null
  contentId?: string | null
  error?: string
  hint?: string
}

const MAX_CHARS = 3000

export function LinkedInComposer({
  identities,
  identitiesLoading,
  identitiesError,
}: Props) {
  // Default to the first available identity (most recently refreshed).
  const defaultIdentityKey = useMemo(() => {
    const first = identities[0]
    return first ? `${first.identity_type}:${first.linkedin_id}` : ''
  }, [identities])

  const [identityKey, setIdentityKey] = useState<string>(defaultIdentityKey)
  // Sync default when identities load asynchronously.
  if (!identityKey && defaultIdentityKey) {
    setIdentityKey(defaultIdentityKey)
  }

  const selectedIdentity = useMemo(
    () =>
      identities.find(
        (i) => `${i.identity_type}:${i.linkedin_id}` === identityKey,
      ) ?? null,
    [identities, identityKey],
  )

  const [text, setText] = useState('')
  const [visibility, setVisibility] = useState<'PUBLIC' | 'CONNECTIONS'>(
    'PUBLIC',
  )
  const [media, setMedia] = useState<UploadedMedia[]>([])

  const queryClient = useQueryClient()

  const publishMutation = useMutation<PostResponse, Error, void>({
    mutationFn: async () => {
      if (!selectedIdentity) {
        throw new Error('No identity selected.')
      }
      const payload: Record<string, unknown> = {
        text,
        visibility,
        identityType: selectedIdentity.identity_type,
        mediaTokens: media.map((m) => m.token),
        altTexts: media.map((m) => m.altText ?? ''),
      }
      if (selectedIdentity.identity_type === 'organization') {
        // The MCP expects organization_urn (urn:li:organization:NNN). The
        // identities row stores linkedin_id which is the raw numeric ID;
        // construct the URN here.
        payload.organizationUrn = `urn:li:organization:${selectedIdentity.linkedin_id}`
      } else {
        payload.linkedinId = selectedIdentity.linkedin_id
      }

      const res = await fetch('/api/linkedin/post', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as PostResponse
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      return json
    },
    onSuccess: () => {
      // Clear composer + refresh insights so the new post shows up.
      setText('')
      setMedia([])
      void queryClient.invalidateQueries({ queryKey: ['linkedin', 'posts'] })
    },
  })

  const charCount = text.length
  const overLimit = charCount > MAX_CHARS
  const canPublish =
    !publishMutation.isPending &&
    text.trim().length > 0 &&
    !overLimit &&
    !!selectedIdentity

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      {/* Left column — composer + uploader */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <header className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-medium text-primary-100">
            <HugeiconsIcon
              icon={Edit02Icon}
              className="h-5 w-5 text-cyan-400"
              aria-hidden="true"
            />
            Compose post
          </h2>

          {/* Identity + visibility selector row */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="linkedin-identity">
              Target identity
            </label>
            <select
              id="linkedin-identity"
              value={identityKey}
              onChange={(e) => setIdentityKey(e.target.value)}
              disabled={identitiesLoading || identities.length === 0}
              className={cn(
                'rounded-md border border-primary-700/60 bg-primary-900/40 px-2 py-1.5 text-sm text-primary-100',
                'focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {identities.length === 0 ? (
                <option value="">
                  {identitiesLoading
                    ? 'Loading identities…'
                    : 'No identity connected'}
                </option>
              ) : (
                identities.map((id) => (
                  <option
                    key={`${id.identity_type}:${id.linkedin_id}`}
                    value={`${id.identity_type}:${id.linkedin_id}`}
                  >
                    {id.identity_type === 'organization' ? '🏢 ' : '👤 '}
                    {id.display_name}
                  </option>
                ))
              )}
            </select>

            <label className="sr-only" htmlFor="linkedin-visibility">
              Visibility
            </label>
            <select
              id="linkedin-visibility"
              value={visibility}
              onChange={(e) =>
                setVisibility(
                  e.target.value === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
                )
              }
              disabled={selectedIdentity?.identity_type === 'organization'}
              className={cn(
                'rounded-md border border-primary-700/60 bg-primary-900/40 px-2 py-1.5 text-sm text-primary-100',
                'focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
              title={
                selectedIdentity?.identity_type === 'organization'
                  ? 'Company posts are always PUBLIC'
                  : undefined
              }
            >
              <option value="PUBLIC">Public</option>
              <option value="CONNECTIONS">Connections only</option>
            </select>

            {selectedIdentity ? (
              <span className="flex items-center gap-1 rounded bg-primary-900/40 px-2 py-1 text-xs text-primary-400">
                <HugeiconsIcon
                  icon={UserAccountIcon}
                  className="h-3 w-3"
                  aria-hidden="true"
                />
                {selectedIdentity.identity_type}:{' '}
                <code className="text-primary-300">
                  {selectedIdentity.linkedin_id}
                </code>
              </span>
            ) : null}
          </div>

          {identitiesError ? (
            <div
              className="rounded-md border border-rose-700/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-300"
              role="alert"
            >
              {identitiesError}
            </div>
          ) : null}
        </header>

        <label className="sr-only" htmlFor="linkedin-composer-text">
          Post body
        </label>
        <textarea
          id="linkedin-composer-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="What do you want to share?"
          className={cn(
            'w-full resize-y rounded-md border bg-primary-950/40 px-3 py-2 text-sm text-primary-100 placeholder:text-primary-500',
            'focus:outline-none focus:ring-2',
            overLimit
              ? 'border-rose-700/60 focus:border-rose-500 focus:ring-rose-400'
              : 'border-primary-700/60 focus:border-cyan-400 focus:ring-cyan-400',
          )}
        />
        <div className="flex items-center justify-between text-xs">
          <span
            className={cn(overLimit ? 'text-rose-300' : 'text-primary-500')}
            aria-live="polite"
          >
            {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
            {overLimit ? ' — over LinkedIn limit' : ''}
          </span>
          <span className="text-primary-500">
            {media.length} attachment{media.length === 1 ? '' : 's'}
          </span>
        </div>

        <LinkedInMediaUploader
          items={media}
          onChange={setMedia}
          disabled={publishMutation.isPending}
        />

        {publishMutation.isError ? (
          <div
            className="flex items-start gap-2 rounded-md border border-rose-700/50 bg-rose-950/30 px-3 py-2 text-sm text-rose-300"
            role="alert"
          >
            <HugeiconsIcon
              icon={Alert02Icon}
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <div className="font-medium">Post failed</div>
              <div className="mt-0.5 text-xs text-rose-400">
                {publishMutation.error.message}
              </div>
            </div>
          </div>
        ) : null}

        {publishMutation.isSuccess && publishMutation.data ? (
          <div
            className="flex items-start gap-2 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200"
            role="status"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="font-medium">Published</div>
              <div className="mt-0.5 truncate text-xs text-emerald-300">
                {publishMutation.data.tool} ·{' '}
                <code>{publishMutation.data.postUrn}</code>
              </div>
              {publishMutation.data.postUrl ? (
                <a
                  href={publishMutation.data.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-300 underline focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  View on LinkedIn ↗
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => publishMutation.mutate()}
            disabled={!canPublish}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-cyan-700/50 bg-cyan-900/40 px-3 py-1.5 text-sm font-medium text-cyan-100',
              'hover:bg-cyan-800/50 focus:outline-none focus:ring-2 focus:ring-cyan-400',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {publishMutation.isPending ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <HugeiconsIcon
                icon={Rocket01Icon}
                className="h-4 w-4"
                aria-hidden="true"
              />
            )}
            {publishMutation.isPending ? 'Publishing…' : 'Publish to LinkedIn'}
          </button>
        </div>
      </div>

      {/* Right column — chat panel */}
      <aside className="min-h-0 lg:h-full">
        <LinkedInChatPanel
          draft={text}
          identityType={selectedIdentity?.identity_type ?? 'person'}
        />
      </aside>
    </div>
  )
}
