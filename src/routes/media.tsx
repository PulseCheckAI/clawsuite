// AI Media Studio — image + video generation at 4K via Wan2GP.
// Screen implementation lives in `src/screens/media/`.

import { createFileRoute } from '@tanstack/react-router'
import { ErrorBoundary } from '@/components/error-boundary'
import { MediaStudio } from '@/screens/media/media-studio'

export const Route = createFileRoute('/media')({
  ssr: false,
  component: function MediaRoute() {
    return (
      <ErrorBoundary
        title="Media Studio Error"
        description="Failed to load the AI Media Studio. Try reloading the page."
      >
        <MediaStudio />
      </ErrorBoundary>
    )
  },
})
