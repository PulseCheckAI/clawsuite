import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const GmailScreen = lazy(() =>
  import('@/screens/gmail/gmail-screen').then((m) => ({
    default: m.GmailScreen,
  })),
)

export const Route = createFileRoute('/gmail')({
  ssr: false,
  component: function GmailRoute() {
    usePageTitle('Gmail')
    return (
      <ErrorBoundary
        title="Gmail Error"
        description="Failed to load the Gmail module. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">
                Loading Gmail module…
              </div>
            </div>
          }
        >
          <GmailScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
