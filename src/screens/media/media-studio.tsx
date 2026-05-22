// MediaStudio — AI Media Studio (image + video generation at 4K via Wan2GP).
//
// Design tokens come from MC_STYLE (mirrored from
// conductor-mission-control.tsx). Respects prefers-reduced-motion.
// No mocks: if Wan2GP isn't reachable, the real error surfaces.

import { useCallback, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AiBrain03Icon,
  Clock01Icon,
  CpuIcon,
  LayoutGridIcon,
  Share01Icon,
} from '@hugeicons/core-free-icons'
import { usePageTitle } from '@/hooks/use-page-title'
import { toast } from '@/components/ui/toast'
import type { GeneratorProfileId } from '@/server/wan2gp-adapter'

import { MC_STYLE } from './tokens'
import type { GenerateResponse, QueueEntry } from './types'
import { ScanlineBackdrop } from './components/scanline-backdrop'
import { StudioStatusBar } from './components/studio-status-bar'
import { SectionLabel } from './components/section-label'
import { GeneratorCard } from './components/generator-card'
import { SkillsRail } from './components/skills-rail'
import { PromptComposer } from './components/prompt-composer'
import { QueueRow } from './components/queue-row'
import { HistoryTile } from './components/history-tile'
import { useSkillsAndProfiles } from './hooks/use-skills-and-profiles'
import { useJobPolling } from './hooks/use-job-polling'

export function MediaStudio() {
  usePageTitle('Media Studio')
  const {
    skills,
    profiles,
    error: hydrateError,
    loaded,
  } = useSkillsAndProfiles()

  const [selectedProfile, setSelectedProfile] =
    useState<GeneratorProfileId>('wan2gp-video')
  const [activeSkillIds, setActiveSkillIds] = useState<Set<string>>(
    () => new Set(['4k', 'cinematic']),
  )
  const [prompt, setPrompt] = useState('')
  const [width, setWidth] = useState(3840)
  const [height, setHeight] = useState(2160)
  const [fps, setFps] = useState(30)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [queue, setQueue] = useState<QueueEntry[]>([])

  useJobPolling(queue, setQueue)

  const selectedProfileObj = useMemo(
    () => profiles.find((p) => p.id === selectedProfile) ?? null,
    [profiles, selectedProfile],
  )
  const kind: 'image' | 'video' = selectedProfileObj?.kind ?? 'video'

  const toggleSkill = useCallback((id: string) => {
    setActiveSkillIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const canSubmit =
    prompt.trim().length >= 3 &&
    !isSubmitting &&
    selectedProfileObj?.available === true

  const onSubmit = useCallback(async () => {
    if (!canSubmit || !selectedProfileObj) return
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: selectedProfileObj.id,
          prompt: prompt.trim(),
          skillIds: Array.from(activeSkillIds),
          width,
          height,
          fps,
        }),
      })
      const data = (await res.json()) as GenerateResponse
      if (!res.ok || !data.ok || !data.submission) {
        toast(data.error ?? `Wan2GP error (HTTP ${res.status})`, {
          type: 'error',
          duration: 8000,
        })
        return
      }
      const s = data.submission
      setQueue((q) => [
        {
          jobId: s.jobId,
          profileId: s.profileId,
          kind: selectedProfileObj.kind,
          prompt: s.prompt,
          effectivePrompt: s.effectivePrompt,
          effectiveResolution: s.effectiveResolution,
          targetWidth: s.targetWidth,
          targetHeight: s.targetHeight,
          submittedAt: s.createdAt,
          status: 'queued',
          progress: null,
          phase: null,
          error: null,
          artifactUrl: null,
          finishedAt: null,
        },
        ...q,
      ])
      toast(`Job queued · ${s.jobId.slice(0, 8)}`, { type: 'success' })
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), {
        type: 'error',
        duration: 8000,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [
    canSubmit,
    selectedProfileObj,
    prompt,
    activeSkillIds,
    width,
    height,
    fps,
  ])

  const onCancel = useCallback((jobId: string) => {
    // Wan2GP adapter exposes no cancel endpoint today. Mark the local row
    // as removed; the real job will complete or expire server-side.
    toast(
      'Wan2GP has no cancel endpoint yet — job will finish or expire server-side. Local row removed.',
      { type: 'warning', duration: 6000 },
    )
    setQueue((q) => q.filter((e) => e.jobId !== jobId))
  }, [])

  const onClearHistory = useCallback(() => {
    setQueue((q) =>
      q.filter((e) => e.status === 'queued' || e.status === 'running'),
    )
  }, [])

  const onPreview = useCallback((entry: QueueEntry) => {
    if (!entry.artifactUrl) return
    window.open(entry.artifactUrl, '_blank', 'noopener,noreferrer')
  }, [])

  const onDispatch = useCallback(
    async (
      entry: QueueEntry,
      platform: 'linkedin' | 'instagram' | 'facebook',
    ) => {
      if (!entry.artifactUrl) return
      try {
        const res = await fetch('/api/social/dispatch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform,
            jobId: entry.jobId,
            artifactUrl: entry.artifactUrl,
            kind: entry.kind,
            caption: entry.prompt,
          }),
        })
        if (res.status === 404) {
          toast(
            `Pipeline not wired — TODO: implement /api/social/dispatch (${platform}).`,
            { type: 'warning', duration: 6000 },
          )
          return
        }
        const data = (await res.json()) as { ok?: boolean; error?: string }
        if (!res.ok || !data.ok) {
          toast(
            data.error ?? `Dispatch to ${platform} failed (${res.status})`,
            {
              type: 'error',
            },
          )
          return
        }
        toast(`Sent to ${platform}`, { type: 'success' })
      } catch (err) {
        toast(
          `Pipeline not wired — see TODO: implement /api/social/dispatch (${platform}). [${
            err instanceof Error ? err.message : String(err)
          }]`,
          { type: 'warning', duration: 8000 },
        )
      }
    },
    [],
  )

  const activeCount = queue.filter(
    (e) => e.status === 'queued' || e.status === 'running',
  ).length
  const doneCount = queue.filter((e) => e.status === 'done').length
  const failedCount = queue.filter((e) => e.status === 'failed').length

  return (
    <div
      className="relative min-h-full bg-[var(--mc-bg)] text-[var(--mc-text)]"
      style={MC_STYLE}
    >
      <ScanlineBackdrop />
      <StudioStatusBar
        activeCount={activeCount}
        doneCount={doneCount}
        failedCount={failedCount}
        onClearHistory={onClearHistory}
      />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
        {hydrateError && (
          <div className="rounded-lg border border-[var(--mc-rose)]/60 bg-[var(--mc-rose-soft)] px-4 py-3 font-mono text-[12px] text-[var(--mc-rose)]">
            Skill registry failed to load: {hydrateError}
          </div>
        )}

        <section className="flex flex-col gap-3">
          <SectionLabel
            icon={LayoutGridIcon}
            label="Generator profile"
            sub={loaded ? `${profiles.length} profiles available` : 'loading…'}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((p) => (
              <GeneratorCard
                key={p.id}
                profile={p}
                selected={p.id === selectedProfile}
                onSelect={setSelectedProfile}
              />
            ))}
            {!loaded &&
              Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] motion-reduce:animate-none"
                />
              ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PromptComposer
              prompt={prompt}
              setPrompt={setPrompt}
              width={width}
              height={height}
              fps={fps}
              setWidth={setWidth}
              setHeight={setHeight}
              setFps={setFps}
              kind={kind}
              onSubmit={onSubmit}
              isSubmitting={isSubmitting}
              canSubmit={canSubmit}
            />
            <div className="mt-3 flex flex-col gap-2">
              <SectionLabel
                icon={AiBrain03Icon}
                label="Skills"
                sub={`${activeSkillIds.size} active`}
              />
              <SkillsRail
                skills={skills}
                activeIds={activeSkillIds}
                onToggle={toggleSkill}
              />
            </div>
          </div>

          <aside className="flex flex-col gap-2">
            <SectionLabel
              icon={Clock01Icon}
              label="Live queue"
              sub={activeCount > 0 ? `${activeCount} active` : 'idle'}
            />
            <div className="flex flex-col gap-2">
              {queue.filter(
                (e) => e.status === 'queued' || e.status === 'running',
              ).length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--mc-border)] px-3 py-6 text-center font-mono text-[11px] text-[var(--mc-text-dimmer)]">
                  No active generations. Submit a prompt to queue one.
                </div>
              ) : (
                queue
                  .filter(
                    (e) => e.status === 'queued' || e.status === 'running',
                  )
                  .map((e) => (
                    <QueueRow key={e.jobId} entry={e} onCancel={onCancel} />
                  ))
              )}
            </div>
          </aside>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel
            icon={CpuIcon}
            label="History"
            sub={
              doneCount + failedCount > 0
                ? `${doneCount} done · ${failedCount} failed`
                : 'no generations yet'
            }
          />
          {doneCount + failedCount === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--mc-border)] px-3 py-12 text-center font-mono text-[12px] text-[var(--mc-text-dimmer)]">
              No generations yet. Outputs you create will appear here for
              preview, download, and social dispatch.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {queue
                .filter((e) => e.status === 'done' || e.status === 'failed')
                .map((e) => (
                  <HistoryTile
                    key={e.jobId}
                    entry={e}
                    onPreview={onPreview}
                    onDispatch={onDispatch}
                  />
                ))}
            </div>
          )}
        </section>

        <div className="flex items-center justify-center pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mc-text-dimmer)]">
          <HugeiconsIcon icon={Share01Icon} size={11} className="mr-1.5" />
          social dispatch: /api/social/dispatch · TODO upstream
        </div>
      </div>
    </div>
  )
}
