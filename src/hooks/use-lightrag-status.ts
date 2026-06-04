/**
 * useLightragStatus — polls /lightrag/health through the PulseOS proxy to
 * show whether the knowledge-graph backend is reachable + healthy.
 *
 * LightRAG's /health returns { status: 'healthy', webui_available,
 * working_directory, input_directory, pipeline_busy } when alive. Any non-2xx
 * or a `status` other than 'healthy' flips the pill to "degraded" so
 * operators see the KG is unavailable in real time.
 *
 * 20 s polling — KG state changes slowly (the lightrag pm2 process either
 * stays up or doesn't), so a fast poll is wasteful. Auth gate is the PulseOS
 * session cookie via same-origin fetch.
 */
import { useQuery } from '@tanstack/react-query'

export type LightragHealth = {
  status?: string
  webui_available?: boolean
  working_directory?: string
  input_directory?: string
  pipeline_busy?: boolean
}

export function useLightragStatus(): {
  healthy: boolean
  payload: LightragHealth | null
  isLoading: boolean
  isError: boolean
} {
  const q = useQuery({
    queryKey: ['lightrag', 'health'],
    queryFn: async () => {
      const res = await fetch('/lightrag/health', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`/lightrag/health ${res.status}`)
      return (await res.json()) as LightragHealth
    },
    staleTime: 20_000,
    refetchInterval: 20_000,
    retry: 1,
  })
  return {
    healthy:
      !q.isError && typeof q.data?.status === 'string'
        ? q.data.status === 'healthy'
        : false,
    payload: q.data ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
  }
}
