// HistoryTile — completed/failed job tile with preview + social dispatch.

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Facebook01Icon,
  ImageDownload02Icon,
  InstagramIcon,
  Linkedin01Icon,
} from '@hugeicons/core-free-icons'
import type { AccentColor } from '../tokens'
import type { QueueEntry } from '../types'

export function HistoryTile({
  entry,
  onPreview,
  onDispatch,
}: {
  entry: QueueEntry
  onPreview: (entry: QueueEntry) => void
  onDispatch: (
    entry: QueueEntry,
    platform: 'linkedin' | 'instagram' | 'facebook',
  ) => void
}) {
  const done = entry.status === 'done' && Boolean(entry.artifactUrl)
  const failed = entry.status === 'failed'
  const color: AccentColor = done ? 'emerald' : failed ? 'rose' : 'amber'

  return (
    <div
      className="group relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-[var(--mc-surface)] p-3"
      style={{
        borderColor: `var(--mc-${color})`,
        boxShadow: `0 0 24px -16px var(--mc-${color})`,
      }}
    >
      <div
        className="relative aspect-video w-full overflow-hidden rounded-md border border-[var(--mc-border)]"
        style={{ background: 'var(--mc-bg)' }}
      >
        {done ? (
          // Wan2GP today emits MP4 even for single-frame "image" mode, so the
          // preview is always a <video>. When upstream grows /generate/image
          // we can branch to <img/> for true image profiles.
          <video
            src={entry.artifactUrl ?? undefined}
            controls
            playsInline
            muted
            className="h-full w-full object-cover"
            aria-label={`Generated ${entry.kind}: ${entry.prompt}`}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: `var(--mc-${color})` }}
          >
            {failed ? 'failed' : 'no preview'}
          </div>
        )}
      </div>
      <div className="line-clamp-2 text-[11px] leading-snug text-[var(--mc-text)]">
        {entry.prompt}
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-[var(--mc-text-dimmer)]">
        <span>
          {entry.kind} · {entry.effectiveResolution}
        </span>
        <span>
          {entry.finishedAt
            ? new Date(entry.finishedAt * 1000).toLocaleTimeString()
            : ''}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {done && (
          <>
            <button
              type="button"
              onClick={() => onPreview(entry)}
              className="inline-flex items-center gap-1 rounded border border-[var(--mc-border)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--mc-text-dim)] hover:border-[var(--mc-border-bright)] hover:text-[var(--mc-text)]"
            >
              <HugeiconsIcon icon={ImageDownload02Icon} size={11} />
              open
            </button>
            <div className="ml-auto flex items-center gap-1">
              <PlatformButton
                icon={Linkedin01Icon}
                label="LinkedIn"
                onClick={() => onDispatch(entry, 'linkedin')}
              />
              <PlatformButton
                icon={InstagramIcon}
                label="Instagram"
                onClick={() => onDispatch(entry, 'instagram')}
              />
              <PlatformButton
                icon={Facebook01Icon}
                label="Facebook"
                onClick={() => onDispatch(entry, 'facebook')}
              />
            </div>
          </>
        )}
        {failed && entry.error && (
          <span className="line-clamp-1 text-[10px] text-[var(--mc-rose)]">
            {entry.error}
          </span>
        )}
      </div>
    </div>
  )
}

function PlatformButton({
  icon,
  label,
  onClick,
}: {
  icon: typeof Linkedin01Icon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Send to ${label}`}
      title={`Send to ${label}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--mc-border)] text-[var(--mc-text-dim)] transition hover:border-[var(--mc-border-bright)] hover:text-[var(--mc-cyan)]"
    >
      <HugeiconsIcon icon={icon} size={12} />
    </button>
  )
}
