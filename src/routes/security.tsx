import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { SecurityScreen } from '@/screens/system/security-screen'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/security')({
  ssr: false,
  component: SecurityRoute,
})

function SecurityRoute() {
  usePageTitle('Security & Exposure')
  return (
    <div style={MC_STYLE} className="h-full">
      <SecurityScreen />
    </div>
  )
}
