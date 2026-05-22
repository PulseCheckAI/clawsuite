import { z } from 'zod'

export const AccountIdSchema = z.enum(['thiago', 'mary', 'pulsecheck'])
export type AccountId = z.infer<typeof AccountIdSchema>

export const AccountTypeSchema = z.enum(['personal', 'company'])
export type AccountType = z.infer<typeof AccountTypeSchema>

const MediaSchema = z.object({
  path: z.string().min(1),
  mime: z.enum(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime']),
  alt_text: z.string().optional(),
})

const CarouselPdfSchema = z.object({
  path: z.string().min(1),
  page_count: z.number().int().positive().max(300),
})

export const PublishPayloadSchema = z
  .object({
    text: z.string().min(1).max(3000),
    scheduled_at_utc: z.string().datetime(),
    account_type: AccountTypeSchema,
    media: z.array(MediaSchema).optional(),
    carousel_pdf: CarouselPdfSchema.optional(),
    first_comment: z.string().max(1250).optional(),
    visibility: z.enum(['PUBLIC', 'CONNECTIONS']).default('PUBLIC'),
  })
  .refine(
    (v) =>
      v.account_type === 'personal'
        ? v.text.length <= 3000
        : v.text.length <= 700,
    {
      message: 'text exceeds max for account_type (3000 personal, 700 company)',
      path: ['text'],
    },
  )
  .refine((v) => !(v.media && v.carousel_pdf), {
    message: 'media and carousel_pdf are mutually exclusive',
    path: ['carousel_pdf'],
  })

export type PublishPayload = z.infer<typeof PublishPayloadSchema>

export const JobStatusSchema = z.enum([
  'pending',
  'claimed',
  'published',
  'failed',
  'cancelled',
])
export type JobStatus = z.infer<typeof JobStatusSchema>
