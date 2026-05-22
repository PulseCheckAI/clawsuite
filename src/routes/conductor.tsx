import { createFileRoute } from '@tanstack/react-router'
import { Conductor } from '@/screens/gateway/conductor-mission-control'

export const Route = createFileRoute('/conductor')({
  ssr: false,
  component: Conductor,
})
