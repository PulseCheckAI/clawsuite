// Shared types for the Media Studio screen.

import type {
  GeneratorProfile,
  GeneratorProfileId,
  MediaJobStatus,
  MediaJobSubmission,
  SkillDef,
} from '@/server/wan2gp-adapter'

export interface SkillsResponse {
  ok: boolean
  skills?: SkillDef[]
  profiles?: GeneratorProfile[]
  error?: string
}

export interface GenerateResponse {
  ok: boolean
  submission?: MediaJobSubmission
  error?: string
}

export interface StatusResponse {
  ok: boolean
  status?: MediaJobStatus
  error?: string
}

export interface QueueEntry {
  jobId: string
  profileId: GeneratorProfileId
  kind: 'image' | 'video'
  prompt: string
  effectivePrompt: string
  effectiveResolution: string
  targetWidth: number
  targetHeight: number
  submittedAt: number
  status: MediaJobStatus['status']
  progress: number | null
  phase: string | null
  error: string | null
  artifactUrl: string | null
  finishedAt: number | null
}
