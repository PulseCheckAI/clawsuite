import { useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { GatewaySetupWizard } from '@/components/gateway-setup-wizard'
import { useGatewaySetupStore } from '@/hooks/use-gateway-setup'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/wizard')({
  ssr: false,
  component: WizardPage,
})

function WizardPage() {
  const open = useGatewaySetupStore((s) => s.open)

  // Auto-open the wizard when visiting /wizard directly
  useEffect(() => {
    open()
  }, [open])

  return (
    <div
      style={{
        ...MC_STYLE,
        background: 'var(--mc-bg)',
        color: 'var(--mc-text)',
      }}
      className="min-h-screen flex flex-col items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl">
        <GatewaySetupWizard />
        <div className="mt-4 text-center">
          <Link
            to="/dashboard"
            className="text-sm transition-colors"
            style={{ color: 'var(--mc-text-dim)' }}
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
