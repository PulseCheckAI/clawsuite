import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { RpcConsoleScreen } from '@/screens/system/rpc-console-screen'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/rpc-console')({
  ssr: false,
  component: RpcConsoleRoute,
})

function RpcConsoleRoute() {
  usePageTitle('Gateway RPC Console')
  return (
    <div style={MC_STYLE} className="h-full">
      <RpcConsoleScreen />
    </div>
  )
}
