import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { MemoryBrowserScreen } from '@/screens/memory/memory-browser-screen'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/memory')({
  ssr: false,
  component: function MemoryRoute() {
    usePageTitle('Memory')
    return (
      <div style={MC_STYLE} className="h-full">
        <MemoryBrowserScreen />
      </div>
    )
  },
})
