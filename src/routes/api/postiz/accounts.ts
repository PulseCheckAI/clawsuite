// Postiz module — list connected social accounts.
// GET /api/postiz/accounts
//
// Wraps Postiz GET /public/v1/integrations (Postiz public API). The response
// shape returned to the UI is a slim, token-free metadata view. LinkedIn
// entries are filtered out aggressively — this module never posts to LinkedIn
// (the LinkedIn-D MCP owns that surface).
//
// Called from: src/routes/postiz.tsx (the colocated PostizScreen) via
//              fetch('/api/postiz/accounts').
//
// Postiz API contract — assumptions (TODO: verify against a live instance):
//   Path:    GET /public/v1/integrations
//   Auth:    Authorization: <POSTIZ_API_KEY>   (no 'Bearer ' prefix)
//   Returns: Array<{
//              id: string,
//              identifier: string,            // platform key, e.g. 'x', 'instagram'
//              name: string,                   // handle/display name
//              picture?: string,
//              providerIdentifier?: string,
//              type?: 'social' | 'article',
//              disabled?: boolean,
//              refreshNeeded?: boolean,
//              tokenExpiration?: string | null,
//              additionalSettings?: unknown,   // we never echo this
//            }>

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  getPostizBaseUrl,
  getPostizClient,
  isForbiddenPlatform,
  normalizePostizSdkResult,
  POSTIZ_NOT_CONFIGURED,
  postizSdkError,
} from './_client'

interface PostizIntegrationRaw {
  id?: unknown
  identifier?: unknown
  name?: unknown
  picture?: unknown
  providerIdentifier?: unknown
  type?: unknown
  disabled?: unknown
  refreshNeeded?: unknown
  tokenExpiration?: unknown
}

export interface PostizAccount {
  id: string
  identifier: string
  name: string
  picture: string | null
  type: 'social' | 'article' | 'unknown'
  disabled: boolean
  refreshNeeded: boolean
  tokenExpiration: string | null
}

function normalizeAccount(raw: PostizIntegrationRaw): PostizAccount | null {
  const id = typeof raw.id === 'string' ? raw.id : null
  const identifier = typeof raw.identifier === 'string' ? raw.identifier : null
  const name = typeof raw.name === 'string' ? raw.name : null
  if (!id || !identifier || !name) return null
  const type =
    raw.type === 'social' || raw.type === 'article'
      ? raw.type
      : ('unknown' as const)
  return {
    id,
    identifier,
    name,
    picture: typeof raw.picture === 'string' ? raw.picture : null,
    type,
    disabled: raw.disabled === true,
    refreshNeeded: raw.refreshNeeded === true,
    tokenExpiration:
      typeof raw.tokenExpiration === 'string' ? raw.tokenExpiration : null,
  }
}

export const Route = createFileRoute('/api/postiz/accounts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Migrated from raw fetch (`callPostiz`) to the official
        // `@postiz/node` SDK. The SDK calls
        // GET ${path}/public/v1/integrations under the hood; our
        // `getPostizSdkPath()` bakes in the self-host `/api` prefix so the
        // request still hits the NestJS backend (not the Next.js catchall).
        // Errors are normalized through `normalizePostizSdkResult` so the
        // {ok:false,error,hint,status} envelope is identical to the legacy
        // `callPostiz` path the UI already consumes.
        const client = getPostizClient()
        if (!client) {
          return json(
            { ...POSTIZ_NOT_CONFIGURED, accounts: [] },
            { status: POSTIZ_NOT_CONFIGURED.status },
          )
        }

        let result
        try {
          result = normalizePostizSdkResult<unknown>(
            await client.integrations(),
          )
        } catch (err) {
          result = postizSdkError(err)
        }

        if (!result.ok) {
          return json(
            {
              ok: false,
              error: result.error,
              hint:
                result.hint ??
                `Postiz at ${getPostizBaseUrl()} did not respond. ` +
                  'Connect new accounts via the Postiz dashboard.',
              accounts: [],
            },
            { status: result.status },
          )
        }

        // Postiz may return an array directly or { integrations: [...] }.
        let rawList: unknown[] = []
        if (Array.isArray(result.data)) {
          rawList = result.data
        } else if (
          result.data !== null &&
          typeof result.data === 'object' &&
          Array.isArray(
            (result.data as { integrations?: unknown }).integrations,
          )
        ) {
          rawList = (result.data as { integrations: unknown[] }).integrations
        }

        const accounts: PostizAccount[] = []
        for (const item of rawList) {
          if (!item || typeof item !== 'object') continue
          const normalized = normalizeAccount(item as PostizIntegrationRaw)
          if (!normalized) continue
          // Aggressive LinkedIn filter — never expose LinkedIn accounts to the
          // composer surface. LinkedIn is owned by a different module.
          if (isForbiddenPlatform(normalized.identifier)) continue
          accounts.push(normalized)
        }

        return json({
          ok: true,
          accounts,
          baseUrl: getPostizBaseUrl(),
        })
      },
    },
  },
})
