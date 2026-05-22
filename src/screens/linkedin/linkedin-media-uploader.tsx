// LinkedIn composer — media uploader.
//
// Drag/click → FileReader → DataURL → POST /api/linkedin/upload (base64).
// On success the server returns a token + fileUrl; the parent composer holds
// the list. On remove-tile, we fire DELETE /api/linkedin/upload?token=… so
// the temp file is cleaned up.

import { useCallback, useId, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  ImageAdd02Icon,
  Pdf01Icon,
  Video01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

export interface UploadedMedia {
  token: string
  fileUrl: string
  fileName: string
  mimeType: string
  assetType: 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  byteLength: number
  altText?: string
}

interface Props {
  items: UploadedMedia[]
  onChange: (next: UploadedMedia[]) => void
  disabled?: boolean
}

const ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,application/pdf,video/mp4'

const MAX_BYTES = 20 * 1024 * 1024

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  // Node-style Buffer isn't available in the browser; use a chunked btoa.
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function LinkedInMediaUploader({ items, onChange, disabled }: Props) {
  const inputId = useId()
  const dropRef = useRef<HTMLLabelElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null)
      setBusy(true)
      try {
        const arr = Array.from(files)
        const next: UploadedMedia[] = [...items]
        for (const file of arr) {
          if (file.size > MAX_BYTES) {
            throw new Error(
              `${file.name} is ${formatBytes(file.size)} (max 20 MB).`,
            )
          }
          const base64 = await fileToBase64(file)
          const res = await fetch('/api/linkedin/upload', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type,
              base64,
            }),
          })
          const json = (await res.json()) as
            | {
                ok: true
                token: string
                fileUrl: string
                fileName: string
                mimeType: string
                assetType: 'IMAGE' | 'VIDEO' | 'DOCUMENT'
                byteLength: number
              }
            | { ok: false; error: string }
          if (!res.ok || !json.ok) {
            throw new Error(
              ('error' in json && json.error) ||
                `Upload failed (HTTP ${res.status})`,
            )
          }
          next.push({
            token: json.token,
            fileUrl: json.fileUrl,
            fileName: json.fileName,
            mimeType: json.mimeType,
            assetType: json.assetType,
            byteLength: json.byteLength,
          })
        }
        onChange(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [items, onChange],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      if (disabled) return
      if (!e.dataTransfer?.files?.length) return
      void uploadFiles(e.dataTransfer.files)
    },
    [disabled, uploadFiles],
  )

  const onRemove = useCallback(
    async (token: string) => {
      onChange(items.filter((m) => m.token !== token))
      // Best-effort cleanup of server tempfile.
      try {
        await fetch(`/api/linkedin/upload?token=${encodeURIComponent(token)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
      } catch {
        // ignore; cleanup happens eventually via TTL eviction
      }
    },
    [items, onChange],
  )

  const onAltChange = useCallback(
    (token: string, altText: string) => {
      onChange(items.map((m) => (m.token === token ? { ...m, altText } : m)))
    },
    [items, onChange],
  )

  const carouselCap = items.filter((m) => m.assetType === 'IMAGE').length >= 9
  const hasDocument = items.some((m) => m.assetType === 'DOCUMENT')
  const hasVideo = items.some((m) => m.assetType === 'VIDEO')
  const canAddMore = !(
    busy ||
    disabled ||
    carouselCap ||
    hasDocument ||
    hasVideo
  )

  return (
    <div className="space-y-2">
      <label
        ref={dropRef}
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm transition-colors',
          'focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-400',
          isDragOver
            ? 'border-cyan-400/60 bg-cyan-500/10'
            : 'border-primary-700/60 bg-primary-900/30 hover:bg-primary-900/50',
          (busy || disabled) && 'cursor-not-allowed opacity-60',
        )}
        style={{ color: 'var(--mc-text-dim, #8FA3BF)' }}
      >
        <HugeiconsIcon
          icon={ImageAdd02Icon}
          className="h-5 w-5"
          aria-hidden="true"
        />
        <span>
          {busy
            ? 'Uploading…'
            : carouselCap
              ? 'Carousel full (9 images max)'
              : hasDocument
                ? 'PDF attached — remove it to add other media'
                : hasVideo
                  ? 'Video attached — remove it to add other media'
                  : 'Drop media here, or click to choose. Up to 20 MB.'}
        </span>
        <span className="text-xs text-primary-500">
          Accepted: JPG, PNG, GIF, WEBP, PDF, MP4
        </span>
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          disabled={!canAddMore}
          onChange={(e) => {
            const files = e.target.files
            if (files && files.length > 0) {
              void uploadFiles(files)
              e.target.value = ''
            }
          }}
        />
      </label>

      {error ? (
        <div
          className="rounded-md border border-rose-700/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-300"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((m) => (
            <li
              key={m.token}
              className="group relative overflow-hidden rounded-lg border border-primary-800/50 bg-primary-900/40"
            >
              <div className="aspect-square w-full">
                {m.assetType === 'IMAGE' ? (
                  <img
                    src={m.fileUrl}
                    alt={m.altText || m.fileName}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-primary-300">
                    <HugeiconsIcon
                      icon={m.assetType === 'VIDEO' ? Video01Icon : Pdf01Icon}
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
                onClick={() => void onRemove(m.token)}
                aria-label={`Remove ${m.fileName}`}
                className={cn(
                  'absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full',
                  'bg-black/60 text-white opacity-90 transition-colors',
                  'hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400',
                )}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </button>
              <div className="border-t border-primary-800/40 bg-primary-950/60 px-2 py-1.5 text-[10px] text-primary-400">
                <div className="flex items-center justify-between">
                  <span className="truncate">{m.fileName}</span>
                  <span>{formatBytes(m.byteLength)}</span>
                </div>
                {m.assetType === 'IMAGE' ? (
                  <input
                    type="text"
                    value={m.altText ?? ''}
                    onChange={(e) => onAltChange(m.token, e.target.value)}
                    placeholder="Alt text (a11y)"
                    aria-label={`Alt text for ${m.fileName}`}
                    className={cn(
                      'mt-1 w-full rounded border border-primary-800/60 bg-primary-900/40 px-1.5 py-0.5 text-[10px] text-primary-200',
                      'focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400',
                    )}
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
