import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const AskBrainScreen = lazy(() =>
  import('@/screens/ask/ask-brain').then((m) => ({
    default: m.AskBrainScreen,
  })),
)

export const Route = createFileRoute('/ask')({
  ssr: false,
  component: function AskRoute() {
    usePageTitle('Ask your brain')
    return (
      <ErrorBoundary
        title="Ask Error"
        description="Failed to load the Ask module. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">Loading…</div>
            </div>
          }
        >
          <AskBrainScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
