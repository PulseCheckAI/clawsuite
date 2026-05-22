import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

const PostizScreen = lazy(() =>
  import('@/screens/postiz/postiz-screen').then((m) => ({
    default: m.PostizScreen,
  })),
)

export const Route = createFileRoute('/postiz')({
  ssr: false,
  component: function PostizRoute() {
    usePageTitle('Postiz')
    return (
      <ErrorBoundary
        title="Postiz Error"
        description="Failed to load the Postiz module. Try reloading."
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-primary-400">
                Loading Postiz module…
              </div>
            </div>
          }
        >
          <PostizScreen />
        </Suspense>
      </ErrorBoundary>
    )
  },
})
