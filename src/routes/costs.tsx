import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'
import { MC_STYLE } from '@/screens/agents/operations-screen'

const CostsScreen = lazy(() =>
  import('@/screens/costs/costs-screen').then((m) => ({
    default: m.CostsScreen,
  })),
)

export const Route = createFileRoute('/costs')({
  ssr: false,
  component: function CostsRoute() {
    usePageTitle('Costs')
    return (
      <div style={MC_STYLE} className="h-full">
        <ErrorBoundary
          title="Cost Analytics Error"
          description="Failed to load cost analytics. Try reloading."
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div
                  className="text-sm"
                  style={{ color: 'var(--mc-text-dim)' }}
                >
                  Loading cost analytics…
                </div>
              </div>
            }
          >
            <CostsScreen />
          </Suspense>
        </ErrorBoundary>
      </div>
    )
  },
})
