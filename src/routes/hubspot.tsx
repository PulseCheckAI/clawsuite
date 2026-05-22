import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const HubSpotScreen = lazy(() =>
  import('@/screens/hubspot/hubspot-screen').then((m) => ({
    default: m.HubSpotScreen,
  })),
)

export const Route = createFileRoute('/hubspot')({
  ssr: false,
  component: function HubSpotRoute() {
    usePageTitle('HubSpot')
    return (
      <ErrorBoundary
        title="HubSpot Error"
        description="Failed to load the HubSpot module. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">
                Loading HubSpot module…
              </div>
            </div>
          }
        >
          <HubSpotScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
