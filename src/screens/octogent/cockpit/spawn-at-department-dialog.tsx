/**
 * SpawnAtDepartmentDialog — opened when a puck is dragged onto a department
 * (a SERVICES rim node or the KG anchor). It SPAWNS A NEW agent at that
 * department — it never moves/teleports the dragged agent, because an existing
 * terminal's tentacleId is immutable upstream (see fake_to_avoid). The copy is
 * deliberately explicit: "Spawn new agent at <Dept>".
 *
 * Real contract: spawnTerminal({ workspaceMode, tentacleId?, initialPrompt?,
 * displayName? }) → POST /octogent/api/terminals. On success, invalidates
 * ['octogent','agents'] so the floor shows the new puck.
 *
 * If the department has no resolved tentacleId (SERVICE_TO_TENTACLE returns
 * undefined), spawning is disabled with an honest label rather than POSTing a
 * tentacle-less spawn that wouldn't land at the intended department.
 */
import { type CSSProperties, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { spawnTerminal } from '@/lib/octogent-api'
import { cn } from '@/lib/utils'

const CYAN = '#00E5FF'
const ROSE = '#FF6B8B'
const EMERALD = '#3DF5A1'
const TEXT = '#E6F1FF'
const DIM = '#8FA3BF'
const DIMMER = '#7A8FA8'

function glass(accent: string, strong = false): CSSProperties {
  return {
    background: 'rgba(13, 19, 29, 0.55)',
    backdropFilter: 'blur(22px) saturate(180%)',
    WebkitBackdropFilter: 'blur(22px) saturate(180%)',
    border: `1px solid ${strong ? accent : 'rgba(255,255,255,0.12)'}`,
    boxShadow: `0 16px 50px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.30), inset 0 -2px 8px rgba(0,0,0,0.30)${strong ? `, 0 0 36px -6px ${accent}` : ''}`,
  }
}

export function SpawnAtDepartmentDialog({
  deptLabel,
  tentacleId,
  draggedFromLabel,
  onClose,
}: {
  deptLabel: string
  /** Resolved tentacle id for the department, or undefined if unmapped. */
  tentacleId?: string
  /** Label of the puck that was dragged (context only — NOT teleported). */
  draggedFromLabel?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [initialPrompt, setInitialPrompt] = useState('')
  const [workspaceMode, setWorkspaceMode] = useState<'shared' | 'worktree'>(
    'shared',
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const canSpawn = Boolean(tentacleId) && !pending && !done

  async function spawn() {
    if (!tentacleId) return
    setPending(true)
    setError(null)
    try {
      await spawnTerminal({
        workspaceMode,
        tentacleId,
        initialPrompt: initialPrompt.trim() || undefined,
        displayName: `${deptLabel} agent`,
      })
      void qc.invalidateQueries({ queryKey: ['octogent', 'agents'] })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="absolute left-1/2 top-1/2 z-40 w-[380px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-4"
      role="dialog"
      aria-label={`Spawn new agent at ${deptLabel}`}
      style={{ ...glass(CYAN, true), color: TEXT }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: CYAN }}
        >
          Spawn new agent at {deptLabel}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close spawn dialog"
          className="cursor-pointer rounded px-1.5 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
          style={{ color: DIM }}
        >
          ✕
        </button>
      </div>

      <div
        className="mb-3 font-mono text-[10px] leading-relaxed"
        style={{ color: DIMMER }}
      >
        {draggedFromLabel ? (
          <>
            This spawns a brand-new agent at{' '}
            <span style={{ color: TEXT }}>{deptLabel}</span> — it does not move{' '}
            <span style={{ color: TEXT }}>{draggedFromLabel}</span>.
          </>
        ) : (
          <>
            A brand-new agent will be created and docked at{' '}
            <span style={{ color: TEXT }}>{deptLabel}</span>.
          </>
        )}
        <div className="mt-1">
          tentacle:{' '}
          {tentacleId ? (
            <span style={{ color: CYAN }}>{tentacleId}</span>
          ) : (
            <span style={{ color: ROSE }}>not mapped — spawn unavailable</span>
          )}
        </div>
      </div>

      {done ? (
        <div
          className="rounded-lg px-3 py-2 font-mono text-[11px]"
          style={{ ...glass(EMERALD), color: EMERALD }}
          aria-live="polite"
        >
          Agent spawned at {deptLabel}. It will appear in orbit shortly.
        </div>
      ) : (
        <>
          <label
            className="font-mono text-[9px] uppercase tracking-wider"
            style={{ color: DIMMER }}
          >
            initial prompt (optional)
          </label>
          <textarea
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            rows={3}
            placeholder="What should this agent start working on?"
            aria-label="Initial prompt"
            disabled={!tentacleId}
            className="mt-1 w-full resize-none rounded-lg px-3 py-2 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF] disabled:opacity-50"
            style={{
              background: 'rgba(7,10,17,0.55)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: TEXT,
            }}
          />

          <div className="mt-3 flex items-center gap-2">
            <span
              className="font-mono text-[9px] uppercase tracking-wider"
              style={{ color: DIMMER }}
            >
              workspace
            </span>
            {(['shared', 'worktree'] as const).map((m) => {
              const active = workspaceMode === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWorkspaceMode(m)}
                  aria-pressed={active}
                  className="cursor-pointer rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]"
                  style={{
                    color: active ? CYAN : DIMMER,
                    background: active
                      ? 'rgba(0, 229, 255, 0.12)'
                      : 'transparent',
                    border: `1px solid ${active ? 'rgba(0, 229, 255, 0.32)' : 'rgba(255,255,255,0.10)'}`,
                  }}
                >
                  {m}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => void spawn()}
            disabled={!canSpawn}
            className={cn(
              'mt-4 w-full cursor-pointer rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]',
              !canSpawn && 'cursor-not-allowed opacity-50',
            )}
            style={{
              color: canSpawn ? CYAN : DIMMER,
              background: canSpawn ? 'rgba(0, 229, 255, 0.12)' : 'transparent',
              border: `1px solid ${canSpawn ? 'rgba(0, 229, 255, 0.32)' : 'rgba(255,255,255,0.10)'}`,
            }}
          >
            {pending ? 'Spawning…' : `Spawn agent at ${deptLabel}`}
          </button>
        </>
      )}

      {error && (
        <div
          className="mt-3 rounded-lg px-3 py-2 font-mono text-[10px]"
          style={{ ...glass(ROSE), color: ROSE }}
          aria-live="polite"
        >
          {error}
        </div>
      )}
    </div>
  )
}
