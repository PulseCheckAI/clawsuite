// Shared types for the cross-platform social-routing pipeline.
// Used by /api/social/dispatch and any UI that wants to render results.

export type SocialPlatform = 'linkedin' | 'instagram' | 'facebook'

export type PlatformStatus = 'posted' | 'failed' | 'skipped' | 'not_wired'

export interface DispatchPayload {
  /** Public URL of the artifact (image, video, or pdf). Must be reachable. */
  artifactUrl: string
  /**
   * Optional explicit mime; if omitted the handler issues a HEAD to discover.
   * Allowed values: image/jpeg, image/png, image/gif, image/webp, video/mp4,
   * application/pdf.
   */
  mimeType?: string
  /** Caption / post body. Optional but most platforms want non-empty text. */
  caption?: string
  /** Hashtags (without leading #). Appended to caption per platform style. */
  hashtags?: string[]
  /** Targets to dispatch to. At least one. */
  targets: SocialPlatform[]
  /**
   * Identity to post as. For LinkedIn this is the person/organization
   * linkedin_id stored in integrations.linkedin_oauth. IG/FB stubs ignore.
   */
  identityId: string
  /** Visibility hint, LinkedIn-specific. */
  visibility?: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN'
}

export interface PlatformResult {
  platform: SocialPlatform
  status: PlatformStatus
  /** Human-readable note. For stubs this is the [not_wired] explanation. */
  message: string
  /** Post URN/id if posted. Absent for stubs and failures. */
  postId?: string
  /** Elapsed ms from dispatch fan-out start. */
  durationMs: number
}

export interface DispatchResult {
  ok: boolean
  /** All true if every requested target returned status='posted'. */
  allPosted: boolean
  /** Mime detected or echoed back from the payload. */
  mimeType: string | null
  /** Per-platform results, one entry per requested target. */
  results: PlatformResult[]
  /** Top-level error if the dispatch never reached the fan-out (e.g. bad payload). */
  error?: string
}

export const ALLOWED_MIME_TYPES: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'application/pdf',
] as const
