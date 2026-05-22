import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const LinkedInScreen = lazy(() =>
  import('@/screens/linkedin/linkedin-screen').then((m) => ({
    default: m.LinkedInScreen,
  })),
)

export const Route = createFileRoute('/linkedin')({
  ssr: false,
  component: function LinkedInRoute() {
    usePageTitle('LinkedIn')
    return (
      <ErrorBoundary
        title="LinkedIn Insights Error"
        description="Failed to load LinkedIn worker insights. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">
                Loading LinkedIn insights…
              </div>
            </div>
          }
        >
          <LinkedInScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
