import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { SkillsScreen } from '@/screens/skills/skills-screen'
import { MC_STYLE } from '@/screens/agents/operations-screen'

export const Route = createFileRoute('/skills')({
  ssr: false,
  component: SkillsRoute,
})

function SkillsRoute() {
  usePageTitle('Skills')
  return (
    <div style={MC_STYLE} className="h-full">
      <SkillsScreen />
    </div>
  )
}
