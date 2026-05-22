// Postiz composer — media uploader.
//
// Postiz expects media URLs in the post payload (the public-API contract
// shipped in routes/api/postiz/post.ts maps `mediaUrls: string[]` →
// `value[].image[].path`). This component does NOT proxy uploads through
// the dashboard backend (no /api/postiz/upload exists, by design — we don't
// re-host customer media). Instead:
//   - Operator pastes a URL → we add it directly to the list.
//   - Operator picks/drops a local file → we create a blob: URL for preview
//     ONLY and surface a clear warning that the URL is local-only and must
//     be replaced before posting.
//
// Validates mime against the explicit allow-list from the parent task. Caps
// at 4 items (Postiz UI's working limit for most platforms).
//
// Called from: src/screens/postiz/postiz-composer.tsx.

import { useCallback, useId, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Cancel01Icon,
  ImageAdd02Icon,
  Pdf01Icon,
  Video01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

export interface PostizMedia {
  // Stable identifier for React keying. Not sent to Postiz.
  id: string
  // The URL passed to Postiz. For blob: URLs this is a LOCAL preview only.
  url: string
  // True when `url` is a blob: URL — Postiz cannot reach it. UI surfaces a
  // warning so the operator knows to replace it before posting.
  localOnly: boolean
  fileName: string
  mimeType: string
  // 'image' | 'video' | 'document' — drives the preview tile.
  kind: 'image' | 'video' | 'document'
  byteLength: number | null
  altText?: string
}

interface Props {
  items: PostizMedia[]
  onChange: (next: PostizMedia[]) => void
  disabled?: boolean
}

const ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,application/pdf,video/mp4'

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'application/pdf',
])

const MAX_ITEMS = 4
const MAX_BYTES = 20 * 1024 * 1024

function formatBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function kindForMime(mime: string): 'image' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function PostizMediaUploader({ items, onChange, disabled }: Props) {
  const inputId = useId()
  const urlInputId = useId()
  const dropRef = useRef<HTMLLabelElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setError(null)
      const next: PostizMedia[] = [...items]
      const arr = Array.from(files)
      for (const file of arr) {
        if (next.length >= MAX_ITEMS) {
          setError(`Max ${MAX_ITEMS} media items per post.`)
          break
        }
        if (!ALLOWED_MIMES.has(file.type)) {
          setError(
            `${file.name || 'file'} has unsupported type "${file.type || 'unknown'}". Allowed: JPG, PNG, GIF, WEBP, MP4, PDF.`,
          )
          continue
        }
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is ${formatBytes(file.size)} (max 20 MB).`)
          continue
        }
        const blobUrl = URL.createObjectURL(file)
        next.push({
          id: uid(),
          url: blobUrl,
          localOnly: true,
          fileName: file.name,
          mimeType: file.type,
          kind: kindForMime(file.type),
          byteLength: file.size,
        })
      }
      onChange(next)
    },
    [items, onChange],
  )

  const addUrl = useCallback(() => {
    setError(null)
    const trimmed = urlDraft.trim()
    if (!trimmed) return
    if (items.length >= MAX_ITEMS) {
      setError(`Max ${MAX_ITEMS} media items per post.`)
      return
    }
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      setError('That does not look like a valid URL.')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('Only http:// and https:// URLs are accepted.')
      return
    }
    // Best-effort mime guess from extension. Postiz will validate server-side.
    const lower = parsed.pathname.toLowerCase()
    const ext = lower.split('.').pop() ?? ''
    const mimeByExt: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      pdf: 'application/pdf',
    }
    const mime = mimeByExt[ext] ?? 'application/octet-stream'

    onChange([
      ...items,
      {
        id: uid(),
        url: trimmed,
        localOnly: false,
        fileName: parsed.pathname.split('/').pop() || trimmed,
        mimeType: mime,
        kind: kindForMime(mime),
        byteLength: null,
      },
    ])
    setUrlDraft('')
  }, [items, onChange, urlDraft])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      if (disabled) return
      if (!e.dataTransfer?.files?.length) return
      addFiles(e.dataTransfer.files)
    },
    [disabled, addFiles],
  )

  const onRemove = useCallback(
    (id: string) => {
      const target = items.find((m) => m.id === id)
      if (target && target.localOnly && target.url.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(target.url)
        } catch {
          // ignore
        }
      }
      onChange(items.filter((m) => m.id !== id))
    },
    [items, onChange],
  )

  const onAltChange = useCallback(
    (id: string, altText: string) => {
      onChange(items.map((m) => (m.id === id ? { ...m, altText } : m)))
    },
    [items, onChange],
  )

  const atCap = items.length >= MAX_ITEMS
  const hasLocalOnly = items.some((m) => m.localOnly)

  return (
    <div className="space-y-2">
      <label
        ref={dropRef}
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled && !atCap) setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm transition-colors',
          'focus-within:outline-none focus-within:ring-2 focus-within:ring-[var(--mc-cyan)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--mc-bg)]',
          isDragOver
            ? 'border-[color:var(--mc-cyan)]/60 bg-[color:var(--mc-cyan-soft)]'
            : 'border-[color:var(--mc-border-bright)] bg-[color:var(--mc-surface-2)] hover:bg-[color:var(--mc-surface)]',
          (disabled || atCap) && 'cursor-not-allowed opacity-60',
        )}
        style={{ color: 'var(--mc-text-dim, #8FA3BF)' }}
      >
        <HugeiconsIcon
          icon={ImageAdd02Icon}
          className="h-5 w-5"
          aria-hidden="true"
        />
        <span style={{ color: 'var(--mc-text)' }}>
          {atCap
            ? `${MAX_ITEMS} of ${MAX_ITEMS} media items attached`
            : 'Drop media here, or click to choose. Up to 20 MB each.'}
        </span>
        <span className="text-xs" style={{ color: 'var(--mc-text-dimmer)' }}>
          Accepted: JPG, PNG, GIF, WEBP, MP4, PDF · Max {MAX_ITEMS} per post
        </span>
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          disabled={disabled || atCap}
          onChange={(e) => {
            const files = e.target.files
            if (files && files.length > 0) {
              addFiles(files)
              e.target.value = ''
            }
          }}
        />
      </label>

      {/* URL-paste fallback — the honest path for Postiz, which expects URLs */}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={urlInputId}>
          Or paste a media URL
        </label>
        <input
          id={urlInputId}
          type="url"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder="…or paste a hosted media URL (https://…)"
          disabled={disabled || atCap}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addUrl()
            }
          }}
          className={cn(
            'flex-1 rounded-md border px-2 py-1.5 text-sm',
            'border-[color:var(--mc-border-bright)] bg-[color:var(--mc-surface)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          style={{ color: 'var(--mc-text)' }}
        />
        <button
          type="button"
          onClick={addUrl}
          disabled={disabled || atCap || urlDraft.trim().length === 0}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors',
            'border-[color:var(--mc-border-bright)] bg-[color:var(--mc-surface)]',
            'hover:bg-[color:var(--mc-surface-2)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          style={{ color: 'var(--mc-text)' }}
        >
          Add URL
        </button>
      </div>

      {hasLocalOnly ? (
        <div
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
          role="status"
          style={{
            borderColor: 'var(--mc-amber)',
            background: 'var(--mc-amber-soft)',
            color: 'var(--mc-amber)',
          }}
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <div>
            One or more attachments are local-only previews (blob: URLs). Postiz
            cannot fetch these — replace with a hosted URL before publishing.
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-md border px-3 py-2 text-xs"
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

      {items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {items.map((m) => (
            <li
              key={m.id}
              className="group relative overflow-hidden rounded-lg border"
              style={{
                borderColor: m.localOnly
                  ? 'var(--mc-amber)'
                  : 'var(--mc-border-bright)',
                background: 'var(--mc-surface)',
              }}
            >
              <div className="aspect-square w-full">
                {m.kind === 'image' ? (
                  <img
                    src={m.url}
                    alt={m.altText || m.fileName}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="flex h-full w-full flex-col items-center justify-center gap-2"
                    style={{ color: 'var(--mc-text-dim)' }}
                  >
                    <HugeiconsIcon
                      icon={m.kind === 'video' ? Video01Icon : Pdf01Icon}
                      className="h-10 w-10"
                      aria-hidden="true"
                    />
                    <span className="px-2 text-center text-xs">
                      {m.fileName}
                    </span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                aria-label={`Remove ${m.fileName}`}
                className={cn(
                  'absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full',
                  'bg-black/60 text-white opacity-90 transition-colors',
                  'hover:bg-[color:var(--mc-rose)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mc-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mc-bg)]',
                )}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </button>
              <div
                className="border-t px-2 py-1.5 text-[10px]"
                style={{
                  borderColor: 'var(--mc-border)',
                  background: 'var(--mc-bg)',
                  color: 'var(--mc-text-dim)',
                }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{m.fileName}</span>
                  <span>{formatBytes(m.byteLength)}</span>
                </div>
                {m.localOnly ? (
                  <div
                    className="mt-0.5 truncate text-[10px]"
                    style={{ color: 'var(--mc-amber)' }}
                  >
                    local preview — replace before posting
                  </div>
                ) : null}
                {m.kind === 'image' ? (
                  <input
                    type="text"
                    value={m.altText ?? ''}
                    onChange={(e) => onAltChange(m.id, e.target.value)}
                    placeholder="Alt text (a11y)"
                    aria-label={`Alt text for ${m.fileName}`}
                    className={cn(
                      'mt-1 w-full rounded border px-1.5 py-0.5 text-[10px]',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--mc-cyan)]',
                    )}
                    style={{
                      borderColor: 'var(--mc-border-bright)',
                      background: 'var(--mc-surface-2)',
                      color: 'var(--mc-text)',
                    }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
