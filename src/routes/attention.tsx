import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { AttentionScreen } from '@/screens/system/attention-screen'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/attention')({
  ssr: false,
  component: AttentionRoute,
})

function AttentionRoute() {
  usePageTitle('Needs You Now')
  return (
    <div style={MC_STYLE} className="h-full">
      <AttentionScreen />
    </div>
  )
}
