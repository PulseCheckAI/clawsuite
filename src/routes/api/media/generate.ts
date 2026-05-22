// POST /api/media/generate — submit a generation job to the Wan2GP adapter.
//
// Body: MediaGenerationPayload (see wan2gp-adapter.ts). Returns the
// MediaJobSubmission so the UI knows the jobId to poll.

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '@/server/rate-limit'
import { submitGeneration } from '@/server/wan2gp-adapter'

const GenerateBodySchema = z.object({
  profileId: z.enum([
    'wan2gp-image',
    'wan2gp-video',
    'comfyui',
    'replicate',
    'local-sdxl',
  ]),
  prompt: z.string().trim().min(3).max(4000),
  skillIds: z.array(z.string().max(64)).max(12).optional(),
  width: z.number().int().min(64).max(7680).optional(),
  height: z.number().int().min(64).max(4320).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  frames: z.number().int().min(1).max(512).optional(),
  imagePath: z.string().max(2048).nullable().optional(),
  seed: z
    .number()
    .int()
    .min(-1)
    .max(2 ** 31 - 1)
    .optional(),
})

export const Route = createFileRoute('/api/media/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf

        const ip = getClientIp(request)
        if (!rateLimit(`media-generate:${ip}`, 12, 60_000)) {
          return rateLimitResponse()
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const parsed = GenerateBodySchema.safeParse(body)
        if (!parsed.success) {
          return json(
            {
              ok: false,
              error: 'Validation failed',
              details: parsed.error.flatten().fieldErrors,
            },
            { status: 400 },
          )
        }

        try {
          const submission = await submitGeneration(parsed.data)
          return json({ ok: true, submission })
        } catch (err) {
          // Surface real Wan2GP errors verbatim (no fake successes).
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 502 },
          )
        }
      },
    },
  },
})
