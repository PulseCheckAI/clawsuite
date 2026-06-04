import { createFileRoute } from '@tanstack/react-router'
import { OctogentStage } from '@/screens/octogent/octogent-stage'

export const Route = createFileRoute('/octogent')({
  ssr: false,
  component: OctogentStage,
})
