import { createFileRoute } from '@tanstack/react-router'
import { MissionControlScreen } from '@/screens/mission-control/mission-control-screen'
import { GatewayConnectionSetupForm } from '@/components/gateway-connection-banner'
import { AgentHubErrorBoundary } from '@/screens/gateway/components/agent-hub-error-boundary'
import { usePageTitle } from '@/hooks/use-page-title'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/dashboard')({
  ssr: false,
  component: function DashboardRoute() {
    usePageTitle('Command Center')
    return (
      <div style={MC_STYLE} className="h-full">
        <AgentHubErrorBoundary>
          <MissionControlScreen />
        </AgentHubErrorBoundary>
      </div>
    )
  },
  errorComponent: function DashboardError({ error }) {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred'
    const isConnectionError =
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('connect') ||
      message.includes('503') ||
      message.includes('ECONNREFUSED') ||
      message.includes('Failed to Load')

    return (
      <div
        style={{
          ...MC_STYLE,
          background: 'var(--mc-bg)',
          color: 'var(--mc-text)',
        }}
        className="flex flex-col items-center justify-center h-full p-6 text-center"
      >
        {isConnectionError ? (
          <div className="w-full max-w-xl">
            <h2
              className="text-xl font-semibold mb-2"
              style={{ color: 'var(--mc-text)' }}
            >
              Can&apos;t reach OCPlatform Gateway
            </h2>
            <p
              className="text-sm mb-6 max-w-md mx-auto"
              style={{ color: 'var(--mc-text-dim)' }}
            >
              ControlSuite needs a running OCPlatform gateway to connect to.
              Make sure it&apos;s running and enter your connection details
              below.
            </p>
            <GatewayConnectionSetupForm
              title="Connect to Gateway"
              description="Enter your gateway WebSocket URL and token."
              onSuccess={() => window.location.reload()}
            />
            <p
              className="mt-4 text-xs"
              style={{ color: 'var(--mc-text-dimmer)' }}
            >
              Default gateway URL: ws://127.0.0.1:18789
            </p>
          </div>
        ) : (
          <>
            <h2
              className="text-xl font-semibold mb-3"
              style={{ color: 'var(--mc-text)' }}
            >
              Failed to Load Dashboard
            </h2>
            <p
              className="text-sm mb-4 max-w-md"
              style={{ color: 'var(--mc-text-dim)' }}
            >
              {message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2"
              style={{
                background: 'var(--mc-cyan-soft)',
                color: 'var(--mc-cyan)',
                border: '1px solid var(--mc-border-bright)',
              }}
            >
              Reload Page
            </button>
          </>
        )}
      </div>
    )
  },
  pendingComponent: function DashboardPending() {
    return (
      <div
        style={{ ...MC_STYLE, background: 'var(--mc-bg)' }}
        className="flex items-center justify-center h-full"
      >
        <div className="text-center">
          <div
            className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-r-transparent mb-3"
            style={{ borderColor: 'var(--mc-cyan)' }}
          />
          <p className="text-sm" style={{ color: 'var(--mc-text-dim)' }}>
            Loading dashboard...
          </p>
        </div>
      </div>
    )
  },
})
