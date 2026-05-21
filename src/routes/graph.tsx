import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const GraphScreen = lazy(() =>
  import('@/screens/graph/graph-screen').then((m) => ({
    default: m.GraphScreen,
  })),
)

export const Route = createFileRoute('/graph')({
  ssr: false,
  component: function GraphRoute() {
    usePageTitle('Knowledge Graph')
    return (
      <ErrorBoundary
        title="Graph Error"
        description="Failed to load the Graph module. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">Loading…</div>
            </div>
          }
        >
          <GraphScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
