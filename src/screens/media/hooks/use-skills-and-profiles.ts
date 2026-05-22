// useSkillsAndProfiles — loads the skill registry + generator profiles from
// /api/media/skills on mount.

import { useEffect, useState } from 'react'
import type { GeneratorProfile, SkillDef } from '@/server/wan2gp-adapter'
import type { SkillsResponse } from '../types'

export function useSkillsAndProfiles() {
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [profiles, setProfiles] = useState<GeneratorProfile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/media/skills', {
          headers: { accept: 'application/json' },
        })
        const data = (await res.json()) as SkillsResponse
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`)
          setLoaded(true)
          return
        }
        setSkills(data.skills ?? [])
        setProfiles(data.profiles ?? [])
        setError(null)
        setLoaded(true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return { skills, profiles, error, loaded }
}
