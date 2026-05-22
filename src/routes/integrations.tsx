import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const IntegrationsScreen = lazy(() =>
  import('@/screens/integrations/integrations-screen').then((m) => ({
    default: m.IntegrationsScreen,
  })),
)

export const Route = createFileRoute('/integrations')({
  ssr: false,
  component: function IntegrationsRoute() {
    usePageTitle('Integration Hub')
    return (
      <ErrorBoundary
        title="Integration Hub Error"
        description="Failed to load the Integration Hub. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">Loading…</div>
            </div>
          }
        >
          <IntegrationsScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
