import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const RssScreen = lazy(() =>
  import('@/screens/rss/rss-screen').then((m) => ({
    default: m.RssScreen,
  })),
)

export const Route = createFileRoute('/rss')({
  ssr: false,
  component: function RssRoute() {
    usePageTitle('RSS Cockpit')
    return (
      <ErrorBoundary
        title="RSS Error"
        description="Failed to load the RSS module. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">
                Loading RSS module…
              </div>
            </div>
          }
        >
          <RssScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
