import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { CpuIcon, AiBrain03Icon } from '@hugeicons/core-free-icons'
import { Conductor } from '@/screens/gateway/conductor-mission-control'
import { cn } from '@/lib/utils'

// The live engine floor (all agents, transparent, no scopes) is lazy — Mission
// Control is the default view and stays in the initial bundle.
const EngineFloorLive = lazy(() =>
  import('@/screens/octogent/engine-floor-live').then((m) => ({
    default: m.EngineFloorLive,
  })),
)

type ConductorView = 'mission-control' | 'octogent'

const VIEWS: ReadonlyArray<{
  id: ConductorView
  label: string
  icon: typeof CpuIcon
}> = [
  { id: 'mission-control', label: 'Mission Control', icon: CpuIcon },
  { id: 'octogent', label: 'Octogent', icon: AiBrain03Icon },
]

// Conductor hosts two integrated views behind a segmented control:
//   - Mission Control: the live mission HUD (decompose → run → complete)
//   - Octogent: the live engine floor — every agent on the platform perched at
//     the service it works on, moving + sparking as it acts, on a transparent
//     background so it floats on the HUD's navy. No tentacles / scope grid.
function ConductorRoute() {
  const [view, setView] = useState<ConductorView>('mission-control')

  return (
    <div className="flex h-full flex-col bg-[#070A11]">
      <div
        role="tablist"
        aria-label="Conductor views"
        className="flex shrink-0 items-center gap-1 border-b px-4 py-2"
        style={{
          borderColor: 'rgba(0, 229, 255, 0.10)',
          background: 'rgba(7, 10, 17, 0.92)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <span className="mr-3 font-mono text-[10px] uppercase tracking-[0.32em] text-[#7A8FA8]">
          CONDUCTOR
        </span>
        {VIEWS.map((v) => {
          const active = view === v.id
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(v.id)}
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A11]',
              )}
              style={{
                color: active ? '#00E5FF' : '#8FA3BF',
                background: active ? 'rgba(0, 229, 255, 0.12)' : 'transparent',
                border: active
                  ? '1px solid rgba(0, 229, 255, 0.32)'
                  : '1px solid transparent',
              }}
            >
              <HugeiconsIcon icon={v.icon} size={14} />
              {v.label}
            </button>
          )
        })}
      </div>

      {/* Active view panel. EngineFloorLive is self-contained: it hoists its own
          useConductorGateway (shared TanStack query cache → no extra fetch) so
          the orchestrator-core "launch mission" reuses the same sendMission →
          /api/conductor-spawn path Mission Control uses. No prop wiring needed;
          Mission Control stays the SSOT via the shared cache. */}
      <div
        role="tabpanel"
        aria-label={
          view === 'mission-control'
            ? 'Mission Control'
            : 'Octogent engine floor'
        }
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {view === 'mission-control' ? (
          <Conductor />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-[0.2em] text-[#7A8FA8]">
                Loading engine floor…
              </div>
            }
          >
            <EngineFloorLive />
          </Suspense>
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/conductor')({
  ssr: false,
  component: ConductorRoute,
})
