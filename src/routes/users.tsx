import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { UsersScreen } from '@/screens/users/users-screen'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/users')({
  ssr: false,
  component: UsersRoute,
})

function UsersRoute() {
  usePageTitle('Users & Access')
  return (
    <div style={MC_STYLE} className="h-full">
      <UsersScreen />
    </div>
  )
}
