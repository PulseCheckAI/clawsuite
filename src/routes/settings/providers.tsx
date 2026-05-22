import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { ProvidersScreen } from '@/screens/settings/providers-screen'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/settings/providers')({
  component: function SettingsProvidersRoute() {
    usePageTitle('Provider Setup')
    return (
      <div style={MC_STYLE} className="h-full">
        <ProvidersScreen />
      </div>
    )
  },
})
